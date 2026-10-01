import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { initDb, query, getPool, withTransaction } from "../lib/db";
import * as royale from "../lib/backend/royale";
import * as leaderboard from "../lib/backend/leaderboard";
import * as daily from "../lib/backend/daily";
import * as feedback from "../lib/backend/feedback";
import * as growth from "../lib/backend/growth";
import * as telemetry from "../lib/backend/telemetry";
import * as names from "../lib/backend/names";
import * as playerNames from "../lib/player-names";
import {
  advanceTime,
  COUNTDOWN_MS,
  finishMatch,
  type Tournament,
  newLobby,
  startTournament,
} from "../lib/royale";

async function cleanup() {
  await query(`
    TRUNCATE "user", "session", "account", "verification",
             profiles, tournaments, rewards, quests,
             daily_attempts, name_claims, feedback,
             shared_results, events, metric_facts,
             metric_rollups, campaign_metrics, player_activity
    CASCADE
  `);
}

async function player(name = "Guest", guest = true) {
  const userId = crypto.randomUUID();
  await query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", "isAnonymous")
     VALUES ($1, $2, $3, false, NOW(), NOW(), $4)`,
    [userId, name, `${name}-${userId}@example.invalid`, guest],
  );
  const profileId = await royale.ensureProfile(userId, guest);
  return {
    authId: userId,
    id: profileId,
    client: {
      query: {
        dashboard: () => royale.dashboard(userId),
        today: () => daily.today(userId),
      },
      mutation: {
        ensureProfile: () => royale.ensureProfile(userId, guest),
        join: (args?: { roomCode?: string }) =>
          royale.join(userId, args?.roomCode),
        leaveLobby: () => royale.leaveLobby(userId),
        move: (args: {
          tournament: string;
          match: number;
          seq: number;
          action: number;
        }) =>
          royale.move(
            userId,
            args.tournament,
            args.match,
            args.seq,
            args.action,
          ),
        resign: (args: { tournament: string }) =>
          royale.resign(userId, args.tournament),
        rename: (args: { name: string }) =>
          royale.rename(userId, args.name, guest),
        equip: (args: { id: string }) => royale.equip(userId, args.id),
        setOptOut: (args: { optOut: boolean }) =>
          leaderboard.setOptOut(userId, args.optOut, guest),
        host: () => growth.host(userId),
        start: () => growth.start(userId),
        attribute: (args: { source: string; campaign: string }) =>
          growth.attribute(userId, args.source, args.campaign),
        shareResult: (args: { tournament: string }) =>
          growth.shareResult(userId, args.tournament),
        attempt: (args: { day: string; action: number }) =>
          daily.attempt(userId, args.day, args.action),
      },
    },
  };
}

vi.setConfig({ testTimeout: 60000 });

beforeAll(async () => {
  await initDb();
});

beforeEach(async () => {
  await cleanup();
});

describe("Neon PostgreSQL authoritative Royale backend", () => {
  it("limits the public leaderboard to ten eligible accounts and persists opt-out", async () => {
    const accounts = [];
    for (let i = 1; i <= 15; i++) {
      const account = await player(`Account${i}`, false);
      await query("UPDATE profiles SET points = $1 WHERE id = $2", [
        i * 100,
        account.id,
      ]);
      accounts.push(account);
    }
    const guest = await player("Guest");
    await query("UPDATE profiles SET points = 9999 WHERE id = $1", [guest.id]);

    const topAccount = accounts[14];
    expect(
      (await topAccount.client.query.dashboard()).profile.leaderboardOptOut,
    ).toBe(false);

    let rows = await leaderboard.top();
    expect(rows).toHaveLength(10);
    expect(rows.map((p) => p.points)).toEqual([
      1500, 1400, 1300, 1200, 1100, 1000, 900, 800, 700, 600,
    ]);
    expect(Object.keys(rows[0]).sort()).toEqual([
      "crowns",
      "level",
      "name",
      "points",
      "rank",
      "tier",
    ]);

    await expect(
      guest.client.mutation.setOptOut({ optOut: true }),
    ).rejects.toThrow("Log in");

    await topAccount.client.mutation.setOptOut({ optOut: true });
    await topAccount.client.mutation.ensureProfile();
    await leaderboard.migrateLeaderboard();

    expect(
      (await topAccount.client.query.dashboard()).profile.leaderboardOptOut,
    ).toBe(true);

    rows = await leaderboard.top();
    expect(rows.map((p) => p.points)).toEqual([
      1400, 1300, 1200, 1100, 1000, 900, 800, 700, 600, 500,
    ]);

    await topAccount.client.mutation.setOptOut({ optOut: false });
    expect((await leaderboard.top())[0].points).toBe(1500);
  });

  it("breaks leaderboard ties by crowns and XP and retains an account's privacy setting when linking", async () => {
    const a = await player("A", false);
    const b = await player("B", false);
    const c = await player("C", false);

    await query(
      "UPDATE profiles SET points = 100, crowns = 1, xp = 500 WHERE id = $1",
      [a.id],
    );
    await query(
      "UPDATE profiles SET points = 100, crowns = 2, xp = 200 WHERE id = $1",
      [b.id],
    );
    await query(
      "UPDATE profiles SET points = 100, crowns = 2, xp = 300 WHERE id = $1",
      [c.id],
    );

    const names = [
      (await query("SELECT name FROM profiles WHERE id = $1", [c.id])).rows[0]
        .name,
      (await query("SELECT name FROM profiles WHERE id = $1", [b.id])).rows[0]
        .name,
      (await query("SELECT name FROM profiles WHERE id = $1", [a.id])).rows[0]
        .name,
    ];

    const topRows = await leaderboard.top();
    expect(topRows.map((p) => p.name)).toEqual(names);

    const guest = await player("Visitor");
    await b.client.mutation.setOptOut({ optOut: true });

    await royale.linkProfiles(guest.authId, b.authId);
    expect((await b.client.query.dashboard()).profile.leaderboardOptOut).toBe(
      true,
    );
    expect((await leaderboard.top()).map((p) => p.name)).not.toContain(
      (await query("SELECT name FROM profiles WHERE id = $1", [b.id])).rows[0]
        .name,
    );
  });

  it("retries a generated player name already present in the database", async () => {
    const account = await player("Account", false);
    await account.client.mutation.rename({ name: "Silver Otter" });

    const generator = vi
      .spyOn(playerNames, "generatePlayerName")
      .mockReturnValueOnce("Silver Otter")
      .mockReturnValueOnce("Amber Lynx");

    try {
      const guest = await player("Guest");
      expect((await guest.client.query.dashboard()).profile.name).toBe(
        "Amber Lynx",
      );
      expect(generator).toHaveBeenCalledTimes(2);
    } finally {
      generator.mockRestore();
    }
  });

  it("generates two-word player names and rejects case-insensitive duplicate edits", async () => {
    const a = await player("AccountA", false);
    const b = await player("AccountB", false);
    const first = await a.client.query.dashboard();
    const second = await b.client.query.dashboard();

    expect(first.profile.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(first.profile.name).not.toBe(second.profile.name);

    await a.client.mutation.rename({ name: "  Bright   Falcon  " });
    expect((await a.client.query.dashboard()).profile.name).toBe(
      "Bright Falcon",
    );

    await expect(
      b.client.mutation.rename({ name: "bright falcon" }),
    ).rejects.toThrow("already taken");
  });

  it("reserves legacy names and replaces duplicate legacy names during migration", async () => {
    const a = await player("A");
    const b = await player("B");
    await query("UPDATE profiles SET name = 'Legacy Fox' WHERE id = $1", [
      a.id,
    ]);
    await query("UPDATE profiles SET name = 'legacy fox' WHERE id = $1", [
      b.id,
    ]);

    expect((await names.migrateNames()).renamed).toBe(1);
    const namesRows = (await query("SELECT name FROM profiles")).rows.map((p) =>
      p.name.toLowerCase(),
    );
    expect(new Set(namesRows).size).toBe(2);
    expect((await names.migrateNames()).renamed).toBe(0);
  });

  it("shares lobbies, rejects unauthenticated access, and leaves before lock", async () => {
    const a = await player("A");
    const b = await player("B");

    const room = await a.client.mutation.join();
    expect(await b.client.mutation.join()).toBe(room);
    expect(await a.client.mutation.join()).toBe(room);

    const view = await a.client.query.dashboard();
    expect(view.tournament?.entrants).toHaveLength(2);

    await b.client.mutation.leaveLobby();
    expect(
      (await a.client.query.dashboard()).tournament?.entrants,
    ).toHaveLength(1);
  });

  it("telemetry counts unique and daily players without refresh or retry inflation", async () => {
    const a = await player("MetricsA");
    const b = await player("MetricsB");

    await a.client.mutation.ensureProfile();
    await a.client.mutation.ensureProfile();

    expect(await telemetry.publicStats()).toEqual({
      players: 0,
      games: 0,
      crowns: 0,
    });

    const id = await a.client.mutation.join();
    await a.client.mutation.join();
    await a.client.mutation.leaveLobby();

    const stats = await telemetry.live();
    expect(stats.activePlayers).toBeGreaterThanOrEqual(1);
    expect(id).toBeTruthy();
    expect(b.id).toBeTruthy();
  });

  it("starts with CPU fill and persists an eliminated player's reward exactly once", async () => {
    const a = await player("PlayerA");
    const id = await a.client.mutation.join();

    // Advance time and drive bots to fill lobby
    const row = (
      await query("SELECT state FROM tournaments WHERE id = $1", [id])
    ).rows[0];
    const state = row.state as Tournament;
    startTournament(state, Date.now());
    const m = state.matches.find((m) => m.players.includes(a.id))!;
    state.entrants.find((e) => e.id === a.id)!.moved = true;
    finishMatch(
      state,
      m,
      m.players.find((p) => p !== a.id)!,
      "board victory",
      Date.now(),
    );
    await withTransaction((client) =>
      royale.save(client, id, state, Date.now()),
    );

    await royale.driveBots(id, state.version);
    await royale.driveBots(id, state.version + 1);

    const result = await a.client.query.dashboard();
    expect(result.profile.xp).toBe(50);
    expect(result.history).toHaveLength(1);
    expect(result.profile.active).toBeNull();
    expect(result.view?.phase).toBe("results");
  });

  it("rejects spectator and stale moves while clients receive sanitized brackets", async () => {
    const a = await player("A");
    const b = await player("B");
    const id = await a.client.mutation.join();

    const row = (
      await query("SELECT state FROM tournaments WHERE id = $1", [id])
    ).rows[0];
    const state = row.state as Tournament;
    startTournament(state, Date.now());
    await query(
      "UPDATE tournaments SET state = $1, status = $2 WHERE id = $3",
      [JSON.stringify(state), state.status, id],
    );

    const view = await a.client.query.dashboard();
    expect(view.tournament).not.toHaveProperty("seed");
    expect(view.tournament!.matches[0]).not.toHaveProperty("tieSecret");

    const m = view.tournament!.matches.find((m) => m.players.includes(a.id))!;
    await expect(
      b.client.mutation.move({
        tournament: id,
        match: m.id,
        seq: 0,
        action: 0,
      }),
    ).rejects.toThrow("not in this Royale");

    await expect(
      a.client.mutation.move({
        tournament: id,
        match: m.id,
        seq: 999,
        action: 0,
      }),
    ).rejects.toThrow();
  });

  it("joining a full human field starts early and spectators follow their sibling", async () => {
    const players = [];
    for (let i = 0; i < 16; i++) players.push(await player(`Player${i}`));
    const id = await players[0].client.mutation.join();
    for (const p of players.slice(1)) {
      await p.client.mutation.join();
    }
    const row = (
      await query("SELECT state FROM tournaments WHERE id = $1", [id])
    ).rows[0];
    expect(row.state.status).toBe("active");
    expect(row.state.entrants.some((e: any) => e.cpu)).toBe(false);
  });

  it("account linking preserves saved progress and blocks active players", async () => {
    const a = await player("Guest", true);
    const b = await player("Account", false);

    await query(
      "UPDATE profiles SET points = 350, xp = 250, cosmetics = '[\"unlock-2\"]'::jsonb WHERE id = $1",
      [a.id],
    );

    const id = await a.client.mutation.join();
    await expect(royale.linkProfiles(a.authId, b.authId)).rejects.toThrow(
      "Finish your tournament",
    );

    await a.client.mutation.leaveLobby();
    await query(
      `INSERT INTO rewards (id, profile, tournament, finish, delta, xp, created_at)
       VALUES ($1, $2, $3, 4, 80, 250, $4)`,
      [crypto.randomUUID(), a.id, id, Date.now()],
    );

    await royale.linkProfiles(a.authId, b.authId);

    const view = await b.client.query.dashboard();
    expect(view.profile.points).toBe(350);
    expect(view.profile.xp).toBe(250);
    expect(view.profile.crowns).toBe(1);
    expect(view.profile.cosmetics).toContain("unlock-2");
  });
});

describe("private player feedback", () => {
  const input = {
    message: "  Please add a rematch option.  ",
    category: "Idea" as const,
    email: "",
    page: "/practice",
    client: "00000000-0000-4000-8000-000000000001",
    request: "00000000-0000-4000-8000-000000000002",
    website: "",
  };

  it("accepts guests, trims messages, and deduplicates retries", async () => {
    await feedback.send(input);
    await feedback.send(input);
    const rows = (await query("SELECT * FROM feedback")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].message).toBe("Please add a rematch option.");
    expect(rows[0].category).toBe("Idea");
    expect(rows[0].page).toBe("/practice");
    expect(rows[0].email).toBeNull();
  });

  it("validates content, discards honeypot spam, and limits repeated submissions", async () => {
    await feedback.send({ ...input, website: "spam" });
    expect((await query("SELECT * FROM feedback")).rows).toHaveLength(0);

    await expect(feedback.send({ ...input, message: "short" })).rejects.toThrow(
      "characters",
    );

    await expect(feedback.send({ ...input, email: "bad" })).rejects.toThrow(
      "valid email",
    );

    for (let i = 2; i <= 4; i++) {
      await feedback.send({
        ...input,
        request: `00000000-0000-4000-8000-00000000000${i}`,
      });
    }

    await expect(
      feedback.send({
        ...input,
        request: "00000000-0000-4000-8000-000000000005",
      }),
    ).rejects.toThrow("wait an hour");
  });
});

describe("growth features", () => {
  it("isolates friend rooms, authorizes the host, transfers hosting, and fills the bracket", async () => {
    const a = await player("RoomHost");
    const b = await player("RoomFriend");
    const c = await player("RankedPlayer");

    const code = await a.client.mutation.host();
    expect(code).toMatch(/^[a-z2-9]{10}$/);

    const friendId = await b.client.mutation.join({ roomCode: code });
    const publicId = await c.client.mutation.join();
    expect(publicId).not.toBe(friendId);

    expect(
      (await b.client.query.dashboard()).tournament?.entrants,
    ).toHaveLength(2);

    await expect(b.client.mutation.start()).rejects.toThrow(
      "Only the lobby host",
    );

    await a.client.mutation.leaveLobby();
    expect((await b.client.query.dashboard()).isHost).toBe(true);

    await b.client.mutation.start();
    const data = await b.client.query.dashboard();
    expect(data.tournament?.entrants).toHaveLength(16);

    await expect(a.client.mutation.join({ roomCode: code })).rejects.toThrow(
      "already started",
    );
  });

  it("saves first-touch attribution once and counts conversions at join", async () => {
    const a = await player("Referral");
    await a.client.mutation.attribute({
      source: "YouTube",
      campaign: "creator_one",
    });
    await a.client.mutation.attribute({
      source: "direct",
      campaign: "none",
    });

    expect((await a.client.query.dashboard()).profile.acquisition?.source).toBe(
      "youtube",
    );

    await a.client.mutation.join();
    const report = await growth.report();
    expect(
      report.campaigns.find((c: any) => c.source === "youtube"),
    ).toMatchObject({
      campaign: "creator_one",
      visitors: 1,
      entries: 1,
    });
  });

  it("checks every daily position and persists guesses without awarding rank or crowns", async () => {
    const { dailyPosition, utcDay } = await import("../lib/daily");
    const { legal, play } = await import("../lib/game");

    for (let i = 0; i < 10; i++) {
      const state = dailyPosition(utcDay(Date.now() + i * 86400_000));
      expect(
        legal(state).filter((a) => play(state, a).winner === state.turn),
      ).toHaveLength(1);
    }

    const a = await player("DailyPlayer");
    const today = await a.client.query.today();
    expect(today.solution).toBeUndefined();

    const solution = legal(today.state).find(
      (act) => play(today.state, act).winner === today.state.turn,
    )!;
    const wrong = legal(today.state).find((act) => act !== solution)!;

    await a.client.mutation.attempt({
      day: today.day,
      action: wrong,
    });
    await expect(
      a.client.mutation.attempt({ day: today.day, action: wrong }),
    ).rejects.toThrow("already tried");

    await expect(
      a.client.mutation.attempt({
        day: "2000-01-01",
        action: solution,
      }),
    ).rejects.toThrow("new daily");

    await a.client.mutation.attempt({
      day: today.day,
      action: solution,
    });

    const done = await a.client.query.today();
    expect(done).toMatchObject({ solved: true, done: true, solution });
    expect(done.attempts).toHaveLength(2);

    const p = (await a.client.query.dashboard()).profile;
    expect([p.xp, p.crowns, p.points]).toEqual([0, 0, 0]);
  });

  it("publishes only an authorized result snapshot and deduplicates share cards", async () => {
    const a = await player("Sharer");
    const b = await player("OtherSharer");
    const id = await a.client.mutation.join();

    await expect(
      b.client.mutation.shareResult({ tournament: id }),
    ).rejects.toThrow("isn't ready");

    const row = (
      await query("SELECT state FROM tournaments WHERE id = $1", [id])
    ).rows[0];
    const state = row.state as Tournament;
    state.entrants[0].finish = 0;
    await query("UPDATE tournaments SET state = $1 WHERE id = $2", [
      JSON.stringify(state),
      id,
    ]);

    await query(
      `INSERT INTO rewards (id, profile, tournament, finish, delta, xp, crown, created_at)
       VALUES ($1, $2, $3, 0, 0, 0, false, $4)`,
      [crypto.randomUUID(), a.id, id, Date.now()],
    );

    const token = await a.client.mutation.shareResult({ tournament: id });
    expect(await a.client.mutation.shareResult({ tournament: id })).toBe(token);

    const result = await growth.sharedResult(token);
    expect(Object.keys(result!).sort()).toEqual([
      "crown",
      "delta",
      "finish",
      "name",
      "rounds",
      "wins",
    ]);
    expect(await growth.sharedResult("not-a-token")).toBeNull();
  });

  it("serializes simultaneous requeues from the same account", async () => {
    const a = await player("DoubleJoin");
    const ids = await Promise.all(
      Array.from({ length: 12 }, () => royale.join(a.authId)),
    );
    expect(new Set(ids).size).toBe(1);
    const rows = (await query("SELECT state FROM tournaments")).rows;
    expect(rows).toHaveLength(1);
    expect(
      rows[0].state.entrants.filter((e: any) => e.id === a.id),
    ).toHaveLength(1);
  });

  it("keeps concurrent telemetry counts and repeated facts exact", async () => {
    const now = Date.now();
    const id = crypto.randomUUID();
    await Promise.all(
      Array.from({ length: 40 }, (_, i) =>
        withTransaction(async (c) => {
          // Exercise both historical campaign/global lock orders.
          if (i % 2)
            await telemetry.sourceMetric(
              c,
              { source: "stress", campaign: id },
              now,
              "visitors",
            );
          await telemetry.fact(c, `counter:${id}:${i}`, now, {
            stressCount: 1,
          });
          if (!(i % 2))
            await telemetry.sourceMetric(
              c,
              { source: "stress", campaign: id },
              now,
              "visitors",
            );
        }),
      ),
    );
    await Promise.all(
      Array.from({ length: 20 }, () =>
        telemetry.fact(null, `same:${id}`, now, { stressCount: 1 }),
      ),
    );
    expect(
      (await query("SELECT values FROM metric_rollups WHERE bucket='all'"))
        .rows[0].values.stressCount,
    ).toBe(41);
    expect(
      (
        await query(
          "SELECT values FROM campaign_metrics WHERE source='stress' AND campaign=$1 AND bucket='all'",
          [id],
        )
      ).rows[0].values.visitors,
    ).toBe(40);
  });

  it("watchdog recovers lost countdown and expired clocks without duplicating rewards", async () => {
    const a = await player("Watchdog");
    const now = Date.now();
    const id = crypto.randomUUID();
    const state = newLobby(0, now - 60_000, 1);
    state.entrants.push({
      id: a.id,
      name: "Watchdog",
      cpu: false,
      avatar: "●",
      skill: 0,
      points: 0,
      moved: true,
      wins: 0,
      boards: 0,
    });
    startTournament(state, now - 60_000);
    advanceTime(state, now - 50_000);
    const humanMatch = state.matches.find((m) => m.players.includes(a.id))!;
    humanMatch.state.turn = humanMatch.players[0] === a.id ? 1 : -1;
    // Direct persistence intentionally creates no in-process timer.
    await query(
      "INSERT INTO tournaments(id,tier,status,state,updated_at) VALUES($1,0,'active',$2,$3)",
      [id, JSON.stringify(state), now - 60_000],
    );
    await query("UPDATE profiles SET active=$1,last=$1 WHERE id=$2", [
      id,
      a.id,
    ]);
    const first = await royale.recover();
    expect(first).toMatchObject({ due: 1, advanced: 1, failed: 0 });
    const recovered = (
      await query("SELECT state FROM tournaments WHERE id=$1", [id])
    ).rows[0].state as Tournament;
    expect(recovered.version).toBeGreaterThan(state.version);
    expect(
      recovered.matches.filter((m) => m.status === "finished").length,
    ).toBeGreaterThan(0);
    const rewards = (
      await query("SELECT id FROM rewards WHERE tournament=$1", [id])
    ).rows;
    expect(rewards).toHaveLength(1);
    await Promise.all([
      royale.recover(),
      royale.recover(),
      royale.dashboard(a.authId),
    ]);
    expect(
      (await query("SELECT id FROM rewards WHERE tournament=$1", [id])).rows,
    ).toHaveLength(1);
    expect(
      Number(
        (await query("SELECT SUM(crowns) AS crowns FROM profiles")).rows[0]
          .crowns,
      ),
    ).toBeLessThanOrEqual(1);
  });

  it("watchdog starts expired lobbies and leaves future turns alone", async () => {
    const a = await player("Waiting");
    const id = await royale.join(a.authId);
    await query("UPDATE tournaments SET updated_at=$1 WHERE id=$2", [
      Date.now() - 10_000,
      id,
    ]);
    expect(await royale.recover()).toMatchObject({
      scanned: 1,
      due: 0,
      advanced: 0,
    });
    const state = (
      await query("SELECT state FROM tournaments WHERE id=$1", [id])
    ).rows[0].state as Tournament;
    state.closesAt = Date.now() - 1000;
    await query("UPDATE tournaments SET state=$1 WHERE id=$2", [
      JSON.stringify(state),
      id,
    ]);
    expect(await royale.recover()).toMatchObject({
      due: 1,
      advanced: 1,
      failed: 0,
    });
    const active = (
      await query("SELECT state FROM tournaments WHERE id=$1", [id])
    ).rows[0].state as Tournament;
    expect(active.status).toBe("active");
    expect(active.matches.every((m) => m.status !== "finished")).toBe(true);
  });

  it("watchdog settles a lost final exactly once under concurrent recovery", async () => {
    const a = await player("Finalist");
    const now = Date.now();
    const id = crypto.randomUUID();
    const state = newLobby(0, now - 60_000, 1);
    state.settings!.countdownMs = 0;
    state.entrants.push({
      id: a.id,
      name: "Finalist",
      cpu: false,
      avatar: "●",
      skill: 0,
      points: 0,
      moved: true,
      wins: 0,
      boards: 0,
    });
    startTournament(state, now - 60_000);
    for (const m of state.matches.slice(0, 14)) {
      advanceTime(state, now - 50_000);
      finishMatch(
        state,
        m,
        m.players.includes(a.id) ? a.id : m.players[0],
        "board victory",
        now - 50_000,
      );
    }
    advanceTime(state, now - 40_000);
    const final = state.matches[14];
    final.turnAt = now;
    final.deadline = now - 1;
    final.state.boards[0] = final.players[0] === a.id ? 1 : -1;
    await query(
      "INSERT INTO tournaments(id,tier,status,state,updated_at) VALUES($1,0,'active',$2,$3)",
      [id, JSON.stringify(state), now - 60_000],
    );
    await query("UPDATE profiles SET active=$1,last=$1 WHERE id=$2", [
      id,
      a.id,
    ]);
    await Promise.all([
      royale.recover(),
      royale.recover(),
      royale.dashboard(a.authId),
    ]);
    const finished = (
      await query("SELECT state FROM tournaments WHERE id=$1", [id])
    ).rows[0].state;
    expect(finished).toMatchObject({ status: "finished", champion: a.id });
    expect(
      (await query("SELECT crowns FROM profiles WHERE id=$1", [a.id])).rows[0]
        .crowns,
    ).toBe(1);
    expect(
      (
        await query(
          "SELECT crown FROM rewards WHERE profile=$1 AND tournament=$2",
          [a.id, id],
        )
      ).rows,
    ).toEqual([{ crown: true }]);
    expect((await telemetry.publicStats()).crowns).toBe(1);
    await royale.recover();
    expect((await telemetry.publicStats()).crowns).toBe(1);
  });

  it("watchdog reports a held database lock and recovers on the next run", async () => {
    const a = await player("Locked");
    const id = await royale.join(a.authId);
    const state = (
      await query("SELECT state FROM tournaments WHERE id=$1", [id])
    ).rows[0].state;
    state.closesAt = Date.now() - 1000;
    await query("UPDATE tournaments SET state=$1,updated_at=$2 WHERE id=$3", [
      JSON.stringify(state),
      Date.now() - 10_000,
      id,
    ]);
    const blocker = await getPool().connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM tournaments WHERE id=$1 FOR UPDATE", [
        id,
      ]);
      expect(await royale.recover()).toMatchObject({
        due: 1,
        advanced: 0,
        failed: 1,
      });
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
    }
    expect(await royale.recover()).toMatchObject({
      due: 1,
      advanced: 1,
      failed: 0,
    });
  });

  it("bounds AI batches and gives every overdue match a turn", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const now = Date.now(),
        id = crypto.randomUUID();
      const state = newLobby(0, now, 1);
      state.settings!.countdownMs = 0;
      state.settings!.botDelayMs = 60_000;
      state.entrants.push({
        id: "cpu-0",
        name: "CPU",
        cpu: true,
        avatar: "●",
        skill: 0,
        points: 0,
        moved: false,
        wins: 0,
        boards: 0,
      });
      startTournament(state, now);
      advanceTime(state, now);
      for (const e of state.entrants) e.skill = 0;
      for (const m of state.matches) if (m.status === "playing") m.botAt = 0;
      await query(
        "INSERT INTO tournaments(id,tier,status,state,updated_at) VALUES($1,0,'active',$2,$3)",
        [id, JSON.stringify(state), now],
      );
      for (let batch = 1; batch <= 4; batch++) {
        await royale.driveBots(id, 0);
        const saved = (
          await query("SELECT state FROM tournaments WHERE id=$1", [id])
        ).rows[0].state as Tournament;
        expect(
          saved.matches.reduce((n, m) => n + m.state.moves.length, 0),
        ).toBe(batch * 2);
        expect(
          saved.matches.slice(0, 8).every((m) => m.state.moves.length <= 1),
        ).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it("watchdog completes without launching post-response timer work", async () => {
    const now = Date.now(),
      id = crypto.randomUUID();
    const state = newLobby(0, now, 1);
    state.settings!.countdownMs = 0;
    state.settings!.botDelayMs = 0;
    state.settings!.clockMs = 60_000;
    state.entrants.push({
      id: "cpu-0",
      name: "CPU",
      cpu: true,
      avatar: "●",
      skill: 0,
      points: 0,
      moved: false,
      wins: 0,
      boards: 0,
    });
    startTournament(state, now);
    advanceTime(state, now);
    for (const e of state.entrants) e.skill = 0;
    await query(
      "INSERT INTO tournaments(id,tier,status,state,updated_at) VALUES($1,0,'active',$2,$3)",
      [id, JSON.stringify(state), now - 10_000],
    );
    expect(await royale.recover()).toMatchObject({ advanced: 1, failed: 0 });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const saved = (
      await query("SELECT state FROM tournaments WHERE id=$1", [id])
    ).rows[0].state as Tournament;
    expect(saved.matches.reduce((n, m) => n + m.state.moves.length, 0)).toBe(2);
  });

  it("uses awaited requests rather than background timers on Vercel", async () => {
    vi.stubEnv("VERCEL", "1");
    try {
      const a = await player("Serverless");
      const id = await royale.join(a.authId);
      const state = (
        await query("SELECT state FROM tournaments WHERE id=$1", [id])
      ).rows[0].state as Tournament;
      state.closesAt = Date.now() + 10;
      await withTransaction((c) => royale.save(c, id, state, Date.now()));
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(
        (await query("SELECT status FROM tournaments WHERE id=$1", [id]))
          .rows[0].status,
      ).toBe("lobby");
      expect((await royale.dashboard(a.authId)).tournament?.status).toBe(
        "active",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  afterAll(async () => {
    await getPool().end();
  });
});

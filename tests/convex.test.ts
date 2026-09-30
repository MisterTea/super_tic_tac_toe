/// <reference types="vite/client" />
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { convexTest } from "convex-test";
import betterAuth from "@convex-dev/better-auth/test";
import schema from "../convex/schema";
import * as playerNames from "../lib/player-names";
import { api, internal, components } from "../convex/_generated/api";
import {
  advanceTime,
  COUNTDOWN_MS,
  finishMatch,
  type Tournament,
} from "../lib/royale";

const modules = import.meta.glob("../convex/**/*.ts");
function backend() {
  const t = convexTest(schema, modules);
  betterAuth.register(t);
  return t;
}
async function player(
  t: ReturnType<typeof backend>,
  name = "Guest",
  guest = true,
) {
  const user = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "user",
      data: {
        name,
        email: `${name}@example.invalid`,
        emailVerified: false,
        isAnonymous: guest,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });
  const session = await t.mutation(components.betterAuth.adapter.create, {
    input: {
      model: "session",
      data: {
        userId: user._id,
        token: `token-${name}`,
        expiresAt: Date.now() + 7 * 86400_000,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    },
  });
  const client = t.withIdentity({ subject: user._id, sessionId: session._id });
  const id = await client.mutation(api.royale.ensureProfile, {});
  return { client, id };
}
describe("authoritative Royale backend", () => {
  it("limits the public leaderboard to ten eligible accounts and persists opt-out", async () => {
    const t = backend();
    const accounts = [];
    for (let i = 1; i <= 15; i++) {
      const account = await player(t, `Account${i}`, false);
      await t.run((ctx) => ctx.db.patch(account.id, { points: i * 100 }));
      accounts.push(account);
    }
    const guest = await player(t, "Guest");
    await t.run((ctx) => ctx.db.patch(guest.id, { points: 9999 }));
    const topAccount = accounts[14];
    expect(
      (await topAccount.client.query(api.royale.dashboard, {})).profile
        .leaderboardOptOut,
    ).toBe(false);
    let rows = await t.query(api.leaderboard.top, {});
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
      guest.client.mutation(api.leaderboard.setOptOut, { optOut: true }),
    ).rejects.toThrow("Log in");
    await topAccount.client.mutation(api.leaderboard.setOptOut, {
      optOut: true,
    });
    await topAccount.client.mutation(api.royale.ensureProfile, {});
    await t.mutation(internal.leaderboard.migrate, {});
    expect(
      (await topAccount.client.query(api.royale.dashboard, {})).profile
        .leaderboardOptOut,
    ).toBe(true);
    rows = await t.query(api.leaderboard.top, {});
    expect(rows.map((p) => p.points)).toEqual([
      1400, 1300, 1200, 1100, 1000, 900, 800, 700, 600, 500,
    ]);
    await topAccount.client.mutation(api.leaderboard.setOptOut, {
      optOut: false,
    });
    expect((await t.query(api.leaderboard.top, {}))[0].points).toBe(1500);
  });
  it("breaks leaderboard ties by crowns and XP and retains an account's privacy setting when linking", async () => {
    const t = backend();
    const a = await player(t, "A", false);
    const b = await player(t, "B", false);
    const c = await player(t, "C", false);
    await t.run(async (ctx) => {
      await ctx.db.patch(a.id, { points: 100, crowns: 1, xp: 500 });
      await ctx.db.patch(b.id, { points: 100, crowns: 2, xp: 200 });
      await ctx.db.patch(c.id, { points: 100, crowns: 2, xp: 300 });
    });
    const names = await t.run(async (ctx) =>
      Promise.all([c, b, a].map(async (p) => (await ctx.db.get(p.id))!.name)),
    );
    expect((await t.query(api.leaderboard.top, {})).map((p) => p.name)).toEqual(
      names,
    );
    const guest = await player(t, "Visitor");
    await b.client.mutation(api.leaderboard.setOptOut, { optOut: true });
    const [source, target] = await t.run(async (ctx) => [
      (await ctx.db.get(guest.id))!,
      (await ctx.db.get(b.id))!,
    ]);
    await t.mutation(internal.royale.linkProfiles, {
      from: source.authId,
      to: target.authId,
    });
    expect(
      (await b.client.query(api.royale.dashboard, {})).profile
        .leaderboardOptOut,
    ).toBe(true);
    expect(
      (await t.query(api.leaderboard.top, {})).map((p) => p.name),
    ).not.toContain(target.name);
  });
  it("retries a generated player name already present in the database", async () => {
    const t = backend();
    const account = await player(t, "Account", false);
    await account.client.mutation(api.royale.rename, { name: "Silver Otter" });
    const generator = vi
      .spyOn(playerNames, "generatePlayerName")
      .mockReturnValueOnce("Silver Otter")
      .mockReturnValueOnce("Amber Lynx");
    try {
      const guest = await player(t, "Guest");
      expect(
        (await guest.client.query(api.royale.dashboard, {})).profile.name,
      ).toBe("Amber Lynx");
      expect(generator).toHaveBeenCalledTimes(2);
    } finally {
      generator.mockRestore();
    }
  });
  it("generates two-word player names and rejects case-insensitive duplicate edits", async () => {
    const t = backend();
    const a = await player(t, "AccountA", false);
    const b = await player(t, "AccountB", false);
    const guest = await player(t, "Visitor");
    const first = await a.client.query(api.royale.dashboard, {});
    const second = await b.client.query(api.royale.dashboard, {});
    expect(first.profile.name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    expect(first.profile.name).not.toBe(second.profile.name);
    await a.client.mutation(api.royale.rename, { name: "  Bright   Falcon  " });
    expect((await a.client.query(api.royale.dashboard, {})).profile.name).toBe(
      "Bright Falcon",
    );
    await expect(
      b.client.mutation(api.royale.rename, { name: "bright falcon" }),
    ).rejects.toThrow("already taken");
    await expect(
      guest.client.mutation(api.royale.rename, { name: "Guest Falcon" }),
    ).rejects.toThrow("Log in");
    await expect(
      b.client.mutation(api.royale.rename, { name: "x" }),
    ).rejects.toThrow("3–24");
    await a.client.mutation(api.royale.join, {});
    await expect(
      a.client.mutation(api.royale.rename, { name: "New Falcon" }),
    ).rejects.toThrow("Finish your tournament");
  });
  it("reserves generated CPU names and retries a name already owned by a player", async () => {
    const t = backend();
    const a = await player(t, "Guest");
    const b = await player(t, "Account", false);
    const id = await a.client.mutation(api.royale.join, {});
    const predicted = (await t.query(internal.royale.snapshot, {
      tournament: id,
    }))!.state as Tournament;
    const { startTournament } = await import("../lib/royale");
    startTournament(predicted, Date.now());
    const occupied = predicted.entrants.find((e) => e.cpu)!.name;
    await b.client.mutation(api.royale.rename, { name: occupied });
    vi.advanceTimersByTime(30_000);
    await t.finishInProgressScheduledFunctions();
    const row = await t.query(internal.royale.snapshot, { tournament: id });
    const names = row!.state.entrants.map((e: { name: string }) => e.name);
    expect(new Set(names.map((name: string) => name.toLowerCase())).size).toBe(
      16,
    );
    expect(names).not.toContain(occupied);
    for (const name of names) expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    const claims = await t.run((ctx) => ctx.db.query("nameClaims").collect());
    expect(
      claims.filter((claim) => claim.owner.startsWith(`cpu:${id}:`)),
    ).toHaveLength(15);
    await expect(
      b.client.mutation(api.royale.rename, { name: names[0] }),
    ).rejects.toThrow("already taken");
  });
  it("reserves legacy names and replaces duplicate legacy names during migration", async () => {
    const t = backend();
    const a = await player(t, "A");
    const b = await player(t, "B");
    await t.run(async (ctx) => {
      await ctx.db.patch(a.id, { name: "Legacy Fox" });
      await ctx.db.patch(b.id, { name: "legacy fox" });
    });
    expect((await t.mutation(internal.names.migrate, {})).renamed).toBe(1);
    const names = await t.run(async (ctx) =>
      (await ctx.db.query("profiles").collect()).map((p) =>
        p.name.toLowerCase(),
      ),
    );
    expect(new Set(names).size).toBe(2);
    expect((await t.mutation(internal.names.migrate, {})).renamed).toBe(0);
  });
  beforeAll(async () => {
    const loaders = [
      ...Object.entries(modules),
      ...Object.entries(betterAuth.modules),
    ].filter(([path]) => !path.endsWith(".config.ts"));
    await Promise.all(loaders.map(([, load]) => load()));
  });
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  it("shares lobbies, rejects unauthenticated access, and leaves before lock", async () => {
    const t = backend(),
      a = await player(t, "A"),
      b = await player(t, "B");
    await expect(t.query(api.royale.dashboard, {})).rejects.toThrow(
      "Unauthenticated",
    );
    const room = await a.client.mutation(api.royale.join, {});
    expect(await b.client.mutation(api.royale.join, {})).toBe(room);
    expect(await a.client.mutation(api.royale.join, {})).toBe(room);
    const view = await a.client.query(api.royale.dashboard, {});
    expect(view.tournament?.entrants).toHaveLength(2);
    await b.client.mutation(api.royale.leaveLobby, {});
    expect(
      (await a.client.query(api.royale.dashboard, {})).tournament?.entrants,
    ).toHaveLength(1);
  });
  it("telemetry counts unique and daily players without refresh or retry inflation", async () => {
    const t = backend(),
      a = await player(t, "MetricsA"),
      b = await player(t, "MetricsB");
    await a.client.mutation(api.royale.ensureProfile, {});
    await a.client.mutation(api.royale.ensureProfile, {});
    expect(await t.query(api.telemetry.publicStats, {})).toEqual({
      players: 0,
      games: 0,
      crowns: 0,
    });
    const id = await a.client.mutation(api.royale.join, {});
    await a.client.mutation(api.royale.join, {});
    await a.client.mutation(api.royale.leaveLobby, {});
    const first = await t.query(internal.telemetry.report, {});
    expect(first.totals.lobbyJoins).toBe(1);
    expect(first.totals.lobbyLeaves).toBe(1);
    expect(first.totals.cancelledLobbies).toBe(1);
    expect(first.daily[0].metrics.activePlayerDays).toBe(2);
    vi.setSystemTime(new Date("2026-10-01T00:01:00Z"));
    await a.client.mutation(api.royale.ensureProfile, {});
    const next = await t.query(internal.telemetry.report, {});
    expect(next.daily[0].metrics.activePlayerDays).toBe(1);
    expect(next.daily[0].metrics.returningPlayerDays).toBe(1);
    expect(next.totals.uniquePlayers).toBe(2);
    expect(id).toBeTruthy();
    expect(b.id).toBeTruthy();
  });
  it("telemetry backfills finished brackets and crowns once, excluding CPU players", async () => {
    const t = backend(),
      a = await player(t, "Champion");
    await t.run(async (ctx) => {
      const { newLobby, startTournament } = await import("../lib/royale");
      const state = newLobby(0, Date.now(), 987);
      state.entrants.push({
        id: a.id,
        name: "Champion",
        cpu: false,
        avatar: "●",
        skill: 0,
        points: 0,
        moved: true,
        wins: 0,
        boards: 5,
      });
      startTournament(state, Date.now());
      let now = Date.now() + COUNTDOWN_MS;
      for (let round = 0; round < 4; round++) {
        advanceTime(state, now);
        for (const m of state.matches.filter((m) => m.round === round)) {
          finishMatch(
            state,
            m,
            m.players.includes(a.id) ? a.id : m.players[0],
            "board victory",
            now + 1,
          );
        }
        now += COUNTDOWN_MS + 1;
      }
      const id = await ctx.db.insert("tournaments", {
        tier: 0,
        status: state.status,
        state,
        updatedAt: now,
      });
      await ctx.db.insert("rewards", {
        profile: a.id,
        tournament: id,
        finish: 4,
        delta: 80,
        xp: 250,
        createdAt: now,
      });
    });
    for (let repeat = 0; repeat < 2; repeat++) {
      await t.mutation(internal.telemetry.backfill, {});
      await t.finishAllScheduledFunctions(() => vi.runAllTimers());
      expect(await t.query(api.telemetry.publicStats, {})).toEqual({
        players: 1,
        games: 15,
        crowns: 1,
      });
      const report = await t.query(internal.telemetry.report, {});
      expect(report.totals.tournamentsCompleted).toBe(1);
      expect(report.totals.humanGamesPlayed).toBe(4);
      expect(report.totals.cpuOnlyGamesPlayed).toBe(11);
      expect(report.totals.matchesCompleted).toBe(15);
      expect(report.totals.humanEntries).toBe(1);
      expect(report.totals.cpuEntries).toBe(15);
    }
    await t.run(async (ctx) => {
      const reward = (await ctx.db.query("rewards").first())!;
      await ctx.db.patch(reward._id, { crown: false, xp: 75 });
    });
    await t.mutation(internal.telemetry.backfill, {});
    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect((await t.query(api.telemetry.publicStats, {})).crowns).toBe(0);
  });
  it("starts with CPU fill and persists an eliminated player's reward exactly once", async () => {
    const t = backend(),
      a = await player(t);
    const id = await a.client.mutation(api.royale.join, {});
    vi.advanceTimersByTime(30_000);
    await t.finishInProgressScheduledFunctions();
    let row = await t.query(internal.royale.snapshot, { tournament: id });
    expect(row!.state.entrants).toHaveLength(16);
    expect(row!.state.status).toBe("active");
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(id))!;
      const state = row.state as Tournament;
      const m = state.matches.find((m) => m.players.includes(a.id))!;
      state.entrants.find((e) => e.id === a.id)!.moved = true;
      finishMatch(
        state,
        m,
        m.players.find((p) => p !== a.id)!,
        "board victory",
        Date.now(),
      );
      await ctx.db.patch(id, { state });
    });
    row = await t.query(internal.royale.snapshot, { tournament: id });
    await t.mutation(internal.royale.tick, {
      tournament: id,
      version: row!.state.version,
      moves: [],
    });
    row = await t.query(internal.royale.snapshot, { tournament: id });
    await t.mutation(internal.royale.tick, {
      tournament: id,
      version: row!.state.version,
      moves: [],
    });
    const result = await a.client.query(api.royale.dashboard, {});
    expect(result.profile.xp).toBe(50);
    expect(result.history).toHaveLength(1);
    expect(result.profile.active).toBeUndefined();
    expect(result.view?.phase).toBe("results");
    expect(await a.client.mutation(api.royale.join, {})).not.toBe(id);
  });
  it("rejects spectator and stale moves while clients receive sanitized brackets", async () => {
    const t = backend(),
      a = await player(t, "A"),
      b = await player(t, "B");
    const id = await a.client.mutation(api.royale.join, {});
    vi.advanceTimersByTime(30_000);
    await t.finishInProgressScheduledFunctions();
    vi.advanceTimersByTime(COUNTDOWN_MS);
    await t.finishInProgressScheduledFunctions();
    const view = await a.client.query(api.royale.dashboard, {});
    expect(view.tournament).not.toHaveProperty("seed");
    expect(view.tournament!.matches[0]).not.toHaveProperty("tieSecret");
    const m = view.tournament!.matches.find((m) => m.players.includes(a.id))!;
    await expect(
      b.client.mutation(api.royale.move, {
        tournament: id,
        match: m.id,
        seq: 0,
        action: 0,
      }),
    ).rejects.toThrow("not in this tournament");
    const response = await a.client.mutation(api.royale.move, {
      tournament: id,
      match: m.id,
      seq: 999,
      action: 0,
    });
    expect(response.error).toMatch(/Board changed/);
  });
  it("joining a full human field starts early and spectators follow their sibling", async () => {
    const t = backend();
    const players: Awaited<ReturnType<typeof player>>[] = [];
    for (let i = 0; i < 16; i++) players.push(await player(t, `Player${i}`));
    const id = await players[0].client.mutation(api.royale.join, {});
    for (const p of players.slice(1))
      await p.client.mutation(api.royale.join, {});
    let row = await t.query(internal.royale.snapshot, { tournament: id });
    expect(row!.state.status).toBe("active");
    expect(row!.state.entrants.some((e: { cpu: boolean }) => e.cpu)).toBe(
      false,
    );
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(id))!,
        state = row.state as Tournament;
      advanceTime(state, Date.now() + COUNTDOWN_MS);
      finishMatch(
        state,
        state.matches[0],
        players.find((p) => state.matches[0].players.includes(p.id))!.id,
        "board victory",
        Date.now(),
      );
      await ctx.db.patch(id, { state });
    });
    row = await t.query(internal.royale.snapshot, { tournament: id });
    const winner = players.find((p) => p.id === row!.state.matches[0].winner)!;
    const view = await winner.client.query(api.royale.dashboard, {});
    expect(view.view).toEqual({
      phase: "spectating",
      matchId: 1,
      nextRound: 1,
    });
  });
  it("stale scheduled jobs cannot replay results or moves", async () => {
    const t = backend(),
      a = await player(t);
    const id = await a.client.mutation(api.royale.join, {});
    const row = await t.query(internal.royale.snapshot, { tournament: id });
    await t.mutation(internal.royale.tick, {
      tournament: id,
      version: row!.state.version - 1,
      moves: [{ match: 0, seq: 0, action: 40 }],
    });
    expect(await t.query(internal.royale.snapshot, { tournament: id })).toEqual(
      row,
    );
  });
  it("account linking preserves saved progress and blocks active players", async () => {
    const t = backend(),
      a = await player(t, "Guest"),
      b = await player(t, "Account");
    const [source, target] = await t.run(async (ctx) => {
      const source = (await ctx.db.get(a.id))!,
        target = (await ctx.db.get(b.id))!;
      await ctx.db.patch(a.id, {
        points: 350,
        xp: 250,
        cosmetics: ["unlock-2"],
      });
      return [source, target];
    });
    const id = await a.client.mutation(api.royale.join, {});
    await expect(
      t.mutation(internal.royale.linkProfiles, {
        from: source.authId,
        to: target.authId,
      }),
    ).rejects.toThrow("Finish your tournament");
    await a.client.mutation(api.royale.leaveLobby, {});
    await t.run(async (ctx) => {
      await ctx.db.insert("rewards", {
        profile: a.id,
        tournament: id,
        finish: 4,
        delta: 80,
        xp: 250,
        createdAt: Date.now(),
      });
    });
    await t.mutation(internal.royale.linkProfiles, {
      from: source.authId,
      to: target.authId,
    });
    expect(
      (await t.query(internal.telemetry.report, {})).totals.uniquePlayers,
    ).toBe(1);
    expect(
      (await t.query(internal.telemetry.report, {})).totals.activePlayerDays,
    ).toBe(1);
    const view = await b.client.query(api.royale.dashboard, {});
    expect(view.profile.points).toBe(350);
    expect(view.profile.xp).toBe(250);
    expect(view.profile.crowns).toBe(1);
    expect(view.profile.cosmetics).toContain("unlock-2");
    await t.mutation(internal.royale.linkProfiles, {
      from: source.authId,
      to: target.authId,
    });
    expect((await b.client.query(api.royale.dashboard, {})).profile.xp).toBe(
      250,
    );
  });
  it("ten independent active brackets settle rewards without duplication", async () => {
    const t = backend();
    const entrants: Awaited<ReturnType<typeof player>>[] = [];
    for (let i = 0; i < 10; i++) entrants.push(await player(t, `Load${i}`));
    const rows = await t.run(async (ctx) => {
      const ids = [];
      for (const p of entrants) {
        const { newLobby, startTournament } = await import("../lib/royale");
        const state = newLobby(0, Date.now(), ids.length + 12);
        state.entrants.push({
          id: p.id,
          name: "Load player",
          cpu: false,
          avatar: "●",
          skill: 0,
          points: 0,
          moved: true,
          boards: 1,
          wins: 0,
        });
        startTournament(state, Date.now());
        const m = state.matches.find((m) => m.players.includes(p.id))!;
        finishMatch(
          state,
          m,
          m.players.find((id) => id !== p.id)!,
          "board victory",
          Date.now(),
        );
        const id = await ctx.db.insert("tournaments", {
          status: state.status,
          tier: 0,
          state,
          updatedAt: Date.now(),
        });
        await ctx.db.patch(p.id, { last: id, active: id });
        ids.push({ tournament: id, version: state.version, moves: [] });
      }
      return ids;
    });
    await Promise.all(rows.map((row) => t.mutation(internal.royale.tick, row)));
    await Promise.all(rows.map((row) => t.mutation(internal.royale.tick, row)));
    for (const p of entrants) {
      const data = await p.client.query(api.royale.dashboard, {});
      expect(data.history).toHaveLength(1);
      expect(data.profile.xp).toBe(50);
    }
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
    const t = backend();
    await t.mutation(api.feedback.send, input);
    await t.mutation(api.feedback.send, input);
    const rows = await t.run((ctx) => ctx.db.query("feedback").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      message: "Please add a rematch option.",
      category: "Idea",
      page: "/practice",
    });
    expect(rows[0].email).toBeUndefined();
  });
  it("validates content, discards honeypot spam, and limits repeated submissions", async () => {
    const t = backend();
    await t.mutation(api.feedback.send, { ...input, website: "spam" });
    expect(
      await t.run((ctx) => ctx.db.query("feedback").collect()),
    ).toHaveLength(0);
    await expect(
      t.mutation(api.feedback.send, { ...input, message: "short" }),
    ).rejects.toThrow("characters");
    await expect(
      t.mutation(api.feedback.send, { ...input, email: "bad" }),
    ).rejects.toThrow("valid email");
    for (let i = 2; i <= 4; i++)
      await t.mutation(api.feedback.send, {
        ...input,
        request: `00000000-0000-4000-8000-00000000000${i}`,
      });
    await expect(
      t.mutation(api.feedback.send, {
        ...input,
        request: "00000000-0000-4000-8000-000000000005",
      }),
    ).rejects.toThrow("wait an hour");
  });
});

describe("growth features", () => {
  it("isolates friend rooms, authorizes the host, transfers hosting, and fills the bracket", async () => {
    const t = backend(),
      a = await player(t, "RoomHost"),
      b = await player(t, "RoomFriend"),
      c = await player(t, "RankedPlayer");
    const code = await a.client.mutation(api.growth.host, {});
    expect(code).toMatch(/^[a-z2-9]{10}$/);
    const friendId = await b.client.mutation(api.royale.join, {
      roomCode: code,
    });
    const publicId = await c.client.mutation(api.royale.join, {});
    expect(publicId).not.toBe(friendId);
    expect(
      (await b.client.query(api.royale.dashboard, {})).tournament?.entrants,
    ).toHaveLength(2);
    await expect(b.client.mutation(api.growth.start, {})).rejects.toThrow(
      "Only the lobby host",
    );
    await a.client.mutation(api.royale.leaveLobby, {});
    expect((await b.client.query(api.royale.dashboard, {})).isHost).toBe(true);
    await b.client.mutation(api.growth.start, {});
    const data = await b.client.query(api.royale.dashboard, {});
    expect(data.tournament?.entrants).toHaveLength(16);
    expect(
      (await t.run((ctx) => ctx.db.get(friendId)))?.state.settings.rankDeltas,
    ).toEqual([0, 0, 0, 0, 0]);
    await expect(
      a.client.mutation(api.royale.join, { roomCode: code }),
    ).rejects.toThrow("already started");
  });
  it("saves first-touch attribution once and counts conversions at join", async () => {
    const t = backend(),
      a = await player(t, "Referral");
    await a.client.mutation(api.growth.attribute, {
      source: "YouTube",
      campaign: "creator_one",
    });
    await a.client.mutation(api.growth.attribute, {
      source: "direct",
      campaign: "none",
    });
    expect(
      (await a.client.query(api.royale.dashboard, {})).profile.acquisition
        ?.source,
    ).toBe("youtube");
    await a.client.mutation(api.royale.join, {});
    const report = await t.query(internal.growth.report, {});
    expect(report.campaigns.find((c) => c.source === "youtube")).toMatchObject({
      campaign: "creator_one",
      visitors: 1,
      entries: 1,
    });
  });
  it("checks every daily position and persists guesses without awarding rank or crowns", async () => {
    const { dailyPosition, utcDay } = await import("../lib/daily");
    const { legal, play } = await import("../lib/game");
    for (let i = 0; i < 64; i++) {
      const state = dailyPosition(utcDay(Date.now() + i * 86400_000));
      expect(
        legal(state).filter((a) => play(state, a).winner === state.turn),
      ).toHaveLength(1);
    }
    const t = backend(),
      a = await player(t, "DailyPlayer");
    const today = await a.client.query(api.daily.today, {});
    expect(today.solution).toBeUndefined();
    const solution = legal(today.state).find(
      (a) => play(today.state, a).winner === today.state.turn,
    )!;
    const wrong = legal(today.state).find((a) => a !== solution)!;
    await a.client.mutation(api.daily.attempt, {
      day: today.day,
      action: wrong,
    });
    await expect(
      a.client.mutation(api.daily.attempt, { day: today.day, action: wrong }),
    ).rejects.toThrow("already tried");
    await expect(
      a.client.mutation(api.daily.attempt, {
        day: "2000-01-01",
        action: solution,
      }),
    ).rejects.toThrow("new daily");
    await a.client.mutation(api.daily.attempt, {
      day: today.day,
      action: solution,
    });
    await a.client.mutation(api.daily.attempt, {
      day: today.day,
      action: solution,
    });
    const done = await a.client.query(api.daily.today, {});
    expect(done).toMatchObject({ solved: true, done: true, solution });
    expect(done.attempts).toHaveLength(2);
    const p = (await a.client.query(api.royale.dashboard, {})).profile;
    expect([p.xp, p.crowns, p.points]).toEqual([0, 0, 0]);
  });
  it("publishes only an authorized result snapshot and deduplicates share cards", async () => {
    const t = backend(),
      a = await player(t, "Sharer"),
      b = await player(t, "OtherSharer");
    const id = await a.client.mutation(api.royale.join, {});
    await expect(
      b.client.mutation(api.growth.shareResult, { tournament: id }),
    ).rejects.toThrow("isn't ready");
    await t.run(async (ctx) => {
      const row = (await ctx.db.get(id))!;
      const state = row.state as Tournament;
      state.entrants[0].finish = 0;
      await ctx.db.patch(id, { state });
      await ctx.db.insert("rewards", {
        profile: a.id,
        tournament: id,
        finish: 0,
        delta: 0,
        xp: 0,
        crown: false,
        createdAt: Date.now(),
      });
    });
    const token = await a.client.mutation(api.growth.shareResult, {
      tournament: id,
    });
    expect(
      await a.client.mutation(api.growth.shareResult, { tournament: id }),
    ).toBe(token);
    const result = await t.query(api.growth.sharedResult, { token });
    expect(Object.keys(result!).sort()).toEqual([
      "crown",
      "delta",
      "finish",
      "name",
      "rounds",
      "wins",
    ]);
    expect(
      await t.query(api.growth.sharedResult, { token: "not-a-token" }),
    ).toBeNull();
  });
});

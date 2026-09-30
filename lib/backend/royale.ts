import type { PoolClient } from "pg";
import { query, withTransaction } from "../db";
import { claimName, generatedName } from "./names";
import { displayName } from "../player-names";
import {
  activity,
  mergeActivity,
  observeProfile,
  observeReward,
  observeTournament,
  recordEvent,
} from "./telemetry";
import {
  advanceTime,
  DEFAULT_SETTINGS,
  cosmetics,
  levelFor,
  newLobby,
  nextWake,
  placementReward,
  playerView,
  publicTournament,
  resign as resignPlayer,
  startTournament,
  submitMove,
  tierIndex,
  type Tournament,
  seeded,
} from "../royale";
import { skillMove, type SkillModel } from "../skill";
import model from "../../public/skill-policy.json";

export class ApiError extends Error {
  data?: any;
  constructor(message: string, data?: any) {
    super(message);
    this.name = "ApiError";
    this.data = data ?? message;
  }
}

export const day = (now: number) => new Date(now).toISOString().slice(0, 10);

export async function getProfileByAuthId(
  authId: string,
  client?: PoolClient | null,
) {
  const q = client ? client.query.bind(client) : query;
  const res = await q("SELECT * FROM profiles WHERE auth_id = $1", [authId]);
  if (!res.rows[0]) throw new ApiError("Create a player profile first");
  const row = res.rows[0];
  return {
    ...row,
    _id: row.id,
    authId: row.auth_id,
    lastVisitDay: row.last_visit_day,
    leaderboardOptOut: row.leaderboard_opt_out,
    leaderboardEligible: row.leaderboard_eligible,
    joinedAt: Number(row.joined_at),
    playedAt: row.played_at !== null ? Number(row.played_at) : undefined,
  };
}

export async function settle(
  client: PoolClient,
  id: string,
  t: Tournament,
  now: number,
) {
  for (const e of t.entrants) {
    if (e.cpu || e.finish === undefined) continue;
    const profileId = e.id;
    const prior = await client.query(
      "SELECT 1 FROM rewards WHERE profile = $1 AND tournament = $2",
      [profileId, id],
    );
    if (prior.rows.length > 0) continue;
    const pRes = await client.query("SELECT * FROM profiles WHERE id = $1", [
      profileId,
    ]);
    const p = pRes.rows[0];
    if (!p) continue;

    const reward = placementReward(e, t.settings || DEFAULT_SETTINGS)!;
    const qRes = await client.query(
      "SELECT * FROM quests WHERE profile = $1 AND day = $2",
      [p.id, day(now)],
    );
    const existing = qRes.rows[0];
    const quest = {
      completed: (existing?.completed || 0) + (reward.completed ? 1 : 0),
      boards: (existing?.boards || 0) + (reward.completed ? reward.boards : 0),
      wins: (existing?.wins || 0) + (reward.completed ? reward.wins : 0),
      claimed: [...(existing?.claimed || [])],
    };
    let bonus = 0;
    for (const [key, value, goal] of [
      ["completed", quest.completed, 2],
      ["boards", quest.boards, 5],
      ["wins", quest.wins, 1],
    ] as const) {
      if (value >= goal && !quest.claimed.includes(key)) {
        quest.claimed.push(key);
        bonus += (t.settings || DEFAULT_SETTINGS).questXp;
      }
    }
    if (existing) {
      await client.query(
        "UPDATE quests SET completed = $1, boards = $2, wins = $3, claimed = $4 WHERE id = $5",
        [quest.completed, quest.boards, quest.wins, JSON.stringify(quest.claimed), existing.id],
      );
    } else {
      const qId = crypto.randomUUID();
      await client.query(
        "INSERT INTO quests (id, profile, day, completed, boards, wins, claimed) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [qId, p.id, day(now), quest.completed, quest.boards, quest.wins, JSON.stringify(quest.claimed)],
      );
    }

    const xp = p.xp + reward.xp + bonus;
    const unlocked = cosmetics
      .filter((c) => c.level <= levelFor(xp))
      .map((c) => c.id);
    const allCosmetics = [...new Set([...(p.cosmetics || []), ...unlocked])];
    const newPoints = Math.max(0, p.points + reward.delta);
    const newCrowns = p.crowns + (reward.crown ? 1 : 0);
    const activeUpdate = p.active === id ? null : p.active;

    await client.query(
      `UPDATE profiles
       SET points = $1, xp = $2, crowns = $3, cosmetics = $4, active = $5
       WHERE id = $6`,
      [newPoints, xp, newCrowns, JSON.stringify(allCosmetics), activeUpdate, p.id],
    );

    const rewardId = crypto.randomUUID();
    await client.query(
      `INSERT INTO rewards (id, profile, tournament, finish, delta, xp, created_at, crown, entrant)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        rewardId,
        p.id,
        id,
        e.finish,
        reward.delta,
        reward.xp + bonus,
        now,
        reward.crown,
        e.id,
      ],
    );

    const rewardRow = (
      await client.query("SELECT * FROM rewards WHERE id = $1", [rewardId])
    ).rows[0];
    await observeReward(client, rewardRow);

    if (p.acquisition) {
      await recordEvent(client, {
        kind: `source_result:${p.acquisition.source}:${p.acquisition.campaign}`,
        tournament: id,
        at: now,
      });
    }
    await recordEvent(client, {
      kind: "result",
      tournament: id,
      at: now,
      value: e.finish,
    });
  }
}

const wakeTimers = new Map<string, NodeJS.Timeout>();

export async function save(
  client: PoolClient,
  id: string,
  t: Tournament,
  now: number,
) {
  const prevRes = await client.query("SELECT state FROM tournaments WHERE id = $1", [id]);
  const previous = prevRes.rows[0]?.state as Tournament | undefined;

  if (previous?.status === "lobby" && t.status === "active") {
    for (const entrant of t.entrants) {
      if (!entrant.cpu) continue;
      const owner = `cpu:${id}:${entrant.id}`;
      if (!(await claimName(client, entrant.name, owner))) {
        entrant.name = await generatedName(client, owner);
      }
    }
    await recordEvent(client, {
      kind: "queue_ms",
      tournament: id,
      at: now,
      value: now - t.createdAt,
    });
    await recordEvent(client, {
      kind: "cpu_count",
      tournament: id,
      at: now,
      value: t.entrants.filter((e) => e.cpu).length,
    });
  }

  if (previous?.status !== "finished" && t.status === "finished") {
    await recordEvent(client, {
      kind: "tournament_complete",
      tournament: id,
      at: now,
      value: now - t.createdAt,
    });
  }

  for (const m of t.matches) {
    if (
      m.feeders.length &&
      m.status === "countdown" &&
      previous?.matches[m.id]?.status === "pending"
    ) {
      for (const feeder of m.feeders) {
        await recordEvent(client, {
          kind: "spectator_wait_ms",
          tournament: id,
          at: now,
          value: Math.max(0, now - (t.matches[feeder].finishedAt || now)),
        });
      }
    }
  }

  await settle(client, id, t, now);
  await observeTournament(client, id, t, previous);
  await client.query(
    "UPDATE tournaments SET status = $1, state = $2, updated_at = $3 WHERE id = $4",
    [t.status, JSON.stringify(t), now, id],
  );

  const wake = nextWake(t, now);
  if (wake !== null) {
    scheduleBotDrive(id, t.version, Math.max(0, wake - now));
  }
}

export function scheduleBotDrive(id: string, version: number, delayMs: number) {
  const existing = wakeTimers.get(id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    wakeTimers.delete(id);
    void driveBots(id, version);
  }, Math.min(delayMs, 2147483647));
  wakeTimers.set(id, timer);
}

export async function driveBots(tournamentId: string, version: number) {
  await withTransaction(async (client) => {
    const rowRes = await client.query(
      "SELECT * FROM tournaments WHERE id = $1 FOR UPDATE",
      [tournamentId],
    );
    const row = rowRes.rows[0];
    if (!row) return;
    const t = row.state as Tournament;
    if (t.version !== version) return;
    const now = Date.now();
    advanceTime(t, now);

    const moves: { match: number; seq: number; action: number }[] = [];
    for (const m of t.matches) {
      if (m.status !== "playing" || m.botAt > now) continue;
      const entrant = t.entrants.find(
        (e) => e.id === m.players[m.state.turn === 1 ? 0 : 1],
      );
      if (entrant?.cpu) {
        moves.push({
          match: m.id,
          seq: m.state.moves.length,
          action: skillMove(
            m.state,
            entrant.skill,
            model as SkillModel,
            seeded(t.seed + m.id * 1000 + m.version),
          ),
        });
      }
    }

    for (const move of moves) {
      const m = t.matches[move.match];
      if (
        !m ||
        m.status !== "playing" ||
        m.state.moves.length !== move.seq ||
        m.botAt > now
      )
        continue;
      const player = m.players[m.state.turn === 1 ? 0 : 1];
      if (t.entrants.find((e) => e.id === player)?.cpu) {
        submitMove(t, m.id, player, move.seq, move.action, now);
      }
    }

    t.version++;
    await save(client, tournamentId, t, now);
  });
}

export async function ensureProfile(authId: string, isAnonymous = false) {
  return withTransaction(async (client) => {
    // Serialize first visits for this account before checking for a profile.
    await client.query('SELECT id FROM "user" WHERE id = $1 FOR UPDATE', [authId]);
    const existingRes = await client.query(
      "SELECT * FROM profiles WHERE auth_id = $1",
      [authId],
    );
    const existing = existingRes.rows[0];
    const now = Date.now();
    const currentDay = day(now);

    if (existing) {
      const updates: string[] = [];
      const params: any[] = [];
      let pIdx = 1;

      if (existing.last_visit_day !== currentDay) {
        updates.push(`last_visit_day = $${pIdx++}`);
        params.push(currentDay);
        await recordEvent(client, { kind: "daily_return", at: now });
      }
      if (!isAnonymous && !existing.leaderboard_eligible && !existing.leaderboard_opt_out) {
        updates.push(`leaderboard_eligible = true`);
      }
      if (updates.length > 0) {
        params.push(existing.id);
        await client.query(
          `UPDATE profiles SET ${updates.join(", ")} WHERE id = $${pIdx}`,
          params,
        );
      }
      await activity(client, existing, now);
      return existing.id;
    }

    const id = crypto.randomUUID();
    const name = await generatedName(client, id);
    await client.query(
      `INSERT INTO profiles (
        id, auth_id, name, leaderboard_eligible, points, xp, crowns,
        cosmetics, equipped, joined_at, last_visit_day
      ) VALUES ($1, $2, $3, $4, 0, 0, 0, '[]'::jsonb, '{"theme":"default","title":"default","effect":"default"}'::jsonb, $5, $6)`,
      [id, authId, name, !isAnonymous, now, currentDay],
    );

    const created = (
      await client.query("SELECT * FROM profiles WHERE id = $1", [id])
    ).rows[0];
    await observeProfile(client, created);
    await activity(client, created, now);
    return id;
  });
}

export async function rename(authId: string, rawName: string, isAnonymous = false) {
  if (isAnonymous) throw new ApiError("Log in to change your player name.");
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    if (p.active) {
      throw new ApiError("Finish your tournament before changing your name.");
    }
    let name: string;
    try {
      name = displayName(rawName);
    } catch (e) {
      throw new ApiError(e instanceof Error ? e.message : "Invalid player name.");
    }
    if (!(await claimName(client, name, p.id))) {
      throw new ApiError("That player name is already taken.");
    }
    await client.query("UPDATE profiles SET name = $1 WHERE id = $2", [name, p.id]);
    return name;
  });
}

export async function equip(authId: string, cosmeticId: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    const item = cosmetics.find((c) => c.id === cosmeticId);
    if (!item || !(p.cosmetics || []).includes(cosmeticId)) {
      throw new Error("Cosmetic is locked");
    }
    const equipped = { ...(p.equipped || {}), [item.kind]: cosmeticId };
    await client.query("UPDATE profiles SET equipped = $1 WHERE id = $2", [
      JSON.stringify(equipped),
      p.id,
    ]);
  });
}

export async function dashboard(authId: string) {
  const p = await getProfileByAuthId(authId);
  const tournamentId = p.active || p.last;
  let tournamentRow = null;
  if (tournamentId) {
    const res = await query("SELECT * FROM tournaments WHERE id = $1", [tournamentId]);
    tournamentRow = res.rows[0];
  }
  const t = tournamentRow?.state as Tournament | undefined;

  // If match or bots need driving, drive if botAt has passed
  if (t && t.status === "active") {
    const now = Date.now();
    const needsDrive = t.matches.some(
      (m) =>
        m.status === "playing" &&
        m.botAt <= now &&
        t.entrants.find((e) => e.id === m.players[m.state.turn === 1 ? 0 : 1])?.cpu,
    );
    if (needsDrive) {
      void driveBots(tournamentId!, t.version);
    }
  }

  const history = (
    await query(
      "SELECT * FROM rewards WHERE profile = $1 ORDER BY created_at DESC LIMIT 10",
      [p.id],
    )
  ).rows;

  const questsRes = await query(
    "SELECT * FROM quests WHERE profile = $1 AND day = $2",
    [p.id, day(Date.now())],
  );
  const quests = questsRes.rows[0] || null;

  return {
    profile: {
      _id: p.id,
      id: p.id,
      name: p.name,
      points: p.points,
      xp: p.xp,
      crowns: p.crowns,
      cosmetics: p.cosmetics || [],
      equipped: p.equipped,
      active: p.active,
      last: p.last,
      joinedAt: p.joinedAt,
      lastVisitDay: p.lastVisitDay,
      playedAt: p.playedAt,
      leaderboardOptOut: p.leaderboardOptOut,
      leaderboardEligible: p.leaderboardEligible,
      acquisition: p.acquisition,
    },
    tournament: t ? { id: tournamentId, ...publicTournament(t) } : null,
    view: t ? playerView(t, p.id) : null,
    history: history.map((r) => ({
      _id: r.id,
      id: r.id,
      profile: r.profile,
      tournament: r.tournament,
      finish: r.finish,
      delta: r.delta,
      xp: r.xp,
      createdAt: Number(r.created_at),
      crown: r.crown,
      entrant: r.entrant,
    })),
    quests: quests
      ? {
          _id: quests.id,
          id: quests.id,
          profile: quests.profile,
          day: quests.day,
          completed: quests.completed,
          boards: quests.boards,
          wins: quests.wins,
          claimed: quests.claimed,
        }
      : null,
    serverNow: Date.now(),
    roomCode: tournamentRow?.room_code,
    isHost: tournamentRow?.host === p.id,
  };
}

export async function join(authId: string, roomCode?: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    const now = Date.now();

    if (p.active) {
      if (roomCode) {
        const activeT = (
          await client.query("SELECT room_code FROM tournaments WHERE id = $1", [
            p.active,
          ])
        ).rows[0];
        if (activeT?.room_code !== roomCode) {
          throw new ApiError("Leave your current lobby or finish your Royale first.");
        }
      }
      return p.active;
    }

    await activity(client, p, now);

    if (p.last) {
      const last = (
        await client.query(
          "SELECT created_at FROM rewards WHERE profile = $1 AND tournament = $2",
          [p.id, p.last],
        )
      ).rows[0];
      if (last && now - Number(last.created_at) < 120_000) {
        await recordEvent(client, {
          kind: "immediate_requeue",
          at: now,
          value: now - Number(last.created_at),
        });
      }
    }

    const tier = tierIndex(p.points);
    let roomRow: any = null;

    if (roomCode) {
      const res = await client.query(
        "SELECT * FROM tournaments WHERE room_code = $1 FOR UPDATE",
        [roomCode],
      );
      roomRow = res.rows[0];
      if (
        !roomRow ||
        roomRow.status !== "lobby" ||
        (roomRow.state as Tournament).closesAt <= now ||
        (roomRow.state as Tournament).entrants.length >= 16
      ) {
        throw new ApiError(
          "This friend lobby has already started or closed. Host a new Royale together.",
        );
      }
    } else {
      const candidates = (
        await client.query(
          "SELECT * FROM tournaments WHERE status = 'lobby' AND tier = $1 AND room_code IS NULL FOR UPDATE",
          [tier],
        )
      ).rows;
      roomRow = candidates.find(
        (r) =>
          (r.state as Tournament).closesAt > now &&
          (r.state as Tournament).entrants.length < 16,
      );
    }

    if (!roomRow) {
      const id = crypto.randomUUID();
      const state = newLobby(tier, now, Math.floor(Math.random() * 2 ** 32));
      await client.query(
        "INSERT INTO tournaments (id, tier, status, state, updated_at) VALUES ($1, $2, 'lobby', $3, $4)",
        [id, tier, JSON.stringify(state), now],
      );
      roomRow = (
        await client.query("SELECT * FROM tournaments WHERE id = $1", [id])
      ).rows[0];
      await observeTournament(client, id, roomRow.state as Tournament);
    }

    const t = roomRow.state as Tournament;
    if (!t.entrants.some((e) => e.id === p.id)) {
      t.entrants.push({
        id: p.id,
        name: p.name,
        avatar: "●",
        cpu: false,
        skill: 0,
        points: p.points,
        moved: false,
        wins: 0,
        boards: 0,
      });
      await client.query("UPDATE profiles SET active = $1, last = $1 WHERE id = $2", [
        roomRow.id,
        p.id,
      ]);
      await recordEvent(client, { kind: "join", tournament: roomRow.id, at: now });
      if (p.acquisition) {
        await recordEvent(client, {
          kind: `source_join:${p.acquisition.source}:${p.acquisition.campaign}`,
          tournament: roomRow.id,
          at: now,
        });
      }
      if (t.entrants.length === 16 && !roomRow.room_code) {
        startTournament(t, now);
      }
      await save(client, roomRow.id, t, now);
    }

    return roomRow.id;
  });
}

export async function leaveLobby(authId: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    const now = Date.now();
    if (!p.active) return;
    const res = await client.query(
      "SELECT * FROM tournaments WHERE id = $1 FOR UPDATE",
      [p.active],
    );
    const row = res.rows[0];
    if (!row || row.status !== "lobby") return;
    const t = row.state as Tournament;
    const index = t.entrants.findIndex((e) => e.id === p.id);
    if (index === -1) return;
    t.entrants.splice(index, 1);
    await client.query("UPDATE profiles SET active = NULL WHERE id = $1", [p.id]);
    await recordEvent(client, { kind: "lobby_leave", tournament: row.id, at: now });

    if (!t.entrants.length) {
      await client.query(
        "UPDATE tournaments SET status = 'cancelled', updated_at = $1 WHERE id = $2",
        [now, row.id],
      );
      await observeTournament(client, row.id, { ...t, status: "cancelled" }, t);
    } else {
      if (row.host === p.id) {
        const nextHost = t.entrants.find((e) => !e.cpu);
        if (nextHost) {
          await client.query("UPDATE tournaments SET host = $1 WHERE id = $2", [
            nextHost.id,
            row.id,
          ]);
        }
      }
      await save(client, row.id, t, now);
    }
  });
}

export async function move(
  authId: string,
  tournamentId: string,
  matchId: number,
  seq: number,
  action: number,
) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    const res = await client.query(
      "SELECT * FROM tournaments WHERE id = $1 FOR UPDATE",
      [tournamentId],
    );
    const row = res.rows[0];
    if (!row) throw new ApiError("Tournament not found.");
    const t = row.state as Tournament;
    const entrant = t.entrants.find((e) => e.id === p.id);
    if (!entrant) throw new ApiError("You are not in this Royale.");
    const now = Date.now();
    advanceTime(t, now);
    const m = t.matches[matchId];
    if (!m || !m.players.includes(p.id)) {
      throw new ApiError("Match not found.");
    }
    if (m.status !== "playing") {
      throw new ApiError("This match is not accepting moves.");
    }
    if (m.state.turn !== (m.players[0] === p.id ? 1 : -1)) {
      throw new ApiError("It is not your turn.");
    }
    if (m.state.moves.length !== seq) {
      throw new ApiError("Move sequence mismatch.");
    }
    submitMove(t, m.id, p.id, seq, action, now);
    await save(client, row.id, t, now);
  });
}

export async function resign(authId: string, tournamentId: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    const res = await client.query(
      "SELECT * FROM tournaments WHERE id = $1 FOR UPDATE",
      [tournamentId],
    );
    const row = res.rows[0];
    if (!row) throw new ApiError("Tournament not found.");
    const t = row.state as Tournament;
    const entrant = t.entrants.find((e) => e.id === p.id);
    if (!entrant) throw new ApiError("You are not in this Royale.");
    const now = Date.now();
    advanceTime(t, now);
    resignPlayer(t, p.id, now);
    await save(client, row.id, t, now);
  });
}

export async function linkProfiles(fromAuthId: string, toAuthId: string) {
  if (fromAuthId === toAuthId) return;
  return withTransaction(async (client) => {
    const sRes = await client.query(
      "SELECT * FROM profiles WHERE auth_id = $1 FOR UPDATE",
      [fromAuthId],
    );
    const source = sRes.rows[0];
    const tRes = await client.query(
      "SELECT * FROM profiles WHERE auth_id = $1 FOR UPDATE",
      [toAuthId],
    );
    const target = tRes.rows[0];
    if (!source) return;

    const userRes = await client.query('SELECT * FROM "user" WHERE id = $1', [
      toAuthId,
    ]);
    const user = userRes.rows[0];
    const eligible = !!user && !user.isAnonymous;

    if (source.active || target?.active) {
      throw new Error("Finish your tournament before linking accounts");
    }

    if (!target) {
      await client.query(
        "UPDATE profiles SET auth_id = $1, leaderboard_eligible = $2 WHERE id = $3",
        [toAuthId, eligible && !source.leaderboard_opt_out, source.id],
      );
      return;
    }

    const rewards = (
      await client.query("SELECT * FROM rewards WHERE profile = $1", [source.id])
    ).rows;
    let xp = 0;
    let crowns = 0;
    for (const r of rewards) {
      const dup = await client.query(
        "SELECT 1 FROM rewards WHERE profile = $1 AND tournament = $2",
        [target.id, r.tournament],
      );
      if (dup.rows.length === 0) {
        xp += Number(r.xp);
        if (r.crown || (r.finish === 4 && Number(r.xp) > 0)) crowns++;
        await client.query(
          "UPDATE rewards SET profile = $1, entrant = $2 WHERE id = $3",
          [target.id, r.entrant ?? source.id, r.id],
        );
      }
    }

    const quests = (
      await client.query("SELECT * FROM quests WHERE profile = $1", [source.id])
    ).rows;
    for (const quest of quests) {
      const otherRes = await client.query(
        "SELECT * FROM quests WHERE profile = $1 AND day = $2",
        [target.id, quest.day],
      );
      const other = otherRes.rows[0];
      if (!other) {
        await client.query("UPDATE quests SET profile = $1 WHERE id = $2", [
          target.id,
          quest.id,
        ]);
      } else {
        const mergedClaimed = [
          ...new Set([...(other.claimed || []), ...(quest.claimed || [])]),
        ];
        await client.query(
          "UPDATE quests SET completed = $1, boards = $2, wins = $3, claimed = $4 WHERE id = $5",
          [
            other.completed + quest.completed,
            other.boards + quest.boards,
            other.wins + quest.wins,
            JSON.stringify(mergedClaimed),
            other.id,
          ],
        );
      }
    }

    const unlocked = [
      ...new Set([...(target.cosmetics || []), ...(source.cosmetics || [])]),
    ];
    const dailyRuns = (
      await client.query("SELECT * FROM daily_attempts WHERE profile = $1", [
        source.id,
      ])
    ).rows;
    for (const run of dailyRuns) {
      const otherRes = await client.query(
        "SELECT * FROM daily_attempts WHERE profile = $1 AND day = $2",
        [target.id, run.day],
      );
      const other = otherRes.rows[0];
      if (!other) {
        await client.query(
          "UPDATE daily_attempts SET profile = $1 WHERE id = $2",
          [target.id, run.id],
        );
      } else {
        const best = [run, other]
          .filter((r) => r.solved)
          .sort((a, b) => a.attempts.length - b.attempts.length)[0];
        const mergedAttempts =
          best?.attempts ??
          [...new Set([...(other.attempts || []), ...(run.attempts || [])])].slice(
            0,
            3,
          );
        await client.query(
          "UPDATE daily_attempts SET solved = $1, attempts = $2 WHERE id = $3",
          [!!best, JSON.stringify(mergedAttempts), other.id],
        );
        await client.query("DELETE FROM daily_attempts WHERE id = $1", [run.id]);
      }
    }

    const playedAt =
      source.played_at === null
        ? target.played_at
        : Math.min(
            Number(source.played_at),
            target.played_at !== null
              ? Number(target.played_at)
              : Number(source.played_at),
          );

    await client.query(
      `UPDATE profiles
       SET points = $1, xp = $2, crowns = $3, cosmetics = $4,
           leaderboard_eligible = $5, played_at = $6, acquisition = $7
       WHERE id = $8`,
      [
        Math.max(target.points, source.points),
        target.xp + xp,
        target.crowns + crowns,
        JSON.stringify(unlocked),
        eligible && !target.leaderboard_opt_out,
        playedAt,
        JSON.stringify(target.acquisition ?? source.acquisition),
        target.id,
      ],
    );

    const targetUpdated = (
      await client.query("SELECT * FROM profiles WHERE id = $1", [target.id])
    ).rows[0];
    await observeProfile(client, targetUpdated);

    await client.query(
      "UPDATE profiles SET auth_id = $1, leaderboard_eligible = false, last = NULL WHERE id = $2",
      [`linked:${fromAuthId}`, source.id],
    );
    const sourceUpdated = (
      await client.query("SELECT * FROM profiles WHERE id = $1", [source.id])
    ).rows[0];
    await observeProfile(client, sourceUpdated);

    await mergeActivity(client, source, target);
  });
}

export async function recover() {
  const now = Date.now();
  const rows = (
    await query(
      "SELECT * FROM tournaments WHERE (status = 'lobby' OR status = 'active') AND updated_at < $1 LIMIT 100",
      [now - 15_000],
    )
  ).rows;
  for (const row of rows) {
    await recordEvent(null, {
      kind: "scheduler_recovery",
      tournament: row.id,
      at: now,
    });
    void driveBots(row.id, (row.state as Tournament).version);
  }
}

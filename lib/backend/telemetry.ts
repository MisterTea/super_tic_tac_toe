import type { PoolClient } from "pg";
import { getPool, query } from "../db";
import { DEFAULT_SETTINGS, type Tournament } from "../royale";

type Values = Record<string, number>;
export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);

export async function sourceMetric(
  client: PoolClient | null,
  acquisition: { source: string; campaign: string },
  at: number,
  metric: string,
) {
  const q = client ? client.query.bind(client) : query;
  for (const bucket of ["all", utcDay(at)]) {
    const res = await q(
      "SELECT values FROM campaign_metrics WHERE source = $1 AND campaign = $2 AND bucket = $3",
      [acquisition.source, acquisition.campaign, bucket],
    );
    const values: Values = res.rows[0]?.values || {};
    values[metric] = (values[metric] || 0) + 1;
    await q(
      `INSERT INTO campaign_metrics (source, campaign, bucket, values)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (source, campaign, bucket)
       DO UPDATE SET values = $4`,
      [acquisition.source, acquisition.campaign, bucket, JSON.stringify(values)],
    );
  }
}

export async function fact(
  client: PoolClient | null,
  key: string,
  at: number,
  values: Values,
) {
  const q = client ? client.query.bind(client) : query;
  const res = await q("SELECT day, values FROM metric_facts WHERE key = $1", [key]);
  const prior = res.rows[0];
  const day = prior?.day || utcDay(at);
  const delta: Values = {};
  for (const name of new Set([
    ...Object.keys(values),
    ...Object.keys(prior?.values || {}),
  ])) {
    const change = (values[name] || 0) - (prior?.values?.[name] || 0);
    if (change) delta[name] = change;
  }
  if (!Object.keys(delta).length && prior) return;

  for (const bucket of ["all", day]) {
    const rRes = await q("SELECT values FROM metric_rollups WHERE bucket = $1", [bucket]);
    const rollup = rRes.rows[0];
    const totals: Values = { ...(rollup?.values || {}) };
    for (const [name, change] of Object.entries(delta)) {
      totals[name] = (totals[name] || 0) + change;
    }
    await q(
      `INSERT INTO metric_rollups (bucket, values)
       VALUES ($1, $2)
       ON CONFLICT (bucket)
       DO UPDATE SET values = $2`,
      [bucket, JSON.stringify(totals)],
    );
  }

  await q(
    `INSERT INTO metric_facts (key, day, values)
     VALUES ($1, $2, $3)
     ON CONFLICT (key)
     DO UPDATE SET values = $3`,
    [key, day, JSON.stringify(values)],
  );
}

export async function observeProfile(client: PoolClient | null, p: any) {
  const authId = p.auth_id || p.authId;
  await fact(client, `profile:${p.id}`, Number(p.joined_at || p.joinedAt), {
    profilesCreated: 1,
    uniquePlayers: authId.startsWith("linked:") ? 0 : 1,
  });
  const playedAt = p.played_at ?? p.playedAt;
  if (playedAt !== undefined && playedAt !== null) {
    await fact(client, `participant:${p.id}`, Number(playedAt), {
      playersWhoPlayed: authId.startsWith("linked:") ? 0 : 1,
    });
  }
}

export async function participated(
  client: PoolClient | null,
  id: string,
  at: number,
) {
  const q = client ? client.query.bind(client) : query;
  const pRes = await q("SELECT * FROM profiles WHERE id = $1", [id]);
  const p = pRes.rows[0];
  if (!p || p.auth_id.startsWith("linked:") || p.played_at !== null) return;
  await q("UPDATE profiles SET played_at = $1 WHERE id = $2", [at, id]);
  p.played_at = at;
  await observeProfile(client, p);
  if (p.acquisition) {
    await sourceMetric(client, p.acquisition, at, "firstMatchesStarted");
  }
}

export async function activity(
  client: PoolClient | null,
  p: any,
  now: number,
) {
  const authId = p.auth_id || p.authId;
  if (authId.startsWith("linked:")) return;
  const day = utcDay(now);
  const q = client ? client.query.bind(client) : query;
  const prior = await q(
    "SELECT 1 FROM player_activity WHERE profile = $1 AND day = $2",
    [p.id, day],
  );
  if (prior.rows.length > 0) return;
  await q(
    "INSERT INTO player_activity (profile, day) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [p.id, day],
  );
  const joinedAt = Number(p.joined_at || p.joinedAt);
  await fact(client, `activity:${p.id}:${day}`, now, {
    activePlayerDays: 1,
    returningPlayerDays: utcDay(joinedAt) < day ? 1 : 0,
  });
}

export async function mergeActivity(
  client: PoolClient | null,
  source: any,
  target: any,
) {
  const q = client ? client.query.bind(client) : query;
  const rows = (
    await q("SELECT day FROM player_activity WHERE profile = $1", [source.id])
  ).rows;
  for (const row of rows) {
    await fact(client, `activity:${source.id}:${row.day}`, Date.parse(row.day), {});
    await activity(client, target, Date.parse(`${row.day}T12:00:00Z`));
  }
}

export async function observeReward(client: PoolClient | null, r: any) {
  if (r.xp > 0) await participated(client, r.profile, Number(r.created_at || r.createdAt));
  const finish = Number(r.finish);
  const xp = Number(r.xp);
  const crown = r.crown ?? (finish === 4 && xp > 0);
  await fact(client, `reward:${r.id}`, Number(r.created_at || r.createdAt), {
    placementsAwarded: 1,
    xpAwarded: xp,
    crownsGiven: crown ? 1 : 0,
  });
}

export async function observeTournament(
  client: PoolClient | null,
  id: string,
  t: Tournament,
  previous?: Tournament,
) {
  const q = client ? client.query.bind(client) : query;
  if (!previous)
    await fact(client, `lobby:${id}`, t.createdAt, { lobbiesCreated: 1 });
  if (t.status === "cancelled" && previous?.status !== "cancelled")
    await fact(client, `cancelled:${id}`, t.createdAt, { cancelledLobbies: 1 });
  const started = t.matches.length > 0;
  if (started && !previous?.matches.length) {
    const at =
      t.matches[0].startAt - (t.settings || DEFAULT_SETTINGS).countdownMs;
    await fact(client, `locked:${id}`, at, {
      tournamentsStarted: 1,
      humanEntries: t.entrants.filter((e) => !e.cpu).length,
      cpuEntries: t.entrants.filter((e) => e.cpu).length,
      queueSamples: 1,
      queueMs: Math.max(0, at - t.createdAt),
    });
  }
  for (const m of t.matches) {
    const before = previous?.matches[m.id];
    if (previous && before?.status === m.status) continue;
    const human = m.players.some((p) =>
      t.entrants.some((e) => e.id === p && !e.cpu),
    );
    const began =
      m.status === "playing" ||
      (m.status === "finished" && (m.finishedAt || 0) >= m.startAt);
    if (began) {
      for (const player of m.players) {
        if (t.entrants.some((e) => e.id === player && !e.cpu))
          await participated(client, player, m.startAt);
      }
      await fact(client, `match-start:${id}:${m.id}`, m.startAt, {
        gamesPlayed: 1,
        humanGamesPlayed: human ? 1 : 0,
        cpuOnlyGamesPlayed: human ? 0 : 1,
      });
    }
    if (m.status === "finished") {
      for (const player of began ? m.players : []) {
        if (!t.entrants.some((e) => e.id === player && !e.cpu)) continue;
        const key = `first-finish:${player}`;
        const priorFact = await q("SELECT 1 FROM metric_facts WHERE key = $1", [key]);
        if (priorFact.rows.length > 0) continue;
        const pRes = await q("SELECT * FROM profiles WHERE id = $1", [player]);
        const p = pRes.rows[0];
        const playedThrough =
          m.reason === "board victory" || m.reason === "board score";
        if (p?.acquisition)
          await sourceMetric(
            client,
            p.acquisition,
            m.finishedAt || m.startAt,
            "firstMatchesCompleted",
          );
        await fact(client, key, m.finishedAt || m.startAt, {
          firstMatchesCompleted: 1,
          firstMatchesPlayedThrough: playedThrough ? 1 : 0,
        });
      }
      await fact(client, `match-finish:${id}:${m.id}`, m.finishedAt || m.startAt, {
        matchesCompleted: 1,
        humanMatchesCompleted: human ? 1 : 0,
        legalMoves: m.state.moves.length,
        clockForfeits: m.reason === "clock" ? 1 : 0,
        resignations: m.reason === "resigned" ? 1 : 0,
        cappedMatches:
          m.reason === "board score" && (m.finishedAt || 0) >= m.deadline
            ? 1
            : 0,
        matchDurationSamples: began ? 1 : 0,
        matchDurationMs: began
          ? Math.max(0, (m.finishedAt || m.startAt) - m.startAt)
          : 0,
      });
    }
  }
  if (t.status === "finished" && previous?.status !== "finished") {
    const at = Math.max(...t.matches.map((m) => m.finishedAt || 0));
    await fact(client, `complete:${id}`, at, {
      tournamentsCompleted: 1,
      tournamentDurationMs: Math.max(0, at - t.createdAt),
      cpuChampions: t.entrants.find((e) => e.id === t.champion)?.cpu ? 1 : 0,
    });
  }
}

export async function observeEvent(client: PoolClient | null, e: any) {
  const mapped: Record<string, string> = {
    join: "lobbyJoins",
    lobby_leave: "lobbyLeaves",
    immediate_requeue: "immediateRequeues",
    daily_return: "returnVisits",
    scheduler_recovery: "schedulerRecoveries",
    friend_lobby_created: "friendLobbiesCreated",
    result_share: "resultsShared",
    daily_challenge_start: "dailyChallengesStarted",
    daily_challenge_solved: "dailyChallengesSolved",
  };
  const values: Values = mapped[e.kind] ? { [mapped[e.kind]]: 1 } : {};
  const sourceEvent = /^source_(visit|join|result):([^:]+):([^:]+)$/.exec(
    e.kind,
  );
  if (sourceEvent) {
    const metric = { visit: "visitors", join: "entries", result: "results" }[
      sourceEvent[1] as "visit" | "join" | "result"
    ];
    if (metric) {
      await sourceMetric(
        client,
        { source: sourceEvent[2], campaign: sourceEvent[3] },
        Number(e.at),
        metric,
      );
    }
  }
  if (e.kind === "spectator_wait_ms")
    Object.assign(values, {
      spectatorWaitSamples: 1,
      spectatorWaitMs: e.value || 0,
    });
  if (Object.keys(values).length)
    await fact(client, `event:${e.id}`, Number(e.at), values);
}

export async function recordEvent(
  client: PoolClient | null,
  e: { kind: string; tournament?: string; at: number; value?: number },
) {
  const q = client ? client.query.bind(client) : query;
  const id = crypto.randomUUID();
  await q(
    "INSERT INTO events (id, kind, tournament, at, value) VALUES ($1, $2, $3, $4, $5)",
    [id, e.kind, e.tournament || null, e.at, e.value ?? null],
  );
  await observeEvent(client, { id, ...e });
}

export async function publicStats() {
  const res = await query("SELECT values FROM metric_rollups WHERE bucket = 'all'");
  const totals: Values = res.rows[0]?.values || {};
  return {
    players: totals.playersWhoPlayed || 0,
    games: totals.gamesPlayed || 0,
    crowns: totals.crownsGiven || 0,
  };
}

export async function live() {
  const stats = await publicStats();
  const res = await query("SELECT values FROM metric_rollups WHERE bucket = 'all'");
  const totals: Values = res.rows[0]?.values || {};
  return {
    ...stats,
    activePlayers: totals.activePlayerDays || 0,
  };
}

export async function report(days = 30) {
  const rows = (await query("SELECT * FROM metric_rollups")).rows;
  return rows;
}

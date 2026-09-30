import { query, withTransaction } from "../db";
import { getProfileByAuthId, save, ApiError } from "./royale";
import { activity, observeTournament, recordEvent } from "./telemetry";
import { newLobby, startTournament, type Tournament } from "../royale";

export async function host(authId: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    if (p.active) {
      throw new ApiError("Leave your current lobby or finish your Royale first.");
    }
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    let roomCode = "";
    do {
      roomCode = Array.from(
        { length: 10 },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join("");
    } while (
      (
        await client.query("SELECT 1 FROM tournaments WHERE room_code = $1", [
          roomCode,
        ])
      ).rows.length > 0
    );

    const now = Date.now();
    const state = newLobby(0, now, Math.floor(Math.random() * 2 ** 32));
    state.closesAt = now + 120_000;
    state.settings!.rankDeltas = [0, 0, 0, 0, 0];
    state.entrants.push({
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

    const id = crypto.randomUUID();
    await client.query(
      `INSERT INTO tournaments (id, tier, status, state, updated_at, room_code, host)
       VALUES ($1, 0, 'lobby', $2, $3, $4, $5)`,
      [id, JSON.stringify(state), now, roomCode, p.id],
    );

    await client.query("UPDATE profiles SET active = $1, last = $1 WHERE id = $2", [
      id,
      p.id,
    ]);
    await activity(client, p, now);
    await observeTournament(client, id, state);
    await recordEvent(client, {
      kind: "friend_lobby_created",
      tournament: id,
      at: now,
    });
    await recordEvent(client, { kind: "join", tournament: id, at: now });
    if (p.acquisition) {
      await recordEvent(client, {
        kind: `source_join:${p.acquisition.source}:${p.acquisition.campaign}`,
        tournament: id,
        at: now,
      });
    }
    await save(client, id, state, now);
    return roomCode;
  });
}

export async function room(code: string) {
  if (!/^[a-z2-9]{10}$/.test(code)) return null;
  const res = await query("SELECT * FROM tournaments WHERE room_code = $1", [code]);
  const row = res.rows[0];
  if (!row) return null;
  const t = row.state as Tournament;
  return {
    open: row.status === "lobby" && t.closesAt > Date.now(),
    count: t.entrants.length,
  };
}

export async function start(authId: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    if (!p.active) {
      throw new ApiError("Only the lobby host can start this Royale.");
    }
    const res = await client.query(
      "SELECT * FROM tournaments WHERE id = $1 FOR UPDATE",
      [p.active],
    );
    const row = res.rows[0];
    if (!row || !row.room_code || row.host !== p.id) {
      throw new ApiError("Only the lobby host can start this Royale.");
    }
    if (row.status !== "lobby") return;
    const state = row.state as Tournament;
    startTournament(state, Date.now());
    await save(client, row.id, state, Date.now());
  });
}

export async function attribute(authId: string, source: string, campaign: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    if (p.acquisition) return;
    const clean = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 48);
    const cleanSource = clean(source) || "direct";
    const cleanCampaign = clean(campaign) || "none";
    const acquisition = { source: cleanSource, campaign: cleanCampaign, at: Date.now() };

    await client.query("UPDATE profiles SET acquisition = $1 WHERE id = $2", [
      JSON.stringify(acquisition),
      p.id,
    ]);
    await recordEvent(client, {
      kind: `source_visit:${cleanSource}:${cleanCampaign}`,
      at: Date.now(),
    });
  });
}

export async function shareResult(authId: string, tournamentId: string) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    const rewardRes = await client.query(
      "SELECT * FROM rewards WHERE profile = $1 AND tournament = $2",
      [p.id, tournamentId],
    );
    const reward = rewardRes.rows[0];
    if (!reward) throw new ApiError("Your result isn't ready to share yet.");

    const priorRes = await client.query(
      "SELECT id FROM shared_results WHERE reward = $1",
      [reward.id],
    );
    if (priorRes.rows[0]) return priorRes.rows[0].id;

    const tourneyRes = await client.query(
      "SELECT state FROM tournaments WHERE id = $1",
      [tournamentId],
    );
    const state = tourneyRes.rows[0]?.state as Tournament;
    const entrantId = reward.entrant ?? p.id;
    const entrant = state?.entrants.find((e) => e.id === entrantId);
    if (!entrant) {
      throw new ApiError(
        "This older result cannot be shared. Play a new Royale to make a card.",
      );
    }

    const id = crypto.randomUUID();
    const rounds = state.matches
      .filter((m) => m.players.includes(entrantId) && m.status === "finished")
      .map((m) => ({ round: m.round, won: m.winner === entrantId }));

    await client.query(
      `INSERT INTO shared_results (id, reward, name, finish, wins, crown, delta, rounds)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        reward.id,
        entrant.name,
        reward.finish,
        entrant.wins,
        !!reward.crown,
        reward.delta,
        JSON.stringify(rounds),
      ],
    );

    await recordEvent(client, {
      kind: "result_share",
      at: Date.now(),
      tournament: tournamentId,
    });
    return id;
  });
}

export async function sharedResult(token: string) {
  const res = await query("SELECT * FROM shared_results WHERE id = $1", [token]);
  const row = res.rows[0];
  if (!row) return null;
  return {
    name: row.name,
    finish: row.finish,
    wins: row.wins,
    crown: row.crown,
    delta: row.delta,
    rounds: row.rounds,
  };
}

export async function report(day?: string) {
  const bucket = day || "all";
  const res = await query(
    "SELECT * FROM campaign_metrics WHERE bucket = $1 LIMIT 1001",
    [bucket],
  );
  return {
    bucket,
    truncated: res.rows.length > 1000,
    campaigns: res.rows
      .slice(0, 1000)
      .map((r) => ({ source: r.source, campaign: r.campaign, ...(r.values || {}) }))
      .sort((a, b) => (b.firstMatchesStarted || 0) - (a.firstMatchesStarted || 0)),
  };
}

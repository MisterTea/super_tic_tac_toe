import { query, withTransaction } from "../db";
import { levelFor, tierIndex, tiers } from "../royale";
import { ApiError } from "./royale";

export async function top() {
  const res = await query(
    `SELECT name, points, crowns, xp
     FROM profiles
     WHERE leaderboard_eligible = true
     ORDER BY points DESC, crowns DESC, xp DESC
     LIMIT 10`,
  );
  return res.rows.map((p, index) => ({
    rank: index + 1,
    name: p.name,
    points: p.points,
    crowns: p.crowns,
    tier: tiers[tierIndex(p.points)],
    level: levelFor(p.xp),
  }));
}

export async function setOptOut(authId: string, optOut: boolean, isAnonymous = false) {
  if (isAnonymous) {
    throw new ApiError("Log in to change leaderboard settings.");
  }
  return withTransaction(async (client) => {
    const pRes = await client.query("SELECT id FROM profiles WHERE auth_id = $1", [
      authId,
    ]);
    const p = pRes.rows[0];
    if (!p) throw new ApiError("Create a player profile first.");
    await client.query(
      "UPDATE profiles SET leaderboard_opt_out = $1, leaderboard_eligible = $2 WHERE id = $3",
      [optOut, !optOut, p.id],
    );
  });
}

export async function migrateLeaderboard() {
  return withTransaction(async (client) => {
    const profiles = (await client.query("SELECT * FROM profiles")).rows;
    let eligible = 0;
    for (const p of profiles) {
      const user = p.auth_id.startsWith("linked:")
        ? null
        : (await client.query('SELECT * FROM "user" WHERE id = $1', [p.auth_id])).rows[0];
      const visible = !!user && !user.isAnonymous && !p.leaderboard_opt_out;
      await client.query(
        "UPDATE profiles SET leaderboard_opt_out = $1, leaderboard_eligible = $2 WHERE id = $3",
        [p.leaderboard_opt_out ?? false, visible, p.id],
      );
      if (visible) eligible++;
    }
    return { profiles: profiles.length, eligible };
  });
}

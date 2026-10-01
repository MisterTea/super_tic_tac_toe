import { initDb, query, getPool, withTransaction } from "../lib/db";
import { ensureProfile, driveBots } from "../lib/backend/royale";
import { newLobby, startTournament } from "../lib/royale";
import { fact } from "../lib/backend/telemetry";
import { writeFileSync } from "node:fs";
if (
  process.env.DATABASE_URL !==
  "postgresql://stress_user@127.0.0.1:55432/freeze_stress"
)
  throw new Error("Isolated freeze_stress database required");
async function main() {
  await initDb();
  const authId = crypto.randomUUID();
  await query(
    `INSERT INTO "user"(id,name,email,"createdAt","updatedAt","isAnonymous") VALUES($1,'Stress',$2,NOW(),NOW(),true)`,
    [authId, `${authId}@example.invalid`],
  );
  const profile = await ensureProfile(authId, true);
  await query("UPDATE profiles SET last_visit_day=NULL WHERE id=$1", [profile]);
  const driving = process.env.LOCK_CASE === "driver";
  let tournamentId = "";
  if (driving) {
    tournamentId = crypto.randomUUID();
    const state = newLobby(0, Date.now(), 1);
    state.settings!.countdownMs = 0;
    state.entrants.push({
      id: profile,
      name: "Stress",
      cpu: false,
      avatar: "●",
      skill: 0,
      points: 0,
      moved: false,
      wins: 0,
      boards: 0,
    });
    startTournament(state, Date.now());
    // Put CPU-only starts ahead of the human's start in telemetry iteration.
    const human = state.matches.find((m) => m.players.includes(profile))!;
    if (human.id === 0)
      throw new Error("Choose a seed with a later human match");
    await query(
      "INSERT INTO tournaments(id,status,state,updated_at) VALUES($1,'active',$2,$3)",
      [tournamentId, JSON.stringify(state), Date.now()],
    );
    await query("UPDATE profiles SET active=$1,last=$1 WHERE id=$2", [
      tournamentId,
      profile,
    ]);
  }
  let detected = 0;
  const original = console.error;
  console.error = (...args) => {
    if (args[1]?.code === "40P01") detected++;
    original(...args);
  };
  let locked!: () => void, release!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const writer = withTransaction(async (client) => {
    await client.query("SELECT id FROM profiles WHERE id=$1 FOR UPDATE", [
      profile,
    ]);
    locked();
    await gate;
    await fact(client, `stress-profile:${profile}`, Date.now(), {
      stressProfileWrites: 1,
    });
  });
  await ready;
  const began = Date.now();
  const returning = driving
    ? driveBots(tournamentId, 0)
    : ensureProfile(authId, true);
  await new Promise((resolve) => setTimeout(resolve, 150));
  release();
  const results = await Promise.allSettled([writer, returning]);
  console.error = original;
  const report = {
    case: driving
      ? "match_start_vs_profile_writer"
      : "daily_return_vs_profile_writer",
    elapsedMs: Date.now() - began,
    deadlocks: detected,
    results: results.map((r) => r.status),
  };
  console.log(JSON.stringify(report));
  writeFileSync(
    `artifacts/freeze-stress/profile-locks-${driving ? "driver" : "daily"}.json`,
    JSON.stringify(report, null, 2),
  );
  await getPool().end();
  process.exit(
    detected || results.some((r) => r.status === "rejected") ? 1 : 0,
  );
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

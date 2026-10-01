import { initDb, query, getPool, withTransaction } from "../lib/db";
import * as royale from "../lib/backend/royale";
import { fact } from "../lib/backend/telemetry";
import { newLobby, type Tournament } from "../lib/royale";
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
// This harness refuses every host except this task's isolated local database.
if (
  process.env.DATABASE_URL !==
  "postgresql://stress_user@127.0.0.1:55432/freeze_stress"
)
  throw new Error("Use the isolated freeze_stress database only");
async function player(index: number) {
  const authId = crypto.randomUUID();
  await query(
    `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt","isAnonymous") VALUES ($1,$2,$3,false,NOW(),NOW(),true)`,
    [authId, `Stress ${index}`, `${authId}@example.invalid`],
  );
  const id = await royale.ensureProfile(authId, true);
  return { authId, id };
}
async function main() {
  await initDb();
  const p = await player(1);
  const id = crypto.randomUUID(),
    state = newLobby(0, Date.now(), 123);
  state.entrants.push({
    id: p.id,
    name: "Stress player",
    cpu: false,
    avatar: "●",
    skill: 0,
    points: 0,
    moved: false,
    wins: 0,
    boards: 0,
  });
  await query(
    `INSERT INTO tournaments(id,tier,status,state,updated_at) VALUES($1,0,'lobby',$2,$3)`,
    [id, JSON.stringify(state), Date.now()],
  );
  // Requeue after a prior result: this is the path used after a few games.
  const prior = crypto.randomUUID();
  await query(
    `INSERT INTO rewards(id,profile,tournament,finish,delta,xp,created_at) VALUES($1,$2,$3,0,0,0,$4)`,
    [crypto.randomUUID(), p.id, prior, Date.now()],
  );
  await query("UPDATE profiles SET last=$1,active=NULL WHERE id=$2", [
    prior,
    p.id,
  ]);
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (locked = r));
  const writer = withTransaction(async (client) => {
    await client.query("SELECT * FROM tournaments WHERE id=$1 FOR UPDATE", [
      id,
    ]);
    locked();
    await gate;
    await fact(client, `stress-driver:${id}`, Date.now(), { stressWrites: 1 });
  });
  await ready;
  const started = performance.now();
  const join = royale.join(p.authId);
  await new Promise((r) => setTimeout(r, 150));
  release();
  const results = await Promise.allSettled([writer, join]);
  const summary = results.map((r) =>
    r.status === "rejected"
      ? { status: r.status, code: r.reason.code, message: r.reason.message }
      : { status: r.status },
  );
  const output = {
    case: "requeue_vs_driver",
    elapsedMs: Math.round(performance.now() - started),
    results: summary,
  };
  console.log(JSON.stringify(output));
  writeFileSync(
    "artifacts/freeze-stress/lock-reproduction.json",
    JSON.stringify(output, null, 2),
  );
  await getPool().end();
  process.exit(results.some((r) => r.status === "rejected") ? 1 : 0);
}
void main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { initDb, query, getPool } from "../lib/db";
import { driveBots } from "../lib/backend/royale";
import { advanceTime, newLobby, startTournament } from "../lib/royale";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
if (
  process.env.DATABASE_URL !==
  "postgresql://stress_user@127.0.0.1:55432/freeze_stress"
)
  throw new Error("Isolated freeze_stress database required");
async function main() {
  await initDb();
  const ids: string[] = [];
  for (let i = 0; i < 8; i++) {
    const id = crypto.randomUUID(),
      state = newLobby(5, Date.now(), i + 1);
    state.settings!.countdownMs = 0;
    state.settings!.botDelayMs = 60_000;
    state.settings!.clockMs = 180_000;
    state.settings!.matchMs = 300_000;
    state.entrants.push({
      id: "cpu-0",
      name: "Stress CPU",
      cpu: true,
      avatar: "●",
      skill: 1,
      points: 0,
      moved: false,
      wins: 0,
      boards: 0,
    });
    startTournament(state, Date.now());
    for (const e of state.entrants) e.skill = 1;
    advanceTime(state, Date.now());
    for (const m of state.matches) if (m.status === "playing") m.botAt = 0;
    await query(
      "INSERT INTO tournaments(id,tier,status,state,updated_at) VALUES($1,5,'active',$2,$3)",
      [id, JSON.stringify(state), Date.now()],
    );
    ids.push(id);
  }
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  let heartbeats = 0;
  const timer = setInterval(() => heartbeats++, 100);
  await new Promise((r) => setTimeout(r, 100));
  const began = Date.now();
  const result = await Promise.allSettled(ids.map((id) => driveBots(id, 0)));
  const rows = (
    await query("SELECT state FROM tournaments WHERE id=ANY($1::text[])", [ids])
  ).rows;
  const cpuMoves = rows.reduce(
    (n, r) =>
      n +
      r.state.matches.reduce(
        (v: number, m: any) => v + m.state.moves.length,
        0,
      ),
    0,
  );
  const report = {
    brackets: ids.length,
    cpuMoves,
    elapsedMs: Date.now() - began,
    eventLoopMaxMs: Math.round(delay.max / 1e6),
    heartbeats,
    results: result.map((r) => r.status),
  };
  console.log(JSON.stringify(report));
  writeFileSync(
    "artifacts/freeze-stress/strong-cpu.json",
    JSON.stringify(report, null, 2),
  );
  clearInterval(timer);
  delay.disable();
  await getPool().end();
  process.exit(
    cpuMoves < 16 || result.some((r) => r.status === "rejected") ? 1 : 0,
  );
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

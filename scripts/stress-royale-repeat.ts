import { initDb, query, getPool } from "../lib/db";
import * as royale from "../lib/backend/royale";
import * as growth from "../lib/backend/growth";
import { legal } from "../lib/game";
import type { Tournament } from "../lib/royale";
import { writeFileSync } from "node:fs";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
const url = "postgresql://stress_user@127.0.0.1:55432/freeze_stress";
if (process.env.DATABASE_URL !== url)
  throw new Error(
    "Refusing stress mutations outside the isolated local database",
  );
async function main() {
  await initDb();
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const durations: number[] = [],
    errors: string[] = [],
    ids: string[] = [];
  let peakWaiting = 0;
  const sampler = setInterval(() => {
    peakWaiting = Math.max(peakWaiting, getPool().waitingCount);
  }, 20);
  const began = performance.now();
  async function timed<T>(fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } catch (e) {
      errors.push((e as Error).message);
      throw e;
    } finally {
      durations.push(performance.now() - start);
    }
  }
  async function worker(index: number) {
    const auth = crypto.randomUUID();
    await query(
      `INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt","isAnonymous") VALUES($1,$2,$3,false,NOW(),NOW(),true)`,
      [auth, `Load ${index}`, `${auth}@example.invalid`],
    );
    const player = await royale.ensureProfile(auth, true);
    for (let round = 0; round < 6; round++) {
      const code = await timed(() => growth.host(auth));
      const row = (
        await query("SELECT * FROM tournaments WHERE room_code=$1", [code])
      ).rows[0];
      ids.push(row.id);
      const state = row.state as Tournament;
      state.settings = {
        ...state.settings!,
        clockMs: 60000,
        matchMs: 120000,
        countdownMs: 0,
        botDelayMs: 0,
      };
      await query("UPDATE tournaments SET state=$1 WHERE id=$2", [
        JSON.stringify(state),
        row.id,
      ]);
      await timed(() => growth.start(auth));
      let data = await timed(() => royale.dashboard(auth));
      for (let attempt = 0; attempt < 15; attempt++) {
        const match = data.tournament!.matches.find(
          (m) => m.players.includes(player) && m.status === "playing",
        );
        if (match && match.players[match.state.turn === 1 ? 0 : 1] === player) {
          await timed(() =>
            royale.move(
              auth,
              row.id,
              match.id,
              match.state.moves.length,
              legal(match.state)[0],
            ),
          );
          break;
        }
        await timed(() => royale.driveBots(row.id, 0));
        data = await timed(() => royale.dashboard(auth));
      }
      await timed(() => royale.resign(auth, row.id));
      const result = await timed(() => royale.dashboard(auth));
      if (result.profile.active)
        throw new Error("Resigned player still active");
      console.log(
        `worker ${index}: ${round + 1}/6 games, queued ${getPool().waitingCount}`,
      );
    }
  }
  await Promise.all(Array.from({ length: 4 }, (_, i) => worker(i)));
  // Complete the abandoned brackets: reproduces the extra background work left by repeat players.
  for (let tick = 0; tick < 350; tick++) {
    const active = (
      await query(
        "SELECT id FROM tournaments WHERE id=ANY($1) AND status='active'",
        [ids],
      )
    ).rows;
    if (!active.length) break;
    await Promise.all(
      active.map((r) => timed(() => royale.driveBots(r.id, 0))),
    );
    if (tick === 349) throw new Error("Brackets did not finish");
  }
  const stats = (
    await query(
      "SELECT count(*)::int total, count(*) FILTER(WHERE status='finished')::int finished FROM tournaments WHERE id=ANY($1)",
      [ids],
    )
  ).rows[0];
  durations.sort((a, b) => a - b);
  const report = {
    ...stats,
    operations: durations.length,
    errors,
    elapsedMs: Math.round(performance.now() - began),
    p95Ms: Math.round(durations[Math.floor(durations.length * 0.95)]),
    maxMs: Math.round(durations.at(-1)!),
    eventLoopP99Ms: Math.round(delay.percentile(99) / 1e6),
    eventLoopMaxMs: Math.round(delay.max / 1e6),
    peakPoolWaiting: peakWaiting,
  };
  writeFileSync(
    "artifacts/freeze-stress/repeated-games.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
  clearInterval(sampler);
  delay.disable();
  await getPool().end();
  process.exit(errors.length ? 1 : 0);
}
void main().catch((e) => {
  console.error(e);
  process.exit(1);
});

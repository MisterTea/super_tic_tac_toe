import { readFileSync, writeFileSync } from "node:fs";
import { initial, play } from "../lib/game";
import { policyMove, searchMove } from "../lib/ai";
import { SkillModel, skillMove } from "../lib/skill";
const count = Number(process.argv[2] ?? 20);
if (!Number.isInteger(count) || count < 2)
  throw new Error("Usage: npx tsx scripts/benchmark-champion.ts [games >= 2]");
const model: SkillModel = JSON.parse(
  readFileSync("public/skill-policy.json", "utf8"),
);
delete model.championEngine; // Benchmark the bounded candidate against the other available engines.
function random(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const results = [];
for (const opponent of ["raw-policy", "monte-carlo-700"]) {
  let wins = 0,
    draws = 0,
    losses = 0;
  const start = Date.now();
  for (let i = 0; i < count; i++) {
    let s = initial();
    const side = i % 2 === 0 ? 1 : -1,
      rng = random(6611 + i),
      other = random(16611 + i);
    while (!s.winner) {
      const a =
        s.turn === side
          ? skillMove(s, 1, model, rng)
          : opponent === "raw-policy"
            ? policyMove(s, model.expert)
            : searchMove(s, 700, other);
      s = play(s, a);
    }
    if (s.winner === 2) draws++;
    else if (s.winner === side) wins++;
    else losses++;
  }
  const row = {
    opponent,
    games: count,
    wins,
    draws,
    losses,
    score: (wins + draws * 0.5) / count,
    seconds: (Date.now() - start) / 1000,
  };
  results.push(row);
  process.stdout.write(JSON.stringify(row) + "\n");
}
writeFileSync(
  "training/champion-head-to-head.json",
  JSON.stringify(
    {
      seed: 6611,
      benchmarks: results,
      limitation: "Small head-to-head diagnostic, not a proof of optimal play.",
    },
    null,
    2,
  ),
);
if (process.argv.includes("--select")) {
  const monte = results.find((r) => r.opponent === "monte-carlo-700")!;
  if (monte.score < 0.5) model.championEngine = "monte-carlo-700";
  writeFileSync("public/skill-policy.json", JSON.stringify(model, null, 2));
}

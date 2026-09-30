import { writeFileSync } from "node:fs";
import { initial, legal, play } from "../lib/game";
import { seeded } from "../lib/royale";
const puzzles: number[][] = [];
for (let seed = 1; puzzles.length < 64 && seed < 10000; seed++) {
  const random = seeded(seed), state = initial();
  let s = state;
  while (!s.winner) {
    const actions = legal(s);
    const winning = actions.filter(a => play(s, a).winner === s.turn);
    if (winning.length === 1 && actions.length >= 3 && s.moves.length >= 20) { puzzles.push(s.moves); break; }
    s = play(s, actions[Math.floor(random() * actions.length)]);
  }
}
if (puzzles.length !== 64) throw new Error("Could not generate daily positions");
writeFileSync("lib/daily-puzzles.json", JSON.stringify(puzzles));

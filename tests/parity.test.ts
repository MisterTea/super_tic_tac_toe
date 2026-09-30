import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { initial, legal, play, features, actionFeatures } from "../lib/game";
test("Python and TypeScript agree on every state in 20 complete games", () => {
  const histories: number[][] = [];
  const expected: object[][] = [];
  for (let i = 0; i < 20; i++) {
    let s = initial();
    const states: object[] = [];
    while (!s.winner) {
      states.push({
        cells: s.cells,
        boards: s.boards,
        turn: s.turn,
        forced: s.forced,
        winner: s.winner,
        legal: legal(s),
        features: features(s),
        actionFeatures: legal(s).map((a) => actionFeatures(s, a)),
      });
      const a = legal(s);
      s = play(s, a[Math.floor(Math.random() * a.length)]);
    }
    states.push({
      cells: s.cells,
      boards: s.boards,
      turn: s.turn,
      forced: s.forced,
      winner: s.winner,
      legal: legal(s),
      features: features(s),
      actionFeatures: legal(s).map((a) => actionFeatures(s, a)),
    });
    histories.push(s.moves);
    expected.push(states);
  }
  const output = spawnSync("python", ["training/parity.py"], {
    input: JSON.stringify(histories),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout), expected);
});

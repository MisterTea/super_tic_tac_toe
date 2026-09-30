import { test } from "node:test";
import assert from "node:assert/strict";
import { initial, legal, play, replay, result } from "../lib/game";
import { winningActions } from "../lib/ai";
test("first move routes next player and rejects off-board moves", () => {
  const s = play(initial(), 40);
  assert.equal(s.forced, 4);
  assert.equal(s.turn, -1);
  assert.equal(legal(s).length, 8);
  assert.throws(() => play(s, 0));
  assert.throws(() => play(s, 40));
});
test("closed target releases forced board", () => {
  const s = initial();
  s.boards[4] = 2;
  const next = play(s, 4);
  assert.equal(next.forced, -1);
  assert(!legal(next).some((a) => Math.floor(a / 9) === 4));
});
test("wins and draws distinguish claimed boards", () => {
  assert.equal(result([1, 1, 1, 0, 0, 0, 0, 0, 0]), 1);
  assert.equal(result([2, 2, 2, 1, -1, 1, -1, 1, -1]), 2);
});
test("random games terminate with deterministic replay", () => {
  for (let i = 0; i < 100; i++) {
    let s = initial();
    while (!s.winner) {
      const a = legal(s);
      assert.deepEqual(
        winningActions(s),
        a.filter((m) => play(s, m).winner === s.turn),
      );
      s = play(s, a[Math.floor(Math.random() * a.length)]);
    }
    assert.deepEqual(replay(s.moves), s);
    assert(s.moves.length <= 81);
    assert.equal(legal(s).length, 0);
  }
});

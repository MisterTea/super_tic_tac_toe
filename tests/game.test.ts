import { test } from "node:test";
import assert from "node:assert/strict";
import {
  initial,
  legal,
  play,
  replay,
  result,
  macroResult,
  winningLine,
  scoreWinner,
  actionFeatures,
} from "../lib/game";
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
function wildcardState(boards: number[], mover: 1 | -1, board = 4) {
  const s = initial();
  s.boards = boards;
  s.turn = mover;
  s.forced = board;
  s.cells.splice(
    board * 9,
    9,
    ...[1, -1, 1, 1, -1, -1, -1, 1, 0].map((v) => v * mover),
  );
  return s;
}
test("a tied small board becomes a closed wildcard in either player's line", () => {
  for (const player of [1, -1] as const) {
    const s = wildcardState(
      [player, player, 0, 0, 0, 0, 0, 0, 0],
      -player as 1 | -1,
      2,
    );
    const next = play(s, 26);
    assert.equal(next.boards[2], 2);
    assert.equal(next.winner, player); // Can give the opponent a win.
    assert.deepEqual(winningLine(next.boards, player), [0, 1, 2]);
    assert.equal(actionFeatures(s, 26)[2], 0);
  }
});
test("the wildcard maker wins when X and O complete lines simultaneously", () => {
  for (const player of [1, -1] as const) {
    const s = wildcardState([0, -1, 0, 1, 0, 1, 0, -1, 0], player);
    assert.deepEqual(winningActions(s), [44]);
    assert.equal(actionFeatures(s, 44)[2], 1);
    const next = play(s, 44);
    assert.equal(next.winner, player);
    assert(winningLine(next.boards, 1));
    assert(winningLine(next.boards, -1));
    assert.equal(next.forced, 8);
    assert.deepEqual(legal(next), []);
  }
  assert.equal(macroResult([2, 2, 2, 0, 0, 0, 0, 0, 0], -1), -1);
});
test("full macro boards use owned-piece count, then the first player", () => {
  assert.equal(macroResult([1, -1, 1, -1, -1, 1, -1, 1, -1], 1), -1);
  assert.equal(macroResult([1, -1, 1, 1, -1, -1, -1, 1, 2], -1), 1);
  assert.equal(scoreWinner([1, -1, 2, 0, 0, 0, 0, 0, 0]), 1);
  const s = wildcardState([1, -1, 1, 1, -1, -1, -1, 1, 0], -1, 8);
  assert.equal(play(s, 80).winner, 1);
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
    assert.equal(Math.abs(s.winner), 1);
  }
});

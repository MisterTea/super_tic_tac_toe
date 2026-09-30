import { test } from "node:test";
import assert from "node:assert/strict";
import { initial, legal, play } from "../lib/game";
import {
  advanceTime,
  boardScore,
  CLOCK_MS,
  COUNTDOWN_MS,
  finishMatch,
  newLobby,
  placementReward,
  playerView,
  publicTournament,
  resign,
  seeded,
  startTournament,
  submitMove,
  tierIndex,
  cosmetics,
  type Tournament,
} from "../lib/royale";

function field(humans = 16) {
  const t = newLobby(0, 0, 42);
  for (let i = 0; i < humans; i++)
    t.entrants.push({
      id: `human-${i}`,
      name: `Player ${i}`,
      cpu: false,
      avatar: "●",
      skill: 0,
      points: 0,
      moved: false,
      wins: 0,
      boards: 0,
    });
  startTournament(t, 0);
  advanceTime(t, COUNTDOWN_MS);
  return t;
}
test("a lobby fills once with labeled bots and locks skill", () => {
  const t = field(1);
  assert.equal(t.entrants.filter((e) => e.cpu).length, 15);
  assert.equal(t.matches.length, 15);
  assert(
    t.entrants
      .filter((e) => e.cpu)
      .every((e) => e.skill >= 0.15 && e.skill <= 0.25),
  );
  const before = JSON.stringify(t);
  startTournament(t, 100);
  assert.equal(JSON.stringify(t), before);
});
test("winners observe their sibling and advance without unrelated matches", () => {
  const t = field(),
    first = t.matches[0],
    sibling = t.matches[1],
    parent = t.matches[8];
  const winner = first.players[0];
  finishMatch(t, first, winner, "board victory", 11_000);
  assert.deepEqual(playerView(t, winner), {
    phase: "spectating",
    matchId: 1,
    nextRound: 1,
  });
  assert.equal(parent.status, "pending");
  finishMatch(t, sibling, sibling.players[0], "board victory", 12_000);
  assert.equal(parent.status, "countdown");
  assert.equal(parent.startAt, 22_000);
  assert.equal(t.matches[2].status, "playing");
  assert.deepEqual(playerView(t, winner), { phase: "countdown", matchId: 8 });
  advanceTime(t, 22_000);
  assert.equal(parent.status, "playing");
  assert.deepEqual(playerView(t, winner), { phase: "playing", matchId: 8 });
});
test("an already-finished sibling goes directly to countdown; duplicates cannot advance twice", () => {
  const t = field(),
    a = t.matches[0],
    b = t.matches[1];
  finishMatch(t, b, b.players[0], "clock", 11_000);
  finishMatch(t, a, a.players[0], "clock", 12_000);
  const snapshot = JSON.stringify(t);
  finishMatch(t, a, a.players[0], "clock", 13_000);
  assert.equal(JSON.stringify(t), snapshot);
  assert.equal(playerView(t, a.players[0]).phase, "countdown");
});
test("a complete bracket has exactly one champion and 15 settled matches", () => {
  const t = field();
  let now = 11_000;
  for (let round = 0; round < 4; round++) {
    advanceTime(t, now);
    for (const m of t.matches.filter((m) => m.round === round))
      finishMatch(t, m, m.players[0], "board victory", now);
    now += COUNTDOWN_MS;
  }
  assert.equal(t.status, "finished");
  assert.equal(t.matches.filter((m) => m.status === "finished").length, 15);
  assert.equal(t.entrants.filter((e) => e.finish === 4).length, 1);
  assert.equal(playerView(t, t.champion!).phase, "results");
});
test("server clocks reject late, stale, illegal and spectator moves", () => {
  const t = field(),
    m = t.matches[0];
  assert.throws(() => submitMove(t, 0, "spectator", 0, 0, 11_000));
  assert.throws(() => submitMove(t, 0, m.players[0], 1, 0, 11_000));
  assert.throws(() => submitMove(t, 0, m.players[0], 0, 81, 11_000));
  submitMove(t, 0, m.players[0], 0, 40, 11_000);
  assert.equal(m.clocks[0], CLOCK_MS - 1000);
  assert.throws(() => submitMove(t, 0, m.players[1], 1, 0, 12_000));
  assert.throws(() => submitMove(t, 0, m.players[1], 1, 36, 11_000 + CLOCK_MS));
  advanceTime(t, 11_000 + CLOCK_MS);
  assert.equal(m.winner, m.players[0]);
  assert.equal(m.reason, "clock");
});
test("board-score tiebreak prefers large pieces; secret is not public", () => {
  const t = field(),
    m = t.matches[0];
  m.clocks = [300_000, 300_000];
  m.state.boards[1] = -1;
  advanceTime(t, m.deadline);
  assert.equal(m.winner, m.players[1]);
  assert(!("seed" in publicTournament(t)));
  assert(!("tieSecret" in publicTournament(t).matches[0]));
  const s = initial();
  s.cells[0] = 1;
  s.cells[1] = 1;
  assert.deepEqual(boardScore(s, 1), [0, 1]);
  s.cells[2] = -1;
  assert.deepEqual(boardScore(s, 1), [0, 0]);
});
test("tied large-piece counts award the match to the first player regardless of small-board threats", () => {
  const a = field(),
    b = field();
  for (const t of [a, b]) {
    const m = t.matches[0];
    m.clocks = [300_000, 300_000];
    m.state.cells[0] = -1;
    m.state.cells[1] = -1;
    advanceTime(t, m.deadline);
    assert.equal(m.winner, m.players[0]);
  }
  assert.equal(a.matches[0].winner, b.matches[0].winner);
});
test("resignation while spectating forfeits the next slot without replacing entrants", () => {
  const t = field(),
    a = t.matches[0],
    b = t.matches[1],
    winner = a.players[0];
  finishMatch(t, a, winner, "board victory", 11_000);
  resign(t, winner, 12_000);
  finishMatch(t, b, b.players[0], "board victory", 13_000);
  advanceTime(t, 23_000);
  assert.equal(t.matches[8].winner, b.players[0]);
  assert.equal(t.entrants.length, 16);
  assert.equal(
    placementReward(t.entrants.find((e) => e.id === winner)!)!.xp,
    0,
  );
});
test("placement rewards protect Bronze and treat CPU opponents equally", () => {
  const e = {
    id: "human",
    name: "Human",
    avatar: "●",
    cpu: false,
    skill: 0,
    points: 0,
    moved: true,
    wins: 0,
    boards: 0,
    finish: 0,
  };
  assert.equal(placementReward(e)!.delta, 0);
  assert.equal(placementReward({ ...e, points: 200 })!.delta, -20);
  assert.equal(placementReward({ ...e, finish: 4, wins: 4 })!.xp, 250);
  assert.equal(
    placementReward({ ...e, finish: 4, wins: 4, cpu: true })!.delta,
    80,
  );
  assert.equal(placementReward({ ...e, finish: 4, moved: false })!.delta, 0);
  assert.equal(tierIndex(2000), 5);
  assert.equal(cosmetics.filter((c) => c.kind === "theme").length, 6);
  assert.equal(cosmetics.filter((c) => c.kind === "title").length, 6);
  assert.equal(cosmetics.filter((c) => c.kind === "effect").length, 3);
});
test("ten concurrent brackets complete legal games with deterministic replay", () => {
  const tournaments: Tournament[] = Array.from({ length: 10 }, () => field());
  let settled = 0;
  for (const [index, t] of tournaments.entries()) {
    const rng = seeded(index);
    let now = 11_000;
    for (let round = 0; round < 4; round++) {
      advanceTime(t, now);
      for (const m of t.matches.filter((m) => m.round === round)) {
        let local = now;
        while (m.status === "playing") {
          const actions = legal(m.state),
            action = actions[Math.floor(rng() * actions.length)];
          submitMove(
            t,
            m.id,
            m.players[m.state.turn === 1 ? 0 : 1],
            m.state.moves.length,
            action,
            local++,
          );
        }
        assert.deepEqual(m.state, m.state.moves.reduce(play, initial()));
        settled++;
      }
      now += 11_000;
    }
    assert.equal(t.status, "finished");
  }
  assert.equal(settled, 150);
});

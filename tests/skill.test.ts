import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initial, legal, play } from "../lib/game";
import { searchMove } from "../lib/ai";
import {
  attention,
  evidence,
  profileAt,
  skillMove,
  isSkillModel,
  SkillModel,
} from "../lib/skill";
const model: SkillModel = JSON.parse(
  readFileSync("public/skill-policy.json", "utf8"),
);
test("skill zero is exactly uniform over legal moves", () => {
  const s = play(initial(), 40),
    a = legal(s);
  for (let i = 0; i < a.length; i++)
    assert.equal(
      skillMove(s, 0, model, () => (i + 0.5) / a.length),
      a[i],
    );
});
test("skill one dispatches to the strongest measured engine", () => {
  let s = initial();
  const full = profileAt(model, 1);
  assert.equal(full.macro, 1);
  assert.equal(full.decay, 0);
  assert.deepEqual(full, model.champion);
  assert.equal(model.championEngine, "monte-carlo-700");
  const random = () => {
    let seed = 9;
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
  };
  for (let i = 0; i < 4; i++) {
    assert.equal(
      skillMove(s, 1, model, random()),
      searchMove(s, 700, random()),
    );
    s = play(s, legal(s)[0]);
  }
});
test("attention decays outside a learned fovea and increases with skill", () => {
  const p = profileAt(model, 0.5);
  assert.equal(attention(0, p), 1);
  assert.equal(attention(p.radius, p), 1);
  assert(attention(7, p) < attention(3, p));
  assert(profileAt(model, 0.75).depth > p.depth);
  assert(profileAt(model, 0.75).radius > p.radius);
  const s = initial();
  assert(evidence(s, 40, p, [1, 1])[0] > evidence(s, 80, p, [1, 1])[0]);
});
test("peripheral omissions can miss a win rather than add uniform action noise", () => {
  const m = structuredClone(model);
  delete m.champion;
  delete m.championEngine;
  m.profiles = m.profiles.map(() => ({
    radius: 0.1,
    decay: 10,
    macro: 0,
    depth: 1,
    breadth: 8,
  }));
  const s = initial();
  s.forced = 0;
  s.cells[0] = s.cells[1] = 1;
  s.moves = [80];
  assert.equal(skillMove(s, 1, m), 2);
  assert.equal(
    skillMove(s, 0.5, m, () => 0.9),
    4,
  );
});
test("all intermediate skills remain legal and exports are validated", () => {
  assert(isSkillModel(model));
  assert(!isSkillModel({ ...model, profiles: [{ depth: Infinity }] }));
  let s = initial();
  let seed = 7;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  while (!s.winner) {
    for (const k of [0.01, 0.25, 0.5, 0.75, 0.99])
      assert(legal(s).includes(skillMove(s, k, model, rng)));
    s = play(s, legal(s)[0]);
  }
});

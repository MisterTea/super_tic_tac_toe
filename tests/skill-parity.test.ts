import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { initial, legal, play } from "../lib/game";
import { skillMove, evidence, profileAt, SkillModel } from "../lib/skill";
test("Python and browser agree on skill-conditioned choices with identical random streams", () => {
  const model: SkillModel = JSON.parse(
    readFileSync("public/skill-policy.json", "utf8"),
  );
  const rows: { moves: number[]; skill: number; seed: number }[] = [],
    expected: { action: number; profile: object; evidence: number[][] }[] = [];
  let s = initial();
  for (let i = 0; i < 30 && !s.winner; i++) {
    for (const skill of [0, 0.25, 0.5, 0.75, 1]) {
      let seed = 123 + i;
      const rng = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      };
      const p = profileAt(model, skill);
      rows.push({ moves: s.moves, skill, seed: 123 + i });
      expected.push({
        action: skillMove(s, skill, model, rng),
        profile: p,
        evidence: legal(s).map((a) => evidence(s, a, p)),
      });
    }
    s = play(s, legal(s)[i % legal(s).length]);
  }
  const result = spawnSync("python", ["training/check_skill.py"], {
    input: JSON.stringify(rows),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  const actual = JSON.parse(result.stdout);
  actual.forEach(
    (
      v: {
        action: number;
        profile: Record<string, number>;
        evidence: number[][];
      },
      i: number,
    ) => {
      assert.equal(v.action, expected[i].action, `row ${i}`);
      for (const [key, value] of Object.entries(expected[i].profile))
        assert(Math.abs(v.profile[key] - (value as number)) < 1e-10);
      v.evidence.forEach((r, j) =>
        r.forEach((x, k) =>
          assert(Math.abs(x - expected[i].evidence[j][k]) < 1e-10),
        ),
      );
    },
  );
});

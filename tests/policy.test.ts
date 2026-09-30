import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { initial, play, legal } from "../lib/game";
import { policyMove } from "../lib/ai";
test(
  "exported browser policy matches PyTorch greedy actions",
  { skip: !existsSync("public/policy.json") },
  () => {
    const p = JSON.parse(readFileSync("public/policy.json", "utf8"));
    let s = initial();
    const histories: number[][] = [],
      actions: number[] = [];
    while (!s.winner) {
      histories.push(s.moves);
      actions.push(policyMove(s, p));
      const a = legal(s);
      s = play(s, a[Math.floor(Math.random() * a.length)]);
    }
    const out = spawnSync("python", ["training/check_export.py"], {
      input: JSON.stringify(histories),
      encoding: "utf8",
    });
    assert.equal(out.status, 0, out.stderr);
    assert.deepEqual(JSON.parse(out.stdout), actions);
  },
);

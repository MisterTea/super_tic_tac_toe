import { test } from "node:test";
import assert from "node:assert/strict";
import { humanDelay, remainingSeconds } from "../lib/timing";
test("human wait has the requested truncated normal mean and variance", () => {
  let seed = 123;
  const rng = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const samples = Array.from({ length: 30000 }, () => humanDelay(rng) / 1000),
    mean = samples.reduce((a, b) => a + b) / samples.length,
    variance =
      samples.reduce((sum, v) => sum + (v - mean) ** 2, 0) / samples.length;
  assert.ok(samples.every((v) => v >= 0 && v <= 5));
  assert.ok(Math.abs(mean - 2) < 0.025);
  assert.ok(Math.abs(variance - 0.5) < 0.035);
});
test("wait resamples numbers outside the allowed range", () => {
  const draws = [1e-12, 0, 0.5, 0.25];
  let at = 0;
  assert.ok(Math.abs(humanDelay(() => draws[at++]) - 2000) < 1e-6);
  assert.equal(at, 4);
});
test("countdown is rounded up, starts at sixty and ends at zero", () => {
  assert.equal(remainingSeconds(61000, 1000), 60);
  assert.equal(remainingSeconds(61000, 60500), 1);
  assert.equal(remainingSeconds(61000, 62000), 0);
});

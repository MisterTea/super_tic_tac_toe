import {
  actionFeatures,
  features,
  legal,
  play,
  macroResult,
  State,
} from "./game";
export type DensePolicy = {
  w1: number[][];
  b1: number[];
  w2: number[][];
  b2: number[];
};
export type Policy =
  DensePolicy | { type: "tactical-linear-v1"; weights: number[] };
export function isPolicy(value: unknown): value is Policy {
  if (!value || typeof value !== "object") return false;
  const tactical = value as { type?: string; weights?: unknown };
  if (tactical.type === "tactical-linear-v1")
    return (
      Array.isArray(tactical.weights) &&
      tactical.weights.length === 12 &&
      tactical.weights.every((x) => typeof x === "number" && Number.isFinite(x))
    );
  const p = value as DensePolicy;
  const vector = (v: unknown, n: number) =>
    Array.isArray(v) &&
    v.length === n &&
    v.every((x) => typeof x === "number" && Number.isFinite(x));
  return (
    vector(p.b1, 128) &&
    vector(p.b2, 81) &&
    Array.isArray(p.w1) &&
    p.w1.length === 128 &&
    p.w1.every((r) => vector(r, 171)) &&
    Array.isArray(p.w2) &&
    p.w2.length === 81 &&
    p.w2.every((r) => vector(r, 128))
  );
}
export function policyMove(s: State, p: Policy): number {
  if ("type" in p) {
    const scores = legal(s).map((a) => ({
      a,
      score: actionFeatures(s, a).reduce((v, x, i) => v + x * p.weights[i], 0),
    }));
    return scores.reduce((best, v) => (v.score > best.score ? v : best)).a;
  }
  const x = features(s),
    h = p.w1.map((row, i) =>
      Math.max(
        0,
        row.reduce((v, w, j) => v + w * x[j], p.b1[i]),
      ),
    );
  const logits = p.w2.map((row, i) =>
    row.reduce((v, w, j) => v + w * h[j], p.b2[i]),
  );
  return legal(s).reduce((a, b) => (logits[b] > logits[a] ? b : a));
}
// Flat Monte Carlo search: tactical wins first, then terminal rollouts.
export function winningActions(s: State): number[] {
  const closable = new Set(
    s.boards.flatMap((value, b) => {
      if (value) return [];
      return [s.turn, 2].some((claim) => {
        const boards = [...s.boards];
        boards[b] = claim;
        return macroResult(boards, s.turn) === s.turn;
      })
        ? [b]
        : [];
    }),
  );
  return legal(s).filter(
    (a) => closable.has(Math.floor(a / 9)) && play(s, a).winner === s.turn,
  );
}
export function searchMove(
  s: State,
  simulations = 700,
  rng: () => number = Math.random,
): number {
  const actions = legal(s),
    stats = actions.map(() => ({ n: 0, v: 0 }));
  const immediate = winningActions(s);
  if (immediate.length) return immediate[0];
  for (let i = 0; i < simulations; i++) {
    const k = i % actions.length;
    let t = play(s, actions[k]);
    while (!t.winner) {
      const a = legal(t);
      const wins = winningActions(t);
      t = play(t, wins.length ? wins[0] : a[Math.floor(rng() * a.length)]);
    }
    stats[k].n++;
    stats[k].v += t.winner === 2 ? 0 : t.winner === s.turn ? 1 : -1;
  }
  return actions[
    stats.reduce(
      (best, v, i) => (v.v / v.n > stats[best].v / stats[best].n ? i : best),
      0,
    )
  ];
}

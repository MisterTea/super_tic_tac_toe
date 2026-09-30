import { actionFeatures, legal, play, State } from "./game";
import { Policy, policyMove, isPolicy, searchMove } from "./ai";

export type Profile = {
  radius: number;
  decay: number;
  macro: number;
  depth: number;
  breadth: number;
};
export type SkillModel = {
  type: "cognitive-skill-v1";
  anchors: number[];
  profiles: Profile[];
  expert: Policy;
  champion?: Profile;
  championEngine?: "monte-carlo-700";
  provenance: { source: string; humanCalibrated: boolean; targetSkill: number };
};
export function isSkillModel(value: unknown): value is SkillModel {
  if (!value || typeof value !== "object") return false;
  const m = value as SkillModel;
  if (m.championEngine && m.championEngine !== "monte-carlo-700") return false;
  if (
    m.champion &&
    (!Number.isFinite(m.champion.depth) ||
      m.champion.depth < 1 ||
      m.champion.depth > 4 ||
      !Number.isFinite(m.champion.breadth) ||
      m.champion.breadth < 1 ||
      m.champion.breadth > 8 ||
      m.champion.macro !== 1 ||
      m.champion.decay !== 0 ||
      !Number.isFinite(m.champion.radius) ||
      m.champion.radius < 12)
  )
    return false;
  return (
    m.type === "cognitive-skill-v1" &&
    isPolicy(m.expert) &&
    "type" in m.expert &&
    m.expert.type === "tactical-linear-v1" &&
    Array.isArray(m.anchors) &&
    m.anchors.length === 5 &&
    m.anchors.every((v, i) => v === i / 4) &&
    Array.isArray(m.profiles) &&
    m.profiles.length === 5 &&
    m.profiles.every(
      (p) =>
        p &&
        Object.values(p).length === 5 &&
        ["radius", "decay", "macro", "depth", "breadth"].every((k) =>
          Number.isFinite(p[k as keyof Profile]),
        ) &&
        p.radius > 0 &&
        p.decay >= 0 &&
        p.macro >= 0 &&
        p.macro <= 1 &&
        p.depth >= 1 &&
        p.depth <= 4 &&
        p.breadth >= 1 &&
        p.breadth <= 8,
    ) &&
    !!m.provenance
  );
}
export const clampSkill = (skill: number) => {
  if (!Number.isFinite(skill)) throw new Error("Skill must be finite");
  return Math.max(0, Math.min(1, skill));
};
export function profileAt(model: SkillModel, skill: number): Profile {
  const k = clampSkill(skill);
  let i = 0;
  while (i < model.anchors.length - 2 && k > model.anchors[i + 1]) i++;
  const t = (k - model.anchors[i]) / (model.anchors[i + 1] - model.anchors[i]);
  const a = model.profiles[i],
    b = model.profiles[i + 1];
  return Object.fromEntries(
    Object.keys(a).map((key) => [
      key,
      a[key as keyof Profile] * (1 - t) + b[key as keyof Profile] * t,
    ]),
  ) as Profile;
}
export function boardCenter(b: number): number[] {
  return [Math.floor(b / 3) * 3 + 1, (b % 3) * 3 + 1];
}
export function fixation(s: State): number[] {
  if (s.moves.length) {
    const a = s.moves[s.moves.length - 1],
      b = Math.floor(a / 9),
      c = a % 9;
    return [Math.floor(b / 3) * 3 + Math.floor(c / 3), (b % 3) * 3 + (c % 3)];
  }
  return s.forced < 0 ? [4, 4] : boardCenter(s.forced);
}
export function attention(distance: number, p: Profile): number {
  return Math.exp(-p.decay * Math.max(0, distance - p.radius));
}
export function evidence(
  s: State,
  a: number,
  p: Profile,
  focus = fixation(s),
): number[] {
  const b = Math.floor(a / 9),
    c = a % 9;
  const notice = (board: number) => {
    const center = boardCenter(board);
    return attention(Math.hypot(center[0] - focus[0], center[1] - focus[1]), p);
  };
  const local = notice(b),
    route = notice(c);
  const ownership = s.boards.flatMap((v, i) =>
    Math.abs(v) === 1 ? [notice(i)] : [],
  );
  const macro =
    p.macro * (ownership.length ? ownership.reduce((a, b) => a * b, 1) : 1);
  return [
    local,
    local,
    local * macro,
    local * macro,
    route,
    route * macro,
    route,
    1,
    local * macro,
    local,
    local * macro,
    local,
  ];
}
function boundedScores(
  s: State,
  weights: number[],
  p: Profile,
  rng: () => number,
) {
  // Correlated omissions: local patterns, routed threats and macro ownership are separate observations.
  const masks = new Map<number, number>();
  const observed = (b: number) => {
    if (!masks.has(b)) {
      const center = boardCenter(b),
        f = fixation(s);
      masks.set(
        b,
        rng() < attention(Math.hypot(center[0] - f[0], center[1] - f[1]), p)
          ? 1
          : 0,
      );
    }
    return masks.get(b)!;
  };
  const macro = rng() < p.macro ? 1 : 0;
  const macroNoticed = (t: State) =>
    macro && t.boards.every((v, b) => Math.abs(v) !== 1 || observed(b) === 1)
      ? 1
      : 0;
  const score = (t: State, a: number) => {
    const b = Math.floor(a / 9),
      c = a % 9,
      x = actionFeatures(t, a);
    const local = observed(b),
      route = observed(c);
    const macroSeen = macroNoticed(t);
    const gates = [
      local,
      local,
      local * macroSeen,
      local * macroSeen,
      route,
      route * macroSeen,
      route,
      1,
      local * macroSeen,
      local,
      local * macroSeen,
      local,
    ];
    return x.reduce((v, x, i) => v + x * weights[i] * gates[i], 0);
  };
  // Hard ply limit and candidate budget. No full-game rollouts at intermediate skill.
  let nodes = 0;
  const budget = 400;
  const walk = (t: State, depth: number): number => {
    if (t.winner) return t.winner === 2 || !macroNoticed(t) ? 0 : -1000;
    if (depth <= 0 || nodes >= budget) return 0;
    const ranked = legal(t)
      .map((a) => ({ a, v: score(t, a) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, Math.max(1, Math.round(p.breadth)));
    let best = -Infinity;
    for (const { a, v } of ranked) {
      if (nodes >= budget) break;
      nodes++;
      best = Math.max(best, v - (depth > 1 ? walk(play(t, a), depth - 1) : 0));
    }
    return best;
  };
  const depth = Math.max(
    1,
    Math.floor(p.depth) + (rng() < p.depth % 1 ? 1 : 0),
  );
  const candidates = legal(s)
    .map((a) => ({ a, score: score(s, a), tie: rng() }))
    .sort((a, b) => b.score - a.score || a.tie - b.tie)
    .slice(0, Math.max(1, Math.round(p.breadth)));
  return candidates.map(({ a, score }) => {
    nodes = 0;
    return { a, score: score - (depth > 1 ? walk(play(s, a), depth - 1) : 0) };
  });
}
export function skillMove(
  s: State,
  skill: number,
  model: SkillModel,
  rng: () => number = Math.random,
): number {
  const k = clampSkill(skill),
    actions = legal(s);
  if (!actions.length) throw new Error("No legal moves");
  if (k === 0)
    return actions[
      Math.min(actions.length - 1, Math.floor(rng() * actions.length))
    ];
  if (k === 1 && model.championEngine === "monte-carlo-700")
    return searchMove(s, 700, rng);
  if (k === 1 && !model.champion) return policyMove(s, model.expert);
  if (!("type" in model.expert) || model.expert.type !== "tactical-linear-v1")
    throw new Error("Cognitive model requires a tactical expert");
  const scores = boundedScores(
    s,
    model.expert.weights,
    k === 1 && model.champion ? model.champion : profileAt(model, k),
    rng,
  );
  const best = Math.max(...scores.map((x) => x.score));
  const ties = scores.filter((x) => Math.abs(x.score - best) < 1e-9);
  return ties[Math.min(ties.length - 1, Math.floor(rng() * ties.length))].a;
}

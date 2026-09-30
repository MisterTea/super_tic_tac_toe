import { InferenceSession, Tensor, env } from "onnxruntime-web/wasm";
import { actionFeatures, legal, play, State } from "./game";
import { boardCenter, fixation } from "./skill";
export const difficultyToSkill = (difficulty: number) => {
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 10)
    throw new Error("Difficulty must be 1–10");
  return difficulty / 10;
};
export class BrowserAI {
  constructor(private session: InferenceSession) {}
  async evaluate(
    s: State,
    skill: number,
    distances: Float32Array,
    noise: Float32Array,
  ) {
    const actions = legal(s),
      allowed = new Set(actions),
      features = new Float32Array(81 * 12);
    for (const a of actions) features.set(actionFeatures(s, a), a * 12);
    const result = await this.session.run({
      features: new Tensor("float32", features, [81, 12]),
      skill: new Tensor("float32", Float32Array.of(skill), [1]),
      distances: new Tensor("float32", distances, [9]),
      ownership: new Tensor(
        "float32",
        Float32Array.from(s.boards, (v) => (Math.abs(v) === 1 ? 1 : 0)),
        [9],
      ),
      noise: new Tensor("float32", noise, [10]),
      legal_mask: new Tensor(
        "float32",
        Float32Array.from({ length: 81 }, (_, a) =>
          allowed.has(a) ? 0 : -1e9,
        ),
        [81],
      ),
      terminal: new Tensor(
        "float32",
        Float32Array.of(s.winner && s.winner !== 2 ? 1 : 0),
        [1],
      ),
    });
    return {
      logits: result.logits.data as Float32Array,
      profile: result.profile.data as Float32Array,
      terminal: Number(result.terminal_value.data[0]),
    };
  }
  async move(
    s: State,
    skill: number,
    cancelled: () => boolean = () => false,
    rng: () => number = Math.random,
  ): Promise<number> {
    if (!Number.isFinite(skill) || skill < 0 || skill > 1)
      throw new Error("Skill must be in [0,1]");
    const actions = legal(s);
    if (!actions.length) throw new Error("No legal moves");
    const f = fixation(s),
      distances = Float32Array.from({ length: 9 }, (_, b) => {
        const c = boardCenter(b);
        return Math.hypot(c[0] - f[0], c[1] - f[1]);
      }),
      noise = Float32Array.from({ length: 10 }, rng);
    const evaluate = async (t: State) => {
      if (cancelled()) throw new Error("AI move cancelled");
      return this.evaluate(t, skill, distances, noise);
    };
    const root = await evaluate(s),
      expectedDepth = root.profile[3],
      depth = Math.floor(expectedDepth) + (rng() < expectedDepth % 1 ? 1 : 0),
      breadth = Math.max(1, Math.round(root.profile[4]));
    let nodes = 0;
    const walk = async (t: State, left: number): Promise<number> => {
      if (left <= 0 || nodes >= 400) return 0;
      const prediction = await evaluate(t);
      if (t.winner) return prediction.terminal;
      const candidates = legal(t)
        .map((a) => ({ a, score: prediction.logits[a] }))
        .sort((a, b) => b.score - a.score)
        .slice(0, breadth);
      let best = -Infinity;
      for (const { a, score } of candidates) {
        if (nodes >= 400) break;
        nodes++;
        best = Math.max(
          best,
          score - (left > 1 ? await walk(play(t, a), left - 1) : 0),
        );
      }
      return best;
    };
    const candidates = actions
      .map((a) => ({ a, score: root.logits[a], tie: rng() }))
      .sort((a, b) => b.score - a.score || a.tie - b.tie)
      .slice(0, breadth);
    const scores = [];
    for (const c of candidates) {
      nodes = 0;
      scores.push({
        a: c.a,
        score: c.score - (depth > 1 ? await walk(play(s, c.a), depth - 1) : 0),
      });
    }
    const best = Math.max(...scores.map((x) => x.score)),
      ties = scores.filter((x) => Math.abs(x.score - best) < 1e-6);
    return ties[Math.min(ties.length - 1, Math.floor(rng() * ties.length))].a;
  }
}
let loading: Promise<BrowserAI> | null = null;
export function loadBrowserAI(): Promise<BrowserAI> {
  if (!loading)
    loading = (async () => {
      env.wasm.numThreads = 1;
      env.wasm.wasmPaths = new URL("/ai/ort/", window.location.href).href;
      const session = await InferenceSession.create("/ai/policy.onnx", {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
      return new BrowserAI(session);
    })().catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

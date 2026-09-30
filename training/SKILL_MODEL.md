# Skill-conditioned cognitive policy

The reference export `public/skill-policy.json` embeds the RL tactical weights and learned resource profiles at skill anchors 0, .25, .5, .75, 1. Profiles interpolate continuously. `npm run export:ai` packages these weights and profiles into the PyTorch graph exported as `public/ai/policy.onnx`. Browser inference uses ONNX Runtime Web / WASM. The live endpoints are:

- **0:** uniform sampling over the real legal action list: the graph returns equal logits and a breadth of 81. This API endpoint is outside the UI range.
- **1:** full-attention RL tactical scorer with the maximum learned depth and breadth (currently 3 ply / 6 candidates). All scored states use the PyTorch graph. This browser deployment excludes the separate JavaScript Monte Carlo champion previously selected by offline benchmarks; its strength claims do not transfer to this deployment.
- **Between:** the same tactical scorer receives incomplete observations and a hard calculation budget. There is no skill-dependent temperature.

## What causes mistakes

Fixation defaults to the previous mark (or the forced board / center on an empty history). Absolute coordinates are on the visible 9×9 grid. A board's notice probability is 1 inside a learned foveal radius, then `exp(-decay * (distance - radius))` outside. Each board's observation is sampled once per decision and reused in every branch: local wins, blocks and line potential disappear together when that board is missed. Routing threats depend on attention at the destination board. Macro-board patterns additionally require learned macro awareness and observation of already claimed boards. Legal moves always come from the true state; attention failures never permit illegal moves.

Depth is a learned expected ply count; fractional depths sample the adjacent integer budgets. Candidate breadth is rounded to a hard limit at the root and subsequent nodes. Each root candidate has a 400-node safety cap. No intermediate player receives full-game Monte Carlo rollouts or an unbounded tactical-win override. Tie breaking adds variety only among equal scores. Memory is held constant during a decision, with a new attention sample at the next move.

This is a deliberately simplified cognitive simulator: radial board-level foveation, one fixation, no eye-movement trajectory, no fatigue, no learned fixation controller, and no separate long-term spatial memory decay. Spatial decay here means declining attention with visual distance. Skill 1 removes perceptual omissions and uses the maximum learned planning budget; intermediate profiles can sometimes win against it. Exact game-strength monotonicity is not guaranteed by increasing resources.

## Training and human fitting

```sh
python training/train_skill.py --epochs 600
python training/select_champion.py --games 60
python training/evaluate_skill.py --games 100 --skills 0,.25,.5,.75
npm run export:ai
```

PyTorch learns five monotone resource curves from declared synthetic priors, producing a provisional bootstrapped model. That learning is supervised fitting of a resource hypothesis, not evidence that the hypothesis matches humans. Reward-maximizing RL supplies the expert evaluator; human-style limitations require behavioral fitting rather than training every skill to exploit its limits perfectly.

Human moves can then fit all five resource parameters with simulation likelihood, including discrete depth and candidate breadth. Common random seeds reduce comparison noise. Coordinate updates preserve resource ordering across skill anchors. The fitter uses smoothed Monte Carlo action likelihood; smoothing is not the runtime action policy or temperature. Fit quality is in-sample; a separate participant split is required to validate it.

One JSONL row per choice (example schema, not actual human data):

```json
{
  "source": "human",
  "participantId": "anonymous-17",
  "cohort": "novice-middle-school",
  "skill": 0.5,
  "moves": [40],
  "action": 36,
  "fixation": [4, 4]
}
```

`moves` is the valid preceding action history; `action` is the observed human choice; `skill` is a supplied cohort/ability target between 0 and 1. Optional `fixation` is a measured gaze coordinate in 0..8 grid units. Without gaze data the fitter uses the previous-mark heuristic. Participant/cohort metadata should be kept for splitting and reporting; the fitter does not infer age or experience from moves. Endpoint data is excluded because its contracts are fixed.

```sh
python training/train_skill.py --human-data human-train.jsonl --samples 64
python training/select_champion.py --games 100
npm run export:ai
```

The export keeps `humanCalibrated: false` even after fitting human logs. To call 0.5 “average novice middle schooler,” collect representative participants who know ordinary tic-tac-toe but have no Ultimate experience, use a consistent rules tutorial, and evaluate held-out participants. Compare move agreement, missed local blocks, missed macro threats, routing mistakes, gaze-distance effects, decision time, and game results. Win rate alone is insufficient. Attention radius and calculation depth may explain the same mistake, so gaze and timing help identify them. Do not collect identifying details in game logs.

The initial shipped curve is a novice-target hypothesis. Training metrics, champion selection and strength sweeps are stored in `training/skill-training-results.json`, `training/champion-selection.json`, and `training/skill-evaluation.json`. Small sweeps are diagnostics, not calibrated human ratings.

Historical Python reference sweep **before the separate Monte Carlo endpoint selection** (seed 4567, 60 games per cell, alternating seats; draws count as half a point):

| Skill                 | Score vs random | Score vs tactical |
| --------------------- | --------------- | ----------------- |
| 0                     | 48.3%           | 4.2%              |
| .25                   | 69.2%           | 4.2%              |
| .5                    | 85.0%           | 19.2%             |
| .75                   | 91.7%           | 75.8%             |
| 1 (bounded reference) | 100.0%          | 90.0%             |

The selected bounded candidate uses full attention, depth 3 and breadth 6. On the selection seed, it scored 91.7% against the tactical opponent, compared with the raw policy's 65.0%. Depth 4 tied, so the cheaper depth-3 planner was retained. The bounded candidate then won 17 / drew 2 / lost 1 against the raw RL player, but won only 4 / drew 4 / lost 12 against Monte Carlo in 20-game head-to-head tests (seed 6611). Monte Carlo therefore became the offline reference's 1.0 endpoint. The current browser ONNX deployment uses the bounded PyTorch scorer at 1.0 instead; no Monte Carlo rollouts are performed in computer mode. Intermediate calculation budgets remain capped at 3 ply / 6 candidates. The sweep's 1.0 row describes the earlier bounded candidate, not a measured result for the current WASM deployment. Head-to-head measurements are in `training/champion-head-to-head.json`.

The UI offers a single computer opponent with ten discrete difficulties, mapping 1–10 to skill 0.1–1.0. Its module, ONNX model, and self-hosted WASM runtime load only when **Play the computer** is clicked. The session is reused across games, with every computer move evaluated locally. There is no remote inference request or alternate JavaScript bot fallback. Load and inference failures are shown visibly.

After retraining tactical weights, regenerate the skill export, then run `npm run export:ai`; the conditioned export deliberately embeds a reproducible expert snapshot. The command also refreshes PyTorch output fixtures used by `e2e/model-parity.spec.ts`. That browser test verifies logits, profiles and terminal values for all ten UI skills on three board states. Other browser tests exercise on-demand loading, model reuse, failure/retry, offline inference after loading, and mobile layout. Human fitting operates on intermediate choices and does not downgrade the full-attention endpoint.

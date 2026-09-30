# Ultimate Relay

Ultimate tic-tac-toe in Next.js / TypeScript. A skill-conditioned PyTorch AI running locally in the browser, private invite games with spectators, and random matchmaking over Nostr/WebRTC.

Next to **Play the computer**, the difficulty slider has ten positions: 1–10 map directly to model skill 0.1–1.0. Clicking the button lazily loads the PyTorch model exported to ONNX and its WebAssembly runtime; all computer moves then use that local model. Difficulty 10 uses the full-attention trained scorer with the maximum learned calculation budget. The model API also supports exactly random legal moves at skill 0, which is outside the UI slider range. Intermediate skill uses learned visual attention, spatial decay, macro awareness, bounded search depth and candidate breadth—not temperature scaling. The 0.5 novice target is provisional; no middle-school human dataset has been fitted. Training, human move-log fitting, limitations and calibration procedure are described in [training/SKILL_MODEL.md](training/SKILL_MODEL.md).

## Run

```sh
npm install
npm run dev
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Open http://localhost:3000 and choose **Play the computer**, **Play random opponent**, or **Host game**. Selecting a mode clears the choices. Computer mode has a single **New Game** button and retains the difficulty chosen before starting. AI works without relays.

**Host game** creates a private lobby and an invite URL with a `code` query parameter. The code contains the host's ephemeral public key and a random 256-bit invite secret. The URL includes the relay configuration so visitors can use the same relays. Opening it automatically joins: the first visitor becomes guest O; later visitors watch in read-only mode, including the current board and turn timer. X is the host. Spectator messages cannot play either side. There is a cap of 32 peer connections per host. The host must keep the tab open; refreshing creates a new identity and does not restore a seat.

**Play random opponent** discovers fresh, signed available-player entries, chooses a random candidate, and sends an encrypted claim. If the attempt fails it enters the pool. Pool entries expire in 30 seconds and are refreshed while searching; withdrawals prevent matching a busy client. Searching shows a 30-second progress scale. If no connection is ready by ten seconds from clicking, the client withdraws and starts a local practice match. Consequently the progress bar normally stops at ten seconds when the practice match begins. The practice computer waits a sampled normal delay with mean 2 seconds and variance 0.5 seconds squared, rejecting negative waits and samples above 5 seconds. Model inference then chooses its move.

Online and practice matches display whose turn it is and a 60-second countdown. At expiry, a uniformly random legal move is played. The host enforces both seats' clocks in a real online game and streams the resulting state to everyone; the browser enforces both clocks for practice matches. Spectators never run move timers. Untimed direct computer games retain normal computer play.

## Protocol

Signed, verified Nostr kind 20078 events tagged `t=ultimate-relay-v2` coordinate matchmaking and private WebRTC signaling. Available-player entries and withdrawals are public. Invite codes, claims, joins, SDP, ICE, and end notices are NIP-44 encrypted for each recipient. Private rooms have no public lobby advertisements. This is an application-specific experimental protocol; relay operators can still see public keys, recipients, timestamps, and traffic volume. Anyone with the invite link can join or watch. Referrer metadata is disabled to avoid sending invite query parameters to external sites.

Reliable ordered WebRTC channels form a star around the host. The host validates guest action indices and sequence numbers, applies legal moves, and sends full move histories and deadlines to the guest and spectators. Receivers independently replay legal histories and check existing prefixes. The host is the game authority; this is not a trustless competitive protocol. No accounts, ranking service, seat recovery, or persistent game storage is provided.

Explicit leave messages, data-channel closure, failed peer connections, and a 12-second heartbeat timeout detect player departures. After a match starts, guest departure awards X an abandonment win, and host departure awards O an abandonment win. The remaining player sees **You win**, and spectators see the winning mark and departure reason. A departure after a completed game preserves the original win or draw. Departures before a match starts do not award a win. Spectator departures only remove that viewer. Closing a browser can delay notification until heartbeat expiry. A suspended/backgrounded host cannot enforce clocks while its JavaScript is stopped; enforcement resumes when it wakes. Use a dedicated coordinator if clocks must continue while the host is suspended.

Relay settings are available before choosing a game. Ephemeral generated Nostr identities last for the connection; no wallet is required. Public relays can refuse ephemeral events or rate-limit clients. For an optional public-relay smoke test, set `PUBLIC_RELAYS=wss://relay.damus.io,wss://nos.lol` and run `npx playwright test e2e/public-relays.spec.ts`.

For restrictive networks provide TURN through `NEXT_PUBLIC_ICE_SERVERS`, a JSON array of RTCIceServer objects (e.g. `[{"urls":"turn:your-host:3478","username":"...","credential":"..."}]`). Browser credentials are public: use short-lived TURN credentials in production. Default STUN alone cannot traverse every NAT.

Rules follow https://en.wikipedia.org/wiki/Ultimate_tic-tac-toe: won/full small boards close; being sent to a closed board gives free choice; three claimed boards in a line wins; no playable boards means draw.

## Deployment

The [GitHub repository](https://github.com/MisterTea/super_tic_tac_toe) is connected to the Vercel project `tic-tac-toe-royale` in the `aquinas` team. Pushes to `main` automatically build and deploy production; other branches receive preview deployments through Vercel's Git integration.

Production: [tic-tac-toe-royale-liard.vercel.app](https://tic-tac-toe-royale-liard.vercel.app). Vercel runs the package's install and build scripts, including `postinstall` to copy the self-hosted WebAssembly runtime. The ONNX model is committed, so deployment does not require Python or retraining. Keep local environment files and `.vercel` metadata out of Git; `.env.example` documents optional TURN configuration.

## Sound and browser tests

X uses a higher placement pitch than O. Wins play a four-note fanfare; losses play a descending filtered-noise woosh. Effects use Web Audio synthesis without remote audio files. Audio unlocks after a user gesture, and the header's sound toggle stores a mute preference locally. New games and late spectator snapshots do not replay old sounds. Spectators hear new placements but have no personal win/loss effect.

```sh
npx playwright install chromium
npm run test:e2e
# Only gameplay and sound flows:
npx playwright test e2e/browser-ai.spec.ts e2e/game.spec.ts e2e/sounds.spec.ts
```

The suite launches separate browser contexts for host, guest and spectators against a local relay that validates real Nostr signatures. It exercises the real WebRTC channels and ONNX browser model. Coverage includes single-player moves and restarts, private invite joins, read-only live and late viewers, pool matchmaking, failed connections, timed AI fallback, 60-second automatic random legal moves for both seats in invite and matchmaking games, host/guest abandonment wins, and preservation of completed results. Browser clocks accelerate the turn tests while real WebRTC heartbeat delivery is drained between advances. Controlled random draws verify which legal square is chosen at timeout.

Sound tests wrap real Web Audio nodes to record distinct placement pitches, fanfare notes and noise-source playback. A fixed 47-move legal game reaches a natural win in two browsers and checks both result sounds exactly once, mute persistence, and silence for old spectator snapshots. Playwright retains a trace on failure for debugging.

## Reinforcement learning

```sh
python -m pip install -r training/requirements.txt
python -m unittest discover -s training
npm run test:parity
python training/train.py --updates 1000 --batch 32 --eval-games 200
python training/evaluate.py --games 300
python training/train_tactical.py --updates 100 --batch 16
python training/evaluate.py --checkpoint training/checkpoints/tactical.pt --games 500 --output training/tactical-evaluation.json
```

Independent Python rules engine, masked actor-critic policy, discounted terminal rewards, entropy regularization, gradient clipping, randomized seats and a rolling frozen-opponent pool. 25% of opponent moves are random for exploration. Features: 81 own cells, 81 opponent cells, 9 eligible-board indicators; network: 171 → 128 ReLU → 81 action logits plus training-only value head. Illegal logits are masked.

Training saves model/optimizer checkpoints and metrics to `training/checkpoints`, and reference weights to `public/policy.json`. `--resume training/checkpoints/policy.pt` continues optimization. The browser uses the separate skill-conditioned ONNX export described below. Model-load failures are shown with a retry button; there is no alternative bot fallback. Evaluation reports greedy policy win/draw/loss against uniform random with alternating seats; this does not establish strength against search or humans. Larger training budgets and stronger evaluation are necessary before calling a model strong.

To update the browser model after tactical training or human fitting:

```sh
python training/train_skill.py --epochs 600
npm run export:ai
```

`export:ai` exports the expert weights and cognitive profiles from `public/skill-policy.json` into `public/ai/policy.onnx`, saves the corresponding PyTorch checkpoint, regenerates browser parity fixtures, and copies the ONNX Runtime assets. `npm install` also copies those assets through `postinstall`. Reload the page after re-exporting. The checked-in ONNX model is ready to use without Python installed on the hosting server.

Inference uses ONNX Runtime Web with the WASM execution provider. All model and runtime assets are served from the app's own origin. The session is downloaded once when **Play the computer** is clicked and reused across games. No inference server or external model API is needed. The PyTorch graph computes attention gates, tactical logits, calculation budgets, and terminal values; TypeScript supplies legal game states, features, and the bounded planning controller. Every scored search position runs through the exported model. The former JavaScript policy and Monte Carlo players remain offline references and are not computer-mode fallbacks.

The included default export uses the stronger `tactical-linear-v1` policy. `train_tactical.py` learns shared priorities for 12 player-relative move features (local wins/blocks, macro wins/blocks, routing danger, free choice, centers, and line potential). It warm-starts tactical priorities, then optimizes them with REINFORCE, a moving reward baseline, entropy regularization, and a mixture of tactical, random, and frozen self-play opponents. It selects checkpoints on a fixed validation seed; `evaluate.py` uses a different seed for the final benchmark. This is a compact feature-based RL policy, not a deep policy learned from scratch. The dense actor-critic trainer remains available for experiments.

Each trainer replaces `public/policy.json` with its own export. Both reference formats are covered by Python/TypeScript feature and inference parity tests. The live browser export uses the tactical snapshot embedded in `public/skill-policy.json`; the dense trainer remains an offline experiment. Tactical training saves `training/checkpoints/tactical.pt` and `training/tactical-results.json`; the original dense run is recorded in `training/training-results.json` and `training/evaluation.json`.

Included policy benchmark (held-out seed 12345, 500 games per opponent, alternating seats): 483 wins / 15 draws / 2 losses against random (98.1% score); 193 wins / 172 draws / 135 losses against the tactical heuristic (55.8% score). Scores count a draw as half a point. These establish strength against those baselines, not human or strong search play. Full results and confidence intervals are in `training/tactical-evaluation.json`. The tactical run used 1,600 training games after a handcrafted warm start; the separate dense experiments used 20,800 games.

On that same held-out tactical benchmark, the warm start before RL scored 46.1% (133 wins / 195 draws / 172 losses), recorded in `training/warm-start-evaluation.json`. Training therefore improved the point score by 9.7 percentage points. The separately reported confidence intervals are approximate marginal intervals, not a paired significance test.

The browser suite tests actual peer connections through a minimal local signed-event relay. For an optional public-relay smoke test, set `PUBLIC_RELAYS=wss://relay.damus.io,wss://nos.lol` and run `npx playwright test e2e/public-relays.spec.ts`. Public-relay tests depend on network availability and relay policy.

`npm run test:parity` requires Python (and PyTorch for policy inference parity). It checks every state of 20 complete games against both engines, and verifies exported browser actions against PyTorch. The browser suite separately compares actual WASM graph outputs against PyTorch fixtures across all ten UI skill levels, verifies lazy loading and session reuse, exercises load failure/retry, and confirms gameplay continues with subsequent asset requests blocked.

`training/evaluate.py` benchmarks the greedy policy against independent random and tactical opponents with alternating seats and approximate confidence intervals. Use a different evaluation seed from training. Checkpoint files should only be loaded from trusted sources.

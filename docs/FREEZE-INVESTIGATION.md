# Freeze investigation — September 30, 2026

Baseline: latest `origin/main`, `e0fcc2e`.

## Findings

Production Vercel logs contain a `POST /api/rpc` HTTP 504 on deployment
`dpl_CpduoGBGiC1ahs3ALrt7iLtZBSzc`: the function exceeded its 300-second runtime
limit. Earlier deployments also logged database connection timeouts in session
lookups. Those logs establish a real backend stall; they do not identify the SQL
statement that stalled or prove that every reported freeze has the same cause.

An isolated PostgreSQL reproduction confirmed a deadlock on the immediate requeue
path. `royale.join` wrote shared telemetry before acquiring lobby locks, while
the tournament driver acquired a tournament lock before writing telemetry.
Concurrent requests could therefore wait on each other. Before the fix, the
reproduction returned PostgreSQL `40P01` (`deadlock detected`) after 1,057 ms.
After the fix, both operations succeeded in 153 ms. PostgreSQL normally detects
and aborts deadlocks: this alone does not explain a full 300-second timeout.

The browser polling hook allows one outstanding request at a time. Previously,
RPC requests had no deadline, so a stalled request prevented fresh dashboard
polls. Errors were silently ignored while the last board stayed on screen.
That turns backend connection or lock problems into an apparent frozen game.

## Changes

- Acquire gameplay locks before requeue telemetry. Public matchmaking selects
  one available lobby with `FOR UPDATE SKIP LOCKED`, avoiding locks on every
  candidate lobby and waiting behind a busy lobby.
- Abort browser RPCs after 12 seconds, let polling resume, and display reconnect
  status while preserving the last confirmed game state.
- Bound database connection acquisition to 5 seconds and client queries to 12
  seconds. Transactions use `SET LOCAL` for a 10-second statement timeout,
  3-second lock timeout, and 15-second idle transaction timeout, compatible with
  transaction pooling. These are individual-operation limits, not a whole-RPC
  deadline.
- Roll back and retry deadlocks and serialization failures at most twice, with
  jitter; discard connections when rollback fails.
- Log slow requests, database failures, and tournament-driver failures without
  logging credentials or RPC arguments. Unexpected RPC failures return HTTP 503
  with a retry message.

## Verification

All stress mutations used a separate local PostgreSQL 17 database. No production
players, game records, or telemetry were modified by the stress harnesses.

- Four concurrent repeat players each entered six CPU-filled Royales, made legal
  moves, resigned, and requeued while their previous brackets continued. All 24
  brackets finished. First run: 4,705 operations, zero errors, 7.139 seconds,
  p95 29 ms, maximum 217 ms, event-loop p99 31 ms, peak pool waiters 4. Test-only
  countdowns and bot delays were shortened.
  A repeat with the final transaction timeouts passed again: 4,656 operations,
  zero errors, 6.932 seconds, p95 28 ms, maximum 167 ms.
- Six consecutive games in Chromium retained one guest identity. After game
  three, dashboard requests were deliberately stalled. The browser showed
  reconnect status after the deadline, recovered when the connection resumed,
  and continued through game six without JavaScript errors.
- Unit tests verify hung-RPC cancellation and recovery, rollback/retry after
  deadlock, and discarding a connection whose rollback fails.
- A full Royale with 16 independent Chromium sessions completed all 15 matches
  through 750 board clicks in 3.4 minutes. All 16 result screens, retained guest
  identities, exactly one crown, and exactly one reward per player were verified;
  there were no JavaScript errors or transient move failures.
- Action fault injection stalls `royale.move` before server acceptance and after
  acceptance with its response lost. Both hit the 12-second client deadline
  (12,206 ms and 12,154 ms observed), show the timeout message, and release the
  pending controls. The unaccepted optimistic move rolls back and can be retried;
  an accepted move stays reconciled through polling. Each player move is recorded
  exactly once, and the player can subsequently resign and reach results.
- A separate browser test leaves a turn unanswered with the normal 15-second
  clock. The server finishes the match for reason `clock`, shows the result, and
  lets the same player host another Royale. All three timeout tests passed.

Local results do not measure production Neon latency, cold starts, or deployment
concurrency limits. The reproduced deadlock and missing client deadline are
confirmed defects; production logs should be monitored after deployment for
additional independent sources of stalls.

## Background window checks

`e2e/background-freeze.spec.ts` launches a real Chromium window, minimizes it,
asserts `document.visibilityState === 'hidden'`, and explicitly freezes and
resumes its lifecycle. The smoke test verifies actual document `freeze`/`resume`
events. Normal background throttling is enabled. Playwright's usual forced-focus
override is disabled through [CDP's `noDefaults` connection option](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp);
foreground focus is emulated only after restoring the window because Windows
can refuse focus while another desktop app is active.

The following checks passed:

- Freeze during ONNX/WASM loading, resume, then complete a legal computer turn.
- Three difficulty-10 computer games with two freeze/resume cycles per game:
  controls recovered after every turn, model loaded only once, no JavaScript
  errors.
- Hold a Royale hosting action while the window is frozen for 16 seconds,
  exceeding its RPC deadline. Controls released 89 ms after return, with the
  timeout message visible.
- Freeze an active Royale for 18 seconds. Its server-side clock still settled
  the match while the browser was frozen; the result synchronized 131 ms after
  return, and the same player could host another game.

These checks did not reproduce a persistent WASM lock. Browser WASM is used by
the explicit computer mode; Royale CPU turns run on the server. These are local
Chromium checks, not coverage of every mobile browser or operating-system sleep
behavior.

## Reproduce safely

The stress scripts refuse any database URL other than the disposable local
database below. Initialize that database with `initDb()`; start a localhost-only
Next server on port 3100 with the same URL for browser tests.

```powershell
$env:DATABASE_URL='postgresql://stress_user@127.0.0.1:55432/freeze_stress'
npx tsx scripts/stress-freeze-locks.ts
npx tsx scripts/stress-royale-repeat.ts
npm test
npm run test:backend
$env:E2E_BASE_URL='http://127.0.0.1:3100'
npx playwright test e2e/freeze-stress.spec.ts
npx playwright test e2e/background-freeze.spec.ts
```

`test:backend` clears its database between tests. Never point it at production.
Stress summaries and browser screenshots/traces are written under the ignored
`artifacts/freeze-stress/` directory. The browser recovery test requires base URL
`http://127.0.0.1:3100` and the disposable database URL; otherwise it skips.

## Extended stress run and independent watchdog

Follow-up baseline: `86f125f` on main. All mutations again used the disposable
localhost database, not production.

Two additional lock cycles were reproduced despite bounded automatic retries:

- Daily return wrote the shared telemetry rollup before updating the profile,
  while reward/profile writers did the reverse. PostgreSQL reported `40P01`;
  the retry completed after 1,129 ms. Updating the profile first reduced the
  reproduction to 169 ms with zero deadlocks.
- Match-start telemetry for CPU-only matches took the rollup lock before a
  later human match updated `played_at`. A concurrent profile writer held the
  profile while waiting for the rollup. This reproduced `40P01` and took
  1,190 ms; locking every human entrant in sorted order before any telemetry
  reduced it to 187 ms with zero deadlocks. `FOR NO KEY UPDATE` keeps reward
  and activity foreign-key checks compatible.

Account mutations serialize on the authentication user before choosing a
lobby. Join/leave and account linking follow consistent tournament/profile/
telemetry ordering. Concurrent joins for one account create one lobby entry.
Telemetry locks its global rollup before reading existing facts or counters,
then accesses campaign/day rows. This prevents stale counter overwrites and
campaign/global lock inversions; it does not recompute historical totals.

The final repeated-game run used 16 workers entering ten Royales apiece while
abandoned brackets continued: all 160 completed, 50,759 measured operations,
zero errors, zero PostgreSQL deadlocks, 80.714 seconds, p95 197 ms, maximum
518 ms, event-loop maximum 35 ms, and peak pool waiters 140. Countdown and
bot delays were shortened only in these fixtures.

Eight concurrent strongest-engine brackets exposed CPU starvation separately:
one driver computed every due match synchronously, blocking the event loop
for 8,984 ms. Drivers now compute at most two oldest-due moves per pass, and a
process-wide queue yields between individual searches. The same stress case
completed all eight driver requests in 5,570 ms, with event-loop maximum
453 ms; a final repeat verified 16 CPU moves in 3,580 ms with a 278 ms
maximum event-loop stall. Later overdue turns remain scheduled, and a regression test verifies
that every first-round match receives a turn without starvation. This is
cooperative scheduling on one process, not a production throughput benchmark.

The independent watchdog is `GET /api/cron/royale`, protected by the server-only
`CRON_SECRET`. Vercel runs it every minute. Each invocation examines at most
50 stale active/lobby records in oldest-update order and stops starting new
work after 20 seconds, with a 60-second function runtime limit. It awaits the
normal driver, which rechecks deadlines and move sequences under the tournament
lock. It does not invent winners or expire a future turn. Recovery telemetry
is written in the same transaction only when state actually advances. Held
locks and partial failures are logged and return 503; subsequent minutely
runs can retry. Overlapping drivers and repeated recovery cannot award a
second crown or reward.

Regression tests cover a lost countdown, expired human clocks, an overdue
lobby, healthy future deadlines, simultaneous recovery/dashboard reads, a lost
final awarding exactly one crown, and a held database lock followed by successful
recovery. Authorization tests reject missing/incorrect secrets before any game
work and report scan failures without exposing database details.

The complete browser rerun includes public-relay multiplayer, lost/late action
responses, normal turn expiry, six repeated games, actual minimized/frozen
Chromium and WASM recovery, and a 16-session, 750-click tournament ending in
one crown and fifteen defeats. It also exposed a bootstrap remount that closed
an open feedback form. Keeping the page shell mounted preserves the dialog
and typed feedback across guest setup; the regression deliberately delays
profile creation to exercise that transition. Leaderboard/telemetry browser
tests now use the migrated HTTP RPC API and read the stat label explicitly.

Reproduce the additional stress cases:

```powershell
$env:DATABASE_URL='postgresql://stress_user@127.0.0.1:55432/freeze_stress'
npx tsx scripts/stress-profile-locks.ts
$env:LOCK_CASE='driver'
npx tsx scripts/stress-profile-locks.ts
Remove-Item Env:LOCK_CASE
$env:STRESS_WORKERS='16'
$env:STRESS_ROUNDS='10'
npx tsx scripts/stress-royale-repeat.ts
npx tsx scripts/stress-strong-cpu.ts
```

Keep destructive backend suites separate from concurrent browser/stress runs.
Local stress does not reproduce every mobile browser, Neon cold start, or Vercel
concurrency limit; production watchdog and slow-request logs remain useful.

Final validation: 42 core/client/watchdog tests, 24 PostgreSQL backend tests,
3 Python/TypeScript/PyTorch/WASM parity tests, and 34 browser tests passed
(103 total). The single browser scenario for an unconfigured database skipped
on this configured server. TypeScript and the optimized production build passed.

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

# Tic Tac Toe Royale

Royale uses an authoritative Convex backend. The Vercel frontend subscribes to a saved guest profile, a shared rank-tier lobby, and its tournament. The home page offers Royale plus a Single game section. Its computer and host links open `/practice?mode=computer` and `/practice?mode=host` directly; private invites remain at `/practice?code=…`. Random matchmaking is no longer offered.

Live site: https://super-tic-tac-toe-royale.vercel.app. The development deployment is `keen-firefly-898`; production is `greedy-seal-619`. Guest play and Sign in with Vercel are enabled. See [telemetry and OAuth operations](TELEMETRY.md).

Play starts as a guest without a login requirement. The main page offers optional login; after a guest's first Royale result, a dismissible popover encourages saving progress across devices. The prompt is shown once per guest profile in the browser. Login is available again after active participation ends.

The player profile links to `/account`. Guests see the optional login screen; signed-in players can edit their name and manage their collection. Names use 3–24 letters, numbers, spaces, hyphens, or underscores and are reserved case-insensitively in a shared `nameClaims` registry. New players and CPU entrants use `unique-names-generator` with two capitalized words; generation retries database collisions inside the transaction. Names are immutable during active participation. Run `npx convex run --prod names:migrate '{}'` once when introducing the registry to reserve existing player names and resolve any legacy duplicates.

The public `/leaderboard` page and home page show up to ten signed-in accounts ordered by rank points, crowns, and XP. Guests and retired linked profiles never appear. Accounts participate by default and can check “Hide me from the leaderboard” in account settings; this preference persists without affecting rank or rewards. Existing accounts are initialized with `npx convex run --prod leaderboard:migrate '{}'`, which reads their authentication records and preserves opt-outs.

## Set up

1. Run `npm install`, `npx convex login`, and `npx convex dev`. Create/select the `tic-tac-toe-royale` project. The CLI generates deployment URLs in `.env.local` and bindings in `convex/_generated`.
2. Set `NEXT_PUBLIC_CONVEX_SITE_URL` to the deployment's `.convex.site` URL, alongside the generated `NEXT_PUBLIC_CONVEX_URL` (`.convex.cloud`).
3. Use `npx convex env set` to configure `SITE_URL`, `TRUSTED_ORIGINS` (comma-separated allowed site origins), and `BETTER_AUTH_SECRET` (at least 32 random bytes). Keep localhost allowed only on a development deployment.
4. Run `npm run dev`. Guests authenticate automatically and retain their session in the browser's secure session cookie. Clearing cookies loses guest access; linked accounts can recover across devices.
5. Account saving uses Sign in with Vercel. Configure `VERCEL_CLIENT_ID` and `VERCEL_CLIENT_SECRET` in Convex and register `/api/auth/callback/vercel` on the OAuth app. Linking and sign-out are blocked during active participation. The backend also supports optional Google OAuth credentials.

## Deploy

Use separate Convex development and production deployments. Run `npm run backend:deploy` for production. Configure the production public Convex URLs in Vercel, then deploy the frontend with `npx vercel deploy --prod --scope aquinas`. Never expose Convex deploy keys, Better Auth secrets, or Google client secrets as `NEXT_PUBLIC_*` values. Preview environments should use the development backend and its allowed origin rather than real ranked data.

## Rules and lifecycle

- A rank-tier lobby closes after 30 seconds or 16 human entrants. Remaining seats become CPU entrants with locked difficulty. Royale uses neutral opponent labels; only explicit computer practice identifies the computer. Brackets are shuffled at lock.
- Each match has two feeder IDs. A winner automatically watches the sibling feeder; once both winners exist, their next match starts after ten seconds. Unrelated branches never block progression.
- Each player has 75 seconds total, without increments. Clock expiry forfeits; each match also has a three-minute cap. Tied small boards count as wildcards for both players' macro lines; the player completing simultaneous lines wins. A full macroboard or the match cap compares claimed boards, with first player (X) winning an exact tie.
- Refresh restores server state. Explicit resignation marks an entrant disqualified; resigning while waiting forfeits the next match when it becomes ready. Players eliminated from a bracket can immediately queue again.
- Rank/XP settlement uses a unique `(profile, tournament)` ledger check. Bronze cannot lose points. Positive rewards require a legal move and no disqualification. Human and CPU opponents grant identical placement credit.
- Quests are credited on placement settlement and reset by UTC day. Cosmetic equip operations verify server-owned unlocks. Themes, titles, and victory effects never affect play.

## Backend design

`lib/royale.ts` contains deterministic rules, bracket transitions, sanitized views, and versioned defaults. A tournament is stored as one bounded aggregate (16 entrants, 15 matches), so moves, clock decisions, bracket advancement, and rewards are transactionally consistent. The public subscription excludes bot difficulty, seeds, and unrevealed tiebreak secrets.

Scheduled Node actions compute bot moves with the checked-in skill model. A mutation validates the original aggregate version before committing. Stale/duplicate jobs cannot replay moves. Jobs continue even without a browser open; a minute-based recovery sweep requeues stalled active tournaments. CPU failures are visible in Convex action logs and do not become client-authoritative moves.

This launch is one region with a ten-concurrent-bracket validation target, not an unlimited-scale claim. Larger fields/concurrency should split match documents from the aggregate after measurement. Guest identity prevents forged results but cannot prove that separate guests are separate humans or prevent outside AI assistance.

## Verify and monitor

Run `npm test`, `npm run test:backend`, `npm run test:parity`, `npm run build`, and `npm run test:e2e`. Backend tests use Convex's test runtime; browser Royale tests require a configured deployment. Existing casual tests use `/practice`.

Set `E2E_BASE_URL` to test a deployed site instead of starting localhost. The Royale guest test creates a guest, joins and resigns one match, then leaves its next lobby.

In Convex, inspect scheduler/action failures and function latency. The events table records joins, queue duration, CPU fill, and placements. Observe queue duration, CPU share, completion, immediate requeues, spectator wait, returns, reward errors, and usage before increasing concurrency. Keep deployment previews separate from production profiles.

Defaults are intentionally centralized in `lib/royale.ts`. Snapshot changes into newly created tournaments; do not alter an in-progress bracket's rewards or timing mid-run. No season resets, prizes, purchases, or migration of previous casual game results are included.

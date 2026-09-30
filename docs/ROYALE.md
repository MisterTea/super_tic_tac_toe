# Tic Tac Toe Royale

Royale uses an authoritative backend powered by Neon PostgreSQL and Next.js server endpoints. The frontend subscribes to a saved guest profile, a shared rank-tier lobby, and its tournament via polling and mutation invalidations. The home page offers Royale plus a Single game section. Its computer and host links open `/practice?mode=computer` and `/practice?mode=host` directly; private invites remain at `/practice?code=…`. Random matchmaking is no longer offered.

Live site: https://boxed.games. Guest play is enabled. Player accounts support username/password and optional Google sign-in. See [telemetry and OAuth operations](TELEMETRY.md).

Play starts as a guest without a login requirement. The main page offers optional login; after a guest's first Royale result, a dismissible popover encourages saving progress across devices. The prompt is shown once per guest profile in the browser. Login is available again after active participation ends.

The player profile links to `/account`. Guests see the optional login screen; signed-in players can edit their name and manage their collection. Names use 3–24 letters, numbers, spaces, hyphens, or underscores and are reserved case-insensitively in a shared `name_claims` registry in Postgres. New players and CPU entrants use `unique-names-generator` with two capitalized words; generation retries database collisions inside the transaction. Names are immutable during active participation.

The public `/leaderboard` page and home page show up to ten signed-in accounts ordered by rank points, crowns, and XP. Guests and retired linked profiles never appear. Accounts participate by default and can check “Hide me from the leaderboard” in account settings; this preference persists without affecting rank or rewards.

## Set up

1. Run `npm install`.
2. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your Neon PostgreSQL connection string (with `?sslmode=require`). Use the current, rotated password. `.env` and `.env.local` are ignored by Git; never commit credentials. There is no database credential fallback in source code.
3. Set `BETTER_AUTH_SECRET` (at least 32 random characters) and `SITE_URL` / `TRUSTED_ORIGINS`.
4. Initialize tables with `initDb()` in `lib/db.ts` when setting up a new database. Run `npm run migrate:auth` against an existing database before deploying username accounts.
5. Run `npm run dev`. Guests authenticate automatically and retain their session in the browser's secure session cookie. Clearing cookies loses guest access; linked accounts can recover across devices.
6. Account saving supports username/password registration and login without an OAuth provider. To also offer Google, configure `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` and register `/api/auth/callback/google` on the Google OAuth client. Linking and sign-out are blocked during active participation.

## Deploy

Set `DATABASE_URL` and `BETTER_AUTH_SECRET` in Vercel Project Settings → Environment Variables. Store production and preview credentials as Sensitive secrets, scoped to the environments that need them. Use a separate database for preview/development when possible. Never prefix database credentials or auth secrets with `NEXT_PUBLIC_`.

To enter a production secret from the CLI without putting its value in a command or source file, run:

```sh
vercel env add DATABASE_URL production --sensitive --project tic-tac-toe-royale
```

Use `--force` when replacing an existing value. Repeat for preview with its own connection string. Set a development value for local use, or enter it directly in the ignored `.env.local`. Updating an environment variable requires a new deployment to take effect. Deploy the code and updated secrets together with `git push` or `npx vercel deploy --prod`.

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

## Sharing and friend Royales

Use **Host a friend Royale** on the home/results page. Copy the invitation link; guests enter the same unranked bracket. The host can start immediately, a full room starts automatically, and the room fills after two minutes. If the host leaves, the next entrant becomes host. Empty rooms close. Started room links can't admit new entrants.

**Share my run** explicitly publishes only the player's name, placement, match wins, rank-point change, and own round outcomes. It creates a permanent /share/<token> page and PNG card; it does not expose opponent names, authentication data, email, or player IDs. Nothing is published until the player chooses to share.

The /daily page uses 64 checked, reachable positions cycling by UTC date. Each has exactly one immediately winning legal move. Attempts are validated and persisted server-side, with three distinct guesses per profile per UTC day and no rank/XP/crown rewards. Solutions are revealed after success or the third guess; resetting a guest identity can reset guesses. Full retention and marketing measurement notes are in LAUNCH-KIT.md.

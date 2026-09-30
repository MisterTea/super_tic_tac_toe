# Royale telemetry

Game mutations write telemetry facts and UTC daily/all-time rollups in the same Convex transaction as the operation. Stable profile, match, tournament, reward, and event IDs make retries and historical backfills idempotent. No client can submit counters, award crowns, or read player-level telemetry.

The public `telemetry:publicStats` query returns only `{ players, games, crowns }`. The header on `/` and `/practice` randomly selects one on page load and refreshes its total every minute.

- **Players:** distinct human profiles that entered a Royale match, with linked guest/account profiles deduplicated. CPU entrants and visitors who never enter a match are excluded. A guest is a browser identity; clearing cookies can create another identity.
- **Games:** Royale matches whose thinking clocks started, including CPU-only games. Pre-start withdrawals are excluded. Admin metrics separately show human games and CPU-only games. Casual `/practice` matches are not included.
- **Crowns:** eligible crowns actually awarded to human profiles, derived from the reward ledger. CPU tournament winners have a separate counter.
- **Activity:** distinct active profiles per UTC day, recorded on authenticated visits, joins, moves, and resignations. The all-time activity sum is player-days, not all-time unique players.
- **Funnel/quality:** lobby joins/leaves/cancellations, tournaments started/completed, human and CPU entries, immediate requeues, return visits, queue and spectator wait averages, match duration, clock forfeits, resignations, match caps, legal moves in completed matches, XP awarded, and scheduler recovery attempts.

Read the private admin report in the Convex dashboard's Functions view (`telemetry:report`), or from this linked repository:

```powershell
npx convex run --prod telemetry:report '{"days":30}'
```

It returns lifetime totals and the most recent 30 daily buckets (maximum 90). Missing counters are zero; averages with no samples are null. Gameplay can continue without a browser open, so CPU and completion metrics continue updating on the server.

After deployment, run `npx convex run --prod telemetry:backfill` once. It processes ten source documents per scheduled transaction and safely resumes through profiles, tournaments, rewards, and events. Re-running applies no duplicate counts. Historical active days are limited to known creation/last-visit days; intervening days before telemetry installation cannot be reconstructed. Keep test and production deployments separate.

## OAuth

Sign in with Vercel uses Better Auth's built-in Vercel provider and PKCE, with identity-only `email`/`profile` scopes. The OAuth app is `tic-tac-toe-royale-aquinas`. Its production callbacks follow the linked Vercel project at `/api/auth/callback/vercel`; development permits `http://localhost:3000/api/auth/callback/vercel`.

Set `VERCEL_CLIENT_ID` and `VERCEL_CLIENT_SECRET` on each Convex deployment, never as public frontend variables. Guest progress links into the signed-in account through the existing server-side merge. Sign-in and sign-out are blocked during tournament participation. Optional Google credentials remain supported by the backend.

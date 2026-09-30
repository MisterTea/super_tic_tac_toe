# Royale telemetry

Game mutations write telemetry facts and UTC daily/all-time rollups in the same PostgreSQL transaction as the operation. Stable profile, match, tournament, reward, and event IDs make retries idempotent. No client can submit arbitrary counters, award crowns, or read player-level telemetry.

The public `telemetry:publicStats` query returns only `{ players, games, crowns }`. The header on `/` and `/practice` randomly selects one on page load and refreshes its total every minute.

- **Players:** distinct human profiles that entered a Royale match, with linked guest/account profiles deduplicated. CPU entrants and visitors who never enter a match are excluded. A guest is a browser identity; clearing cookies can create another identity.
- **Games:** Royale matches whose thinking clocks started, including CPU-only games. Pre-start withdrawals are excluded. Admin metrics separately show human games and CPU-only games. Casual `/practice` matches are not included.
- **Crowns:** eligible crowns actually awarded to human profiles, derived from the reward ledger. CPU tournament winners have a separate counter.
- **Activity:** distinct active profiles per UTC day, recorded on authenticated visits, joins, moves, and resignations. The all-time activity sum is player-days, not all-time unique players.
- **Funnel/quality:** lobby joins/leaves/cancellations, tournaments started/completed, human and CPU entries, immediate requeues, return visits, queue and spectator wait averages, match duration, clock forfeits, resignations, match caps, legal moves in completed matches, XP awarded, and scheduler recovery attempts.

Read the private admin report via `telemetry:report`. It returns lifetime totals and the most recent 30 daily buckets (maximum 90). Missing counters are zero; averages with no samples are null. Gameplay can continue without a browser open, so CPU and completion metrics continue updating on the server.

## Player accounts

Players can create an account with a username, email, and password, then log in with either their username or email. Usernames are case-insensitive and use 3–24 letters, numbers, or underscores. Better Auth hashes passwords; they are never stored as plaintext. Google is the optional social sign-in option on the account screen. Vercel OAuth remains supported by the backend for existing integrations but is not offered in the player UI.

Run `npm run migrate:auth` once against each existing database before deploying this change. It adds nullable username/displayUsername fields and a unique username index without modifying existing users or progress. `initDb()` includes the same changes for database initialization. Set `BETTER_AUTH_SECRET` to a private random value of at least 32 characters; production authentication requires it. Changing an existing signing secret invalidates browser sessions, so plan that change before launch.

For Google sign-in:

1. In Google Cloud, configure the OAuth consent screen for an external web application. Enable access for intended players (testing mode is limited to configured test users).
2. Create an OAuth client of type **Web application**. Add `https://boxed.games` as an authorized JavaScript origin and `https://boxed.games/api/auth/callback/google` as an authorized redirect URI. For development, also register `http://localhost:3000/api/auth/callback/google`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in the hosting project's production environment. Keep the secret server-only.
4. Set `BETTER_AUTH_URL` and `SITE_URL` to `https://boxed.games` and include that origin in `TRUSTED_ORIGINS`.
5. Redeploy. Verify Google consent returns to the account screen and guest progress is retained.

Guest progress links into the signed-in account through the server-side merge for both registration and login. Sign-in and sign-out are blocked during tournament participation. Password reset and email verification delivery are not configured yet; adding them requires an email provider.

Growth metrics include firstMatchesCompleted (first settled match per profile), firstMatchesPlayedThrough (excluding clock loss or resignation), with campaign-level counts in the private growth:report function and campaignMetrics table. These counters were introduced with the growth update and don't retroactively reconstruct historical acquisition sources. Campaign labels are browser supplied, sanitized, and bounded; they are not trusted gameplay data.


# Launch kit: Tic Tac Toe Royale

## Positioning

**Tic-tac-toe has a battle royale now. Four rounds. One crown. Can you win?**

Free in your browser. No download or login required.

Use "ultimate tic-tac-toe" when explaining the rules: the square you choose sends your opponent to the corresponding small board. Claim three small boards in a line to win a match, and four matches to claim a crown.

## Six short-video scripts

Record actual gameplay at 1080 × 1920. Keep each clip around 10–20 seconds, use captions, show the board immediately, and keep the URL visible near the end. Don't invent wins or imply that filled lobbies contain sixteen human players.

1. **"Tic-tac-toe has a battle royale now."** Show the bracket, a decisive move, then the crown result. End: "Four rounds. One crown. Can you win?"
2. **"One move from a crown. What would you play?"** Freeze before the final winning move for two seconds; reveal it. End with the challenge link.
3. **"I thought this was normal tic-tac-toe."** Show a move routing the opponent into a different board. Explain that mechanic in one caption, then cut to the tournament.
4. **"My friend sent me this. I need a rematch."** Show a genuine friend-lobby match and its result. End: "Host a Royale. Send the link. Settle it."
5. **"Everyone gets this puzzle today. Can you find the win?"** Show today's daily board without revealing the solution. End with /daily.
6. **"The move that ended my run."** Show a genuine mistake, the opponent's response, and your placement. End: "Beat my run" with your shared result card.

Publish these as experiments over six days, using the same source label per platform and a different campaign per clip. Compare started/completed Royales, not just video views or clicks.

## Community post draft

Title: **I made a free tic-tac-toe battle royale: four rounds, one crown**

I turned ultimate tic-tac-toe into a 16-seat elimination bracket. Every square sends your opponent to another board, and winners watch the match that determines their next opponent. You can play immediately without an account, host a friend Royale, or try the daily one-move puzzle.

Play: https://super-tic-tac-toe-royale.vercel.app/?utm_source=community&utm_campaign=launch

I'd love feedback on whether the rules click quickly and whether the tournament feels fair. There's a feedback button in the game.

Check each community's current rules and adapt the draft before posting. Publish from your own account; don't use fabricated player testimonials or coordinated upvotes.

## Creator outreach draft

Hi [name] — I made Tic Tac Toe Royale, a free browser game built around a 16-seat tournament. I thought it could make a fun viewer challenge: "Can you beat your viewers in tic-tac-toe royale?"

No download or login is required. You can host a friend Royale, share its lobby link with viewers, and start when everyone is ready. The bracket fills any remaining seats automatically. Friend Royales are unranked; regular matchmaking still awards rank points.

Try it: [creator attribution link]

If it looks fun for your audience, I'd be happy to help set up a session. No obligation.

Choose ten small creators whose puzzle, strategy, or browser-game audiences participate. This is a draft; no messages have been sent.

## Friday Crown event template

Pick a date, timezone, and host before announcing. Friend lobbies have a two-minute countdown and a Start Royale now button; don't create the room hours before the event.

Announcement: **Friday Crown: four rounds, one winner. Join us at [time + timezone] on [date]. I'll post the lobby link when we start. Free in your browser, no account needed.**

During the event: create a friend Royale, publish its invitation link, wait for viewers, then start. A room admits at most sixteen people and locks once it starts. Run fresh rooms for additional rounds. Keep results visible and encourage players to share their run.

## Attribution and measurement

Public campaign URL template:
https://super-tic-tac-toe-royale.vercel.app/?utm_source=youtube&utm_campaign=creator_name_clip_1

Use short, lowercase source/campaign slugs with letters, digits, underscores, or hyphens. Each is limited to 48 characters. Never put email addresses or other personal information in these labels.

Invites and shared result links carry their own attribution labels. First-touch attribution is saved once per profile; it is not a count of all pageviews or individual humans across devices. Anonymous identities can be reset by clearing browser data.

In the Convex dashboard, run **telemetry:report** in the Functions view, or use:

```powershell
npx convex run --prod telemetry:report '{"days":30}'
```

For campaign attribution, run the private **growth:report** function (or `npx convex run --prod growth:report`). It lists each source/campaign with visitors (first attributed profiles), entries (Royale joins), firstMatchesStarted, firstMatchesCompleted, and results (settled runs). Optional `{ "day": "2026-09-30" }` selects a UTC day. The result count includes forfeits; use the completion/forfeit counters to interpret it. Each campaign can have multiple entries/results per profile, so don't treat them as unique conversion rates. Reports return at most 1,000 campaigns and indicate truncation; use the campaignMetrics table for more. Campaigns occupy separate records so many invite links do not grow one shared telemetry document.

Also track resultsShared, friendLobbiesCreated, dailyChallengesStarted, dailyChallengesSolved, immediateRequeues, and returningPlayerDays. These are server-derived except attribution labels, which are browser-supplied marketing context, not verified claims.

## Fourteen-day checklist

- Days 1–3: test invites with friends; check new-player understanding; record six clips and screenshots.
- Days 4–7: publish the six hooks; personalize and send ten creator invitations; use relevant communities that allow it.
- Days 8–14: repeat the best source/hook; choose and announce one Friday Crown event; improve the biggest drop-off.

No platform accounts, community posts, creator outreach, paid campaigns, or event announcements are created by this launch kit. The drafts are ready to review and publish.

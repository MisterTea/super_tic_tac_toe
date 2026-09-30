import { test, expect, type Page, type BrowserContext } from "@playwright/test";
import { query } from "../lib/db";
import { legal, play } from "../lib/game";
import { CLOCK_MS, roundNames, type Tournament } from "../lib/royale";

test("sixteen browser sessions play an entire Royale to one crown and fifteen defeats", async ({
  browser,
}, info) => {
  test.skip(
    !process.env.DATABASE_URL || !!process.env.E2E_BASE_URL,
    "Requires the local server's database for read-only verification",
  );
  test.setTimeout(12 * 60_000);
  const contexts: BrowserContext[] = [];
  const sessions = new Map<string, Page>();
  const errors: string[] = [];
  const transientFailures: {
    match: number;
    sequence: number;
    error: string;
  }[] = [];
  const completed: {
    match: number;
    round: number;
    moves: number;
    winner: string;
    reason: string;
  }[] = [];
  async function newSession() {
    const context = await browser.newContext({
      baseURL: info.project.use.baseURL,
    });
    contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  }
  async function dashboard(page: Page) {
    const response = await page.request.post("/api/rpc", {
      data: { name: "royale.dashboard", args: {} },
    });
    expect(response.status()).toBe(200);
    return (await response.json()).result;
  }
  let tournamentId: string;
  async function storedTournament() {
    return (
      await query("SELECT state FROM tournaments WHERE id = $1", [tournamentId])
    ).rows[0].state as Tournament;
  }
  try {
    const host = await newSession();
    await host.goto("/");
    await host
      .getByRole("button", { name: "Host a friend Royale →", exact: true })
      .click();
    const invitation = await host.getByLabel("Challenge link").inputValue();
    const hostData = await dashboard(host);
    tournamentId = hostData.tournament.id;
    sessions.set(hostData.profile._id, host);
    // Small batches create independent guest identities without exhausting login connections.
    for (let batch = 0; batch < 5; batch++) {
      await Promise.all(
        Array.from({ length: 3 }, async () => {
          const guest = await newSession();
          await guest.goto(invitation);
          await guest
            .getByRole("button", { name: "Join friend Royale →", exact: true })
            .click();
          await expect(guest.locator(".entrant.filled")).toHaveCount(
            4 + batch * 3,
            { timeout: 20_000 },
          );
          const data = await dashboard(guest);
          expect(data.tournament.id).toBe(tournamentId);
          expect(sessions.has(data.profile._id)).toBe(false);
          sessions.set(data.profile._id, guest);
        }),
      );
      console.log(
        `Royale: ${sessions.size}/16 independent browser sessions joined`,
      );
    }
    expect(sessions.size).toBe(16);
    await expect(host.locator(".entrant.filled")).toHaveCount(16);
    await host
      .getByRole("button", { name: "Start Royale now →", exact: true })
      .click();
    await expect
      .poll(async () => (await storedTournament()).status, { timeout: 30_000 })
      .toBe("active");
    expect((await storedTournament()).matches).toHaveLength(15);
    expect((await storedTournament()).entrants.every((e) => !e.cpu)).toBe(true);

    async function playMatch(matchId: number) {
      let match = (await storedTournament()).matches[matchId];
      await expect
        .poll(
          async () => {
            match = (await storedTournament()).matches[matchId];
            return match.players.length;
          },
          { timeout: 10 * 60_000, intervals: [1000] },
        )
        .toBe(2);
      const x = sessions.get(match.players[0])!;
      const o = sessions.get(match.players[1])!;
      const pages = [x, o];
      await expect(x.locator(".arena .eyebrow")).toHaveText(
        roundNames[match.round].toUpperCase(),
        { timeout: 30_000 },
      );
      await expect(
        x.getByRole("heading", { name: "Your turn.", exact: true }),
      ).toBeVisible({ timeout: 30_000 });
      match = (await storedTournament()).matches[matchId];
      let authRetries = 0;
      for (let turn = 0; turn < 81 && match.status === "playing"; turn++) {
        const seat = match.state.turn === 1 ? 0 : 1;
        const active = pages[seat];
        const other = pages[1 - seat];
        await expect(
          active.getByRole("heading", { name: "Your turn.", exact: true }),
        ).toBeVisible({ timeout: 10_000 });
        await expect(other.locator(".arena .board button:enabled")).toHaveCount(
          0,
        );
        const choices = legal(match.state);
        const action =
          choices.find(
            (a) => play(match.state, a).winner === match.state.turn,
          ) ?? choices[0];
        const label = `Board ${Math.floor(action / 9) + 1}, square ${(action % 9) + 1}`;
        const button = active.getByRole("button", { name: label, exact: true });
        await expect(button).toBeEnabled();
        const responsePromise = active.waitForResponse(
          (r) =>
            r.url().endsWith("/api/rpc") &&
            r.request().postDataJSON()?.name === "royale.move",
        );
        const sequence = match.state.moves.length;
        await button.click();
        await expect(
          active.getByRole("button", {
            name: `${label}, ${seat === 0 ? "X" : "O"}`,
            exact: true,
          }),
        ).toBeVisible({ timeout: 1000 });
        const response = await responsePromise;
        const body = await response.json();
        if (
          response.status() === 400 &&
          body.error === "Failed to get session" &&
          authRetries < 3
        ) {
          authRetries++;
          transientFailures.push({
            match: matchId,
            sequence,
            error: body.error,
          });
          console.log(
            `Royale: transient authentication failure in match ${matchId}, move ${sequence}; retry ${authRetries}/3`,
          );
          await expect(active.locator(".royale-error")).toContainText(body.error);
          await active
            .getByRole("button", { name: "Dismiss", exact: true })
            .click();
          continue;
        }
        expect(response.status(), `match ${matchId}, move ${sequence}`).toBe(
          200,
        );
        authRetries = 0;
        const result = body.result;
        match = result.match;
        expect(match.state.moves).toHaveLength(sequence + 1);
        expect(match.clocks[match.state.turn === 1 ? 0 : 1]).toBe(CLOCK_MS);
        for (const page of pages)
          await expect(page.locator(".royale-error")).toHaveCount(0);
        if (match.status === "playing") {
          await expect(
            other.getByRole("button", {
              name: `${label}, ${seat === 0 ? "X" : "O"}`,
              exact: true,
            }),
          ).toBeVisible();
        }
      }
      expect(match.status).toBe("finished");
      expect(match.reason).toMatch(/^board (victory|score)$/);
      expect(match.state.moves.length).toBeGreaterThan(0);
      const loser = pages[match.winner === match.players[0] ? 1 : 0];
      await expect(loser.locator(".result-card")).toBeVisible({
        timeout: 15_000,
      });
      await expect(loser.locator(".result-card")).not.toHaveClass(/champion/);
      completed.push({
        match: matchId,
        round: match.round,
        moves: match.state.moves.length,
        winner: match.winner!,
        reason: match.reason!,
      });
      console.log(
        `Royale: match ${matchId}, round ${match.round + 1} settled after ${match.state.moves.length} board clicks`,
      );
    }
    // Each next match starts as soon as its own feeder games settle;
    // unrelated matches must not hold up its players or consume their clocks.
    await Promise.all(
      Array.from({ length: 15 }, (_, matchId) => playMatch(matchId)),
    );
    const final = await storedTournament();
    expect(final.status).toBe("finished");
    expect(final.matches.filter((m) => m.status === "finished")).toHaveLength(
      15,
    );
    expect(final.entrants.filter((e) => e.finish === 4)).toHaveLength(1);
    expect(
      [0, 1, 2, 3, 4].map(
        (finish) => final.entrants.filter((e) => e.finish === finish).length,
      ),
    ).toEqual([8, 4, 2, 1, 1]);
    const results: {
      player: string;
      name: string;
      finish: number;
      wins: number;
      crowns: number;
    }[] = [];
    for (const [id, page] of sessions) {
      const entrant = final.entrants.find((e) => e.id === id)!;
      await page.reload();
      const label = ["Top 16", "Top 8", "Top 4", "Runner-up", "Champion"][
        entrant.finish!
      ];
      await expect(
        page
          .locator(".result-card")
          .getByRole("heading", { name: label, exact: true }),
      ).toBeVisible({ timeout: 20_000 });
      await expect(
        page.getByRole("button", { name: "Play again →", exact: true }),
      ).toBeVisible();
      const data = await dashboard(page);
      expect(data.profile._id).toBe(id);
      expect(data.profile.active).toBeNull();
      expect(data.view.phase).toBe("results");
      const rewards = data.history.filter(
        (r: { tournament: string }) => r.tournament === tournamentId,
      );
      expect(rewards).toHaveLength(1);
      expect(rewards[0].finish).toBe(entrant.finish);
      expect(rewards[0].crown).toBe(entrant.finish === 4);
      expect(data.profile.crowns).toBe(entrant.finish === 4 ? 1 : 0);
      expect(entrant.moved).toBe(true);
      expect(entrant.disqualified).not.toBe(true);
      await page.locator(".result-card").screenshot({
        path: info.outputPath(
          `session-${results.length + 1}-${label.replaceAll(" ", "-")}.png`,
        ),
      });
      results.push({
        player: id,
        name: entrant.name,
        finish: entrant.finish!,
        wins: entrant.wins,
        crowns: data.profile.crowns,
      });
    }
    expect(errors).toEqual([]);
    await info.attach("complete-royale-results", {
      body: JSON.stringify(
        {
          tournamentId,
          champion: final.champion,
          completed,
          results,
          transientFailures,
        },
        null,
        2,
      ),
      contentType: "application/json",
    });
    console.log(
      `Royale complete: 16 verified result screens, ${completed.reduce((n, m) => n + m.moves, 0)} board clicks, one crown, fifteen defeats`,
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

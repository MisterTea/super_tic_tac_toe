import { test, expect } from "@playwright/test";
import { query } from "../lib/db";
import { startTournament, type Tournament } from "../lib/royale";

test("X and O alternate legal Royale moves, reject out-of-turn moves, and restore after refresh", async ({
  page,
  browser,
}, info) => {
  test.skip(
    !process.env.DATABASE_URL || !!process.env.E2E_BASE_URL,
    "Requires the local server and its configured database for bracket seeding",
  );
  test.setTimeout(90_000);
  const friendContext = await browser.newContext();
  const friend = await friendContext.newPage();
  const errors: string[] = [];
  for (const player of [page, friend])
    player.on("pageerror", (e) => errors.push(e.message));
  try {
    await page.goto("/");
    await page
      .getByRole("button", { name: "Host a friend Royale →", exact: true })
      .click();
    const link = await page.getByLabel("Challenge link").inputValue();
    await friend.goto(link);
    await friend.getByRole("button", { name: "Join friend Royale →" }).click();
    await expect(page.locator(".entrant.filled")).toHaveCount(2);
    const code = new URL(link).searchParams.get("room");
    const {
      rows: [row],
    } = await query("SELECT id, state FROM tournaments WHERE room_code = $1", [
      code,
    ]);
    const lobby = row.state as Tournament;
    // Seed only this test's lobby so both browser guests meet in round one.
    let seed = 0;
    for (; seed < 10_000; seed++) {
      const candidate = structuredClone(lobby);
      candidate.seed = seed;
      startTournament(candidate, Date.now());
      if (
        candidate.matches.some(
          (m) =>
            m.players.length === 2 &&
            m.players.every((id) => lobby.entrants.some((e) => e.id === id)),
        )
      )
        break;
    }
    expect(seed).toBeLessThan(10_000);
    await query("UPDATE tournaments SET state = $1 WHERE id = $2", [
      JSON.stringify({ ...lobby, seed }),
      row.id,
    ]);
    await page.getByRole("button", { name: "Start Royale now →" }).click();
    for (const player of [page, friend])
      await expect(
        player.getByRole("button", { name: "Resign match", exact: true }),
      ).toBeVisible({ timeout: 20_000 });
    const dashboard = async (player: typeof page) => {
      const response = await player.request.post("/api/rpc", {
        data: { name: "royale.dashboard", args: {} },
      });
      expect(response.ok()).toBeTruthy();
      return (await response.json()).result;
    };
    const first = await dashboard(page);
    const matchId = first.view.matchId;
    const players = first.tournament.matches[matchId].players;
    const x = players[0] === first.profile._id ? page : friend;
    const o = x === page ? friend : page;
    for (let seq = 0; seq < 6; seq++) {
      const active = seq % 2 === 0 ? x : o;
      const inactive = active === x ? o : x;
      await expect(
        active.getByRole("heading", { name: "Your turn.", exact: true }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        inactive.locator(".arena .board button:enabled"),
      ).toHaveCount(0);
      const button = active.locator(".arena .board button:enabled").first();
      const label = await button.getAttribute("aria-label");
      const action =
        Number(label!.match(/Board (\d+)/)![1]) * 9 -
        9 +
        Number(label!.match(/square (\d+)/)![1]) -
        1;
      if (seq === 0) {
        const rejected = await inactive.request.post("/api/rpc", {
          data: {
            name: "royale.move",
            args: { tournament: row.id, match: matchId, seq, action },
          },
        });
        expect(rejected.status()).toBe(400);
        expect((await rejected.json()).error).toBe("It is not your turn.");
      }
      const responsePromise = active.waitForResponse(
        (r) =>
          r.url().endsWith("/api/rpc") &&
          r.request().postDataJSON()?.name === "royale.move",
      );
      await button.click();
      expect((await responsePromise).status()).toBe(200);
      for (const player of [active, inactive]) {
        await expect(
          player.getByRole("button", {
            name: `${label}, ${seq % 2 === 0 ? "X" : "O"}`,
            exact: true,
          }),
        ).toBeVisible();
        await expect(player.locator(".royale-error")).toHaveCount(0);
      }
      const saved = await dashboard(active);
      expect(saved.tournament.matches[matchId].state.moves).toHaveLength(
        seq + 1,
      );
    }
    await o.reload();
    await expect(o.locator(".arena .board")).toBeVisible();
    expect(
      (await dashboard(o)).tournament.matches[matchId].state.moves,
    ).toHaveLength(6);
    await o.screenshot({
      path: info.outputPath("royale-o-turns.png"),
      fullPage: true,
    });
    await x.getByRole("button", { name: "Resign match", exact: true }).click();
    await expect(
      x.getByRole("button", { name: "Play again →", exact: true }),
    ).toBeVisible();
    await expect(o.locator(".arena .eyebrow")).toContainText(
      /YOU ADVANCED|NEXT MATCH CONFIRMED|QUARTERFINALS/,
      { timeout: 15_000 },
    );
    await o
      .getByRole("button", {
        name: /^(Resign match|Withdraw from tournament)$/,
      })
      .click();
    await expect
      .poll(async () => {
        const saved = await dashboard(o);
        return saved.tournament.entrants.find(
          (e: { id: string }) => e.id === saved.profile._id,
        ).disqualified;
      })
      .toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await friendContext.close();
  }
});

test("Royale has a useful setup state without backend configuration", async ({
  page,
}) => {
  test.skip(
    !!process.env.DATABASE_URL,
    "This scenario applies only before backend setup",
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "One bracket. One champion." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Play the computer", exact: true }),
  ).toHaveAttribute("href", "/practice?mode=computer");
});

test("guest lobby warms up, fills with CPUs, starts, and restores after refresh", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.DATABASE_URL, "Requires a configured Neon database");
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  const providers = await page.request.post("/api/rpc", {
    data: { name: "auth.providers", args: {} },
  });
  const hasLogin = !!(await providers.json()).result.vercel;
  await expect(
    page.getByRole("dialog", { name: "Keep your progress with you." }),
  ).not.toBeVisible();
  await page
    .getByRole("button", { name: "Play Royale →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your bracket is forming." }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Puzzle square 3", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Correct!");
  await page
    .getByRole("button", { name: "Practice board", exact: true })
    .click();
  await expect(
    page.getByRole("group", { name: "Warm-up board" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Board 5, square 5", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Board 5, square 5, X", exact: true }),
  ).toHaveText("✕");
  await expect(
    page.getByRole("button", { name: "Resign match", exact: true }),
  ).toBeVisible({ timeout: 45_000 });
  await expect(page.locator(".cpu-badge")).toHaveCount(0);
  await page.getByText("How Royale works", { exact: true }).click();
  await expect(page.locator("body")).not.toContainText(
    /\b(CPU|AI|computer)\b/i,
  );
  await expect(page.locator(".brand")).not.toHaveAttribute(
    "title",
    /CPU|AI|computer/i,
  );
  await expect(
    page.locator(".arena .board button:enabled").first(),
  ).toBeVisible({ timeout: 15_000 });
  const moveButton = page.locator(".arena .board button:enabled").first();
  const moveLabel = await moveButton.getAttribute("aria-label");
  const playedMove = page.getByRole("button", {
    name: new RegExp(`^${moveLabel}, [XO]$`),
  });
  await moveButton.click();
  await expect(playedMove).toBeVisible();
  const identity = await page.locator(".profile-chip").innerText();
  await page.reload();
  await expect(page.locator(".profile-chip")).toHaveText(identity);
  await expect(page.locator(".arena .board")).toBeVisible();
  await expect(playedMove).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("royale-match.jpg"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Resign match", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play again →", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".reward-row")).toContainText("+0");
  const prompt = page.getByRole("dialog", {
    name: "Keep your progress with you.",
  });
  if (hasLogin) {
    await expect(prompt).toBeVisible();
    await expect(
      prompt.getByRole("button", { name: "Log in with Vercel", exact: true }),
    ).toBeEnabled();
    await page.locator(".player-strip").scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("optional-login-prompt.jpg"),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(prompt).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath("optional-login-prompt-mobile.jpg"),
    });
    await prompt
      .getByRole("button", { name: "Keep playing as guest", exact: true })
      .click();
  }
  await expect(prompt).not.toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Play again →", exact: true }),
  ).toBeVisible();
  await expect(prompt).not.toBeVisible();
  await page.getByRole("button", { name: "Play again →", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Your bracket is forming." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Leave lobby", exact: true }).click();
  expect(errors).toEqual([]);
});

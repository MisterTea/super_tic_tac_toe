import { test, expect } from "@playwright/test";
import { ConvexHttpClient, api } from "../lib/neon-client";

test("public leaderboard matches the top ten without exposing private profile fields", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.DATABASE_URL, "Requires configured Neon database");
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000");
  await page.goto("/leaderboard");
  await expect(
    page.getByRole("heading", { name: "Top 10 players", exact: true }),
  ).toBeVisible();
  const players = await client.query(api.leaderboard.top, {});
  expect(players.length).toBeLessThanOrEqual(10);
  if (players.length) {
    await expect(page.locator(".leaderboard tbody tr")).toHaveCount(
      players.length,
    );
    for (const player of players) {
      await expect(
        page.getByRole("rowheader").filter({ hasText: player.name }),
      ).toBeVisible();
      expect(Object.keys(player).sort()).toEqual([
        "crowns",
        "level",
        "name",
        "points",
        "rank",
        "tier",
      ]);
    }
  } else
    await expect(
      page.getByText("No players yet. Log in to join the leaderboard.", {
        exact: true,
      }),
    ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("leaderboard.jpg") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
});

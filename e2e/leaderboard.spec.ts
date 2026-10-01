import { test, expect } from "@playwright/test";

test("public leaderboard matches the top ten without exposing private profile fields", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.DATABASE_URL, "Requires configured Neon database");
  const rpc = async (name: string) => {
    const response = await page.request.post("/api/rpc", {
      data: { name, args: {} },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).result;
  };
  await page.goto("/leaderboard");
  await expect(
    page.getByRole("heading", { name: "Top 10 players", exact: true }),
  ).toBeVisible();
  const players = await rpc("leaderboard.top");
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

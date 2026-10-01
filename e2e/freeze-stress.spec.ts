import { test, expect } from "@playwright/test";
import { query } from "../lib/db";
import type { Tournament } from "../lib/royale";
const localDb = "postgresql://stress_user@127.0.0.1:55432/freeze_stress";
test("six consecutive games recover from a hung dashboard without losing the player", async ({
  page,
}, info) => {
  test.skip(
    process.env.DATABASE_URL !== localDb ||
      info.project.use.baseURL !== "http://127.0.0.1:3100",
    "Isolated stress server required",
  );
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  let player: string | null = null;
  for (let round = 0; round < 6; round++) {
    await page
      .getByRole("button", { name: "Host a friend Royale →", exact: true })
      .click();
    const invite = await page.getByLabel("Challenge link").inputValue();
    const code = new URL(invite).searchParams.get("room");
    const row = (
      await query("SELECT * FROM tournaments WHERE room_code=$1", [code])
    ).rows[0];
    const state = row.state as Tournament;
    if (player) expect(state.entrants[0].id).toBe(player);
    else player = state.entrants[0].id;
    state.settings = { ...state.settings!, countdownMs: 0, botDelayMs: 100 };
    await query("UPDATE tournaments SET state=$1 WHERE id=$2", [
      JSON.stringify(state),
      row.id,
    ]);
    await page.getByRole("button", { name: "Start Royale now →" }).click();
    await expect(
      page.locator(".arena .board button:enabled").first(),
    ).toBeVisible({ timeout: 15000 });
    await page.locator(".arena .board button:enabled").first().click();
    await expect(
      page.getByRole("button", { name: "Resign match", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Resign match", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Play again →", exact: true }),
    ).toBeVisible();
    console.log(`UI repeat: ${round + 1}/6 completed`);
    if (round === 2) {
      let held = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/rpc", async (route) => {
        if (route.request().postDataJSON()?.name === "royale.dashboard") {
          held++;
          await gate;
          await route.continue().catch(() => {});
        } else await route.continue();
      });
      await expect(
        page.getByText(
          "Connection interrupted. Reconnecting to your saved game…",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 16000 });
      expect(held).toBeGreaterThan(0);
      release();
      await expect(
        page.getByText(
          "Connection interrupted. Reconnecting to your saved game…",
          { exact: true },
        ),
      ).not.toBeVisible({ timeout: 10000 });
      await page.unrouteAll({ behavior: "wait" });
    }
  }
  await page.screenshot({
    path: info.outputPath("six-games-recovered.jpg"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

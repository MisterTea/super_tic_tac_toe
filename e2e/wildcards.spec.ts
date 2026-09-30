import { test, expect } from "@playwright/test";
import { localRelay } from "./relay";
import fixture from "./fixtures/wildcard-game.json";

test("a wildcard completing both lines awards its maker the win on both peers", async ({
  browser,
}) => {
  const relay = await localRelay();
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    await host.goto("/practice");
    await host.getByText("Relay settings", { exact: true }).click();
    await host.getByLabel("Relay URLs").fill(relay.url);
    await host.getByRole("button", { name: "Host game", exact: true }).click();
    await expect(host.getByRole("status")).toContainText("Private lobby ready");
    await guest.goto(await host.getByLabel("Invite link").inputValue());
    await expect(host.getByRole("status")).toContainText("Connected", {
      timeout: 20000,
    });
    for (const [i, action] of fixture.moves.entries()) {
      const page = i % 2 === 0 ? host : guest;
      const board = Math.floor(action / 9) + 1;
      const square = (action % 9) + 1;
      await page
        .getByRole("button", {
          name: `Board ${board}, square ${square}`,
          exact: true,
        })
        .click();
      const other = i % 2 === 0 ? guest : host;
      await expect(
        other.getByRole("button", {
          name: `Board ${board}, square ${square}, ${i % 2 === 0 ? "X" : "O"}`,
          exact: true,
        }),
      ).toHaveText(i % 2 === 0 ? "✕" : "◯");
    }
    await expect(host.locator(".score")).toContainText("You win");
    await expect(guest.locator(".score")).toContainText("You lose");
    for (const page of [host, guest]) {
      await expect(
        page.getByLabel("Wildcard: counts for X and O").first(),
      ).toHaveText("★");
      await expect(
        page.getByRole("img", { name: /X wins across boards/ }),
      ).toBeVisible();
      await expect(page.locator(".board button:enabled")).toHaveCount(0);
    }
  } finally {
    await hostContext.close();
    await guestContext.close();
    await relay.close();
  }
});

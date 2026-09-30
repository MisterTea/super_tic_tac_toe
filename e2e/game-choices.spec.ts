import { test, expect } from "@playwright/test";
import { localRelay } from "./relay";

test("home offers Royale and two single-game choices on desktop and mobile", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const single = page.getByRole("region", { name: "Single game", exact: true });
  await expect(single).toBeVisible();
  await expect(
    single.getByRole("link", { name: "Play the computer", exact: true }),
  ).toHaveAttribute("href", "/practice?mode=computer");
  await expect(
    single.getByRole("link", { name: "Host game", exact: true }),
  ).toHaveAttribute("href", "/practice?mode=host");
  await expect(
    page.getByRole("button", { name: "Play Royale →", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Play random opponent", { exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath("home-choices.jpg"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(single).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("home-choices-mobile.jpg"),
    fullPage: true,
  });
  await single
    .getByRole("link", { name: "Play the computer", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Computer ready", {
    timeout: 30000,
  });
  await expect(page.getByRole("slider", { name: "Difficulty" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play random opponent", exact: true }),
  ).toHaveCount(0);
});

test("host entry creates an invite directly, and an invited guest can play", async ({
  browser,
}) => {
  test.skip(
    !!process.env.E2E_BASE_URL && !process.env.PUBLIC_RELAYS,
    "Remote HTTPS pages need public relays rather than the local WebSocket fixture",
  );
  const relay = await localRelay();
  const relayUrl = process.env.PUBLIC_RELAYS || relay.url;
  const hostContext = await browser.newContext();
  const guestContext = await browser.newContext();
  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    await host.goto(
      `/practice?mode=host&relays=${encodeURIComponent(relayUrl)}`,
    );
    await expect(host.getByRole("status")).toContainText(
      "Private lobby ready",
      { timeout: 20000 },
    );
    const invite = await host.getByLabel("Invite link").inputValue();
    await guest.goto(invite);
    await expect(host.getByRole("status")).toContainText("Connected", {
      timeout: 20000,
    });
    await host
      .getByRole("button", { name: "Board 5, square 5", exact: true })
      .click();
    await expect(
      guest.getByRole("button", { name: "Board 5, square 5, X", exact: true }),
    ).toHaveText("✕");
  } finally {
    await hostContext.close();
    await guestContext.close();
    await relay.close();
  }
});

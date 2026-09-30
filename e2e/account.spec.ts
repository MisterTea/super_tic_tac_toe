import { test, expect } from "@playwright/test";

test("new guest gets a two-word name and profile opens an optional account login screen", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  const profile = page.locator(".profile-chip");
  await expect(profile).toHaveAttribute(
    "aria-label",
    /^Account for [A-Z][a-z]+ [A-Z][a-z]+$/,
  );
  await expect(profile).toHaveAttribute("href", "/account");
  await profile.click();
  await expect(
    page.getByRole("heading", { name: "Log in to your account", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Log in with Vercel", exact: true }),
  ).toBeEnabled();
  await expect(page.getByLabel("Player name", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("account-login.jpg") });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page
    .getByRole("link", { name: "keep playing as a guest", exact: true })
    .click();
  await expect(profile).toHaveAttribute(
    "aria-label",
    /^Account for [A-Z][a-z]+ [A-Z][a-z]+$/,
  );
  await page
    .getByRole("button", { name: "Play Royale →", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Your bracket is forming.",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Leave lobby", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Play Royale →", exact: true }),
  ).toBeVisible();
});

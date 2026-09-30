import { test, expect } from "@playwright/test";

test("Royale has a useful setup state without backend configuration", async ({
  page,
}) => {
  test.skip(
    !!process.env.NEXT_PUBLIC_CONVEX_URL,
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
  test.skip(
    !process.env.NEXT_PUBLIC_CONVEX_URL,
    "Requires a configured development Convex deployment",
  );
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Log in", exact: true }),
  ).toBeEnabled();
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

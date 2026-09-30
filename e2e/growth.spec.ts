import { test, expect } from "@playwright/test";
import { dailyPosition, utcDay } from "../lib/daily";
import { legal, play } from "../lib/game";

test("daily challenge is guest-accessible, persists attempts, and has a mobile result share", async ({
  page,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/daily?utm_source=verification&utm_campaign=daily");
  await expect(
    page.getByRole("heading", { name: "One move. Find the win." }),
  ).toBeVisible();
  const state = dailyPosition(utcDay(Date.now()));
  const solution = legal(state).find(
    (a) => play(state, a).winner === state.turn,
  )!;
  const wrong = legal(state).find((a) => a !== solution)!;
  await page
    .getByRole("button", {
      name: `Board ${Math.floor(wrong / 9) + 1}, square ${(wrong % 9) + 1}`,
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText("1/3 chances used");
  await page.reload();
  await expect(page.getByRole("status")).toContainText("1/3 chances used");
  await page
    .getByRole("button", {
      name: `Board ${Math.floor(solution / 9) + 1}, square ${(solution % 9) + 1}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: "You found it!" }),
  ).toBeVisible();
  await expect(page.getByLabel("Challenge link")).toHaveValue(
    /\/daily\?utm_source=daily/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: info.outputPath("daily-mobile.jpg"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("two guest browsers join one friend Royale and share a verified result card", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const friendContext = await browser.newContext(),
    friend = await friendContext.newPage();
  try {
    await page.goto("/?utm_source=verification&utm_campaign=friends");
    await page
      .getByRole("button", { name: "Host a friend Royale →", exact: true })
      .click();
    const link = await page.getByLabel("Challenge link").inputValue();
    await friend.goto(link);
    await expect(
      friend.getByRole("heading", { name: "A Royale with friends." }),
    ).toBeVisible();
    await friend.getByRole("button", { name: "Join friend Royale →" }).click();
    await expect(page.locator(".entrant.filled")).toHaveCount(2);
    await expect(friend.locator(".entrant.filled")).toHaveCount(2);
    await expect(
      friend.getByRole("button", { name: "Start Royale now →" }),
    ).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: info.outputPath("friend-lobby-mobile.jpg"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Start Royale now →" }).click();
    await expect(
      page.getByRole("button", { name: "Resign match", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      page.locator(".arena .board button:enabled").first(),
    ).toBeVisible({ timeout: 30_000 });
    await page
      .getByRole("button", { name: "Resign match", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Share my run →" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Share my run →" }).click();
    const sharedLink = await page.getByLabel("Challenge link").inputValue();
    const visitor = await browser.newContext(),
      shared = await visitor.newPage();
    try {
      await shared.goto(sharedLink);
      await expect(
        shared.getByRole("heading", { name: "Can you beat this run?" }),
      ).toBeVisible();
      await expect(shared.locator(".shared-bracket div")).toHaveCount(4);
      const png = await shared.request.get(sharedLink + "/image");
      expect(png.status()).toBe(200);
      expect(png.headers()["content-type"]).toContain("image/png");
      expect([...(await png.body()).subarray(0, 8)]).toEqual([
        137, 80, 78, 71, 13, 10, 26, 10,
      ]);
      await shared.screenshot({
        path: info.outputPath("shared-result.jpg"),
        fullPage: true,
      });
      await expect(shared.locator('meta[property="og:image"]')).toHaveAttribute(
        "content",
        /\/share\/.+\/image/,
      );
      await shared
        .getByRole("link", { name: "Play Royale →", exact: true })
        .click();
      await expect(
        shared.getByRole("button", { name: "Play Royale →", exact: true }),
      ).toBeVisible();
    } finally {
      await visitor.close();
    }
    await expect(
      friend.getByRole("button", { name: "Resign match", exact: true }),
    ).toBeVisible();
    await friend
      .getByRole("button", { name: "Resign match", exact: true })
      .click();
    await expect(
      friend.getByRole("button", { name: "Play again →" }),
    ).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await friendContext.close();
  }
});

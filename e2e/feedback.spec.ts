import { test, expect } from "@playwright/test";

test("guests can send private feedback and close the form on mobile", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Hold guest setup so opening the form exercises the loading-to-arena transition.
  await page.route("**/api/rpc", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.name === "royale.ensureProfile"
    )
      await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Leave feedback", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.getByLabel("Type", { exact: true }).selectOption("Idea");
  await page
    .getByLabel("Your feedback")
    .fill(
      "Automated verification feedback: checking the public feedback form saves successfully.",
    );
  await expect(page.getByRole("link", { name: /^Account for / })).toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Your feedback")).toHaveValue(
    /Automated verification feedback/,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath("feedback-form.jpg") });
  await page
    .getByRole("button", { name: "Send feedback", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText(
    "Your feedback has been saved",
  );
  await page.getByRole("button", { name: "Back to the game" }).click();
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Leave feedback", exact: true })
    .click();
  await expect(page.getByLabel("Your feedback")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page.goto("/practice?mode=computer");
  await expect(
    page.getByRole("button", { name: "Leave feedback", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

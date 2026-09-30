import { test, expect } from "@playwright/test";

test("guests can send private feedback and close the form on mobile", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
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

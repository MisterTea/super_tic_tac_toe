import { test, expect } from "@playwright/test";
test("computer lazily loads local PyTorch model, uses ten skill levels, and reuses the session", async ({
  page,
}) => {
  const files: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/ai/")) files.push(r.url());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(page.locator(".board")).toHaveCount(0);
  const slider = page.getByRole("slider", { name: /Difficulty/ });
  await expect(slider).toHaveValue("5");
  expect(files).toEqual([]);
  await expect(slider).toHaveAttribute("min", "1");
  await expect(slider).toHaveAttribute("max", "10");
  await expect(slider).toHaveAttribute("step", "1");
  await slider.press("Home");
  for (let i = 1; i <= 10; i++) {
    await expect(slider).toHaveValue(String(i));
    if (i < 10) await slider.press("ArrowRight");
  }
  await page
    .getByRole("button", { name: "Play the computer", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Computer ready", {
    timeout: 30000,
  });
  await expect(page.locator(".board")).toBeVisible();
  expect(files.filter((url) => url.endsWith("policy.onnx"))).toHaveLength(1);
  expect(files.some((url) => url.endsWith(".wasm"))).toBe(true);
  const appOrigin = new URL(page.url()).origin;
  expect(files.every((url) => new URL(url).origin === appOrigin)).toBe(true);
  // After load, inference must work even when future model/runtime downloads are blocked.
  await page.route("**/ai/**", (route) => route.abort());
  await page
    .getByRole("button", { name: "Board 5, square 5", exact: true })
    .click();
  await expect(
    page.locator(".board button").filter({ hasText: "◯" }),
  ).toHaveCount(1, { timeout: 20000 });
  await expect(page.locator(".last-move")).toHaveCount(1);
  await expect(page.locator(".last-move")).toHaveText("◯");
  await expect(page.locator(".last-move")).toHaveCSS("font-weight", "700");
  await expect(
    page.getByRole("button", { name: "Board 5, square 5, X", exact: true }),
  ).not.toHaveClass(/last-move/);
  await expect(slider).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Host game", exact: true }),
  ).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    await page.locator(".board button:enabled").first().click();
    await expect(
      page.locator(".board button").filter({ hasText: "◯" }),
    ).toHaveCount(i + 2, { timeout: 20000 });
  }
  await page.getByRole("button", { name: "New Game", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Computer ready");
  await expect(page.locator(".last-move")).toHaveCount(0);
  expect(files.filter((url) => url.endsWith("policy.onnx"))).toHaveLength(1);

  await page
    .getByRole("button", { name: "Board 1, square 5", exact: true })
    .click();
  await expect(
    page.locator(".board button").filter({ hasText: "◯" }),
  ).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("failed model load is visible and retry succeeds without a fallback bot", async ({
  page,
}) => {
  await page.route("**/ai/policy.onnx", (route) => route.abort());
  await page.goto("/");
  await page
    .getByRole("button", { name: "Play the computer", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Could not load computer",
    { timeout: 30000 },
  );
  await expect(page.locator(".board")).toHaveCount(0);
  await expect(
    page.locator(".board button").filter({ hasText: "◯" }),
  ).toHaveCount(0);
  await page.unroute("**/ai/policy.onnx");
  await page.getByRole("button", { name: "New Game", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Computer ready", {
    timeout: 30000,
  });
});
test("computer board stays hidden until the model has loaded", async ({
  page,
}) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/ai/policy.onnx", async (route) => {
    await pending;
    await route.continue();
  });
  await page.goto("/");
  await expect(page.locator(".arena")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Play the computer", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Loading computer");
  await expect(page.locator(".board")).toHaveCount(0);
  release();
  await expect(page.getByRole("status")).toContainText("Computer ready", {
    timeout: 30000,
  });
  await expect(page.locator(".board")).toBeVisible();
});

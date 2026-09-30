import { test, expect } from "@playwright/test";

test("new guest gets a two-word name and profile opens an optional account login screen", async ({
  page,
}, testInfo) => {
  await page.route("**/api/rpc", async (route) => {
    if (route.request().postDataJSON()?.name === "auth.providers") {
      await route.fulfill({
        json: { result: { vercel: false, google: true } },
      });
    } else {
      await route.continue();
    }
  });
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
    page.getByRole("button", { name: "Continue with Google", exact: true }),
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

for (const provider of [null, "google"] as const) {
  test(`login opens account and handles ${provider || "unconfigured"} sign-in`, async ({
    page,
  }) => {
    await page.route("**/api/rpc", async (route) => {
      if (route.request().postDataJSON()?.name === "auth.providers") {
        await route.fulfill({
          json: {
            result: {
              vercel: false,
              google: provider === "google",
            },
          },
        });
      } else {
        await route.continue();
      }
    });
    await page.goto("/");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/account$/);
    if (!provider) {
      await expect(
        page.getByLabel("Username or email", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Continue with Google" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", {
          name: "keep playing as a guest",
          exact: true,
        }),
      ).toBeVisible();
      return;
    }
    const socialRequest = page.waitForRequest("**/api/auth/sign-in/social");
    await page.route("**/api/auth/sign-in/social", (route) =>
      route.fulfill({
        status: 400,
        json: {
          code: "TEST_ERROR",
          message: "Sign-in could not start. Please try again.",
        },
      }),
    );
    const login = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    await login.click();
    const request = await socialRequest;
    expect(request.postDataJSON()).toMatchObject({
      provider,
      callbackURL: new URL("/account", page.url()).href,
    });
    await expect(page.locator(".royale-error[role=alert]")).toContainText(
      "Sign-in could not start. Please try again.",
    );
    await expect(login).toBeEnabled();
  });
}

test("password accounts preserve guest profile and accept username or email login", async ({
  page,
}, testInfo) => {
  test.setTimeout(90_000);
  const suffix = crypto.randomUUID().replaceAll("-", "").slice(0, 16);
  const username = `player_${suffix}`;
  const email = `${username}@example.invalid`;
  const password = `Test-password-${suffix}`;
  await page.goto("/");
  await expect(page.locator(".profile-chip")).toBeVisible();
  const before = await page.request.post("/api/rpc", {
    data: { name: "royale.dashboard", args: {} },
  });
  const original = (await before.json()).result.profile;
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page
    .getByRole("button", { name: "New here? Create an account", exact: true })
    .click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.screenshot({
    path: testInfo.outputPath("create-account-mobile.jpg"),
  });
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your account", exact: true }),
  ).toBeVisible();
  const after = await page.request.post("/api/rpc", {
    data: { name: "royale.dashboard", args: {} },
  });
  expect((await after.json()).result.profile).toMatchObject({
    _id: original._id,
    xp: original.xp,
    crowns: original.crowns,
    points: original.points,
  });
  for (const identifier of [username.toUpperCase(), email]) {
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await page
      .getByLabel("Username or email", { exact: true })
      .fill(identifier);
    await page
      .getByLabel("Password", { exact: true })
      .fill("incorrect-password");
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page.locator(".royale-error[role=alert]")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Log in to your account",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Your account", exact: true }),
    ).toBeVisible();
  }
});

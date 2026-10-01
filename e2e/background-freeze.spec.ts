import {
  test as base,
  expect,
  chromium,
  type Page,
  type CDPSession,
} from "@playwright/test";
import { query } from "../lib/db";
import type { Tournament } from "../lib/royale";

// Use full Chromium's real window lifecycle, with normal background throttling.
const controls = new WeakMap<Page, { cdp: CDPSession; windowId: number }>();
const test = base.extend({
  page: async ({}, use) => {
    const server = await chromium.launchServer({
      headless: false,
      args: [
        "--remote-debugging-port=19531",
        "--remote-debugging-address=127.0.0.1",
      ],
      ignoreDefaultArgs: [
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
      ],
    });
    try {
      // CDP's noDefaults keeps Playwright from overriding window visibility.
      const browser = await chromium.connectOverCDP("http://127.0.0.1:19531", {
        noDefaults: true,
      });
      const page = await browser.contexts()[0].newPage();
      const initial = await page.context().newCDPSession(page);
      const { windowId } = await initial.send("Browser.getWindowForTarget");
      controls.set(page, { cdp: initial, windowId });
      await restore(page, initial, windowId);
      try {
        await use(page);
      } finally {
        await initial.detach();
        await browser.close();
      }
    } finally {
      await server.close();
    }
  },
});
test.beforeEach(({}, info) => {
  test.skip(
    process.env.DATABASE_URL !==
      "postgresql://stress_user@127.0.0.1:55432/freeze_stress" ||
      info.project.use.baseURL !== "http://127.0.0.1:3100",
    "Isolated background stress server required",
  );
});

async function minimize(page: Page) {
  const { cdp, windowId } = controls.get(page)!;
  // Disable focus emulation while minimized so the hidden state is real.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "minimized" },
  });
  await expect
    .poll(() => page.evaluate(() => document.visibilityState))
    .toBe("hidden");
  return { cdp, windowId };
}
async function restore(page: Page, cdp: CDPSession, windowId: number) {
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  await cdp.send("Browser.setWindowBounds", {
    windowId,
    bounds: { windowState: "normal" },
  });
  await page.bringToFront();
  // Windows may refuse focus when another desktop app is active. Emulate only
  // the foreground phase; never keep this enabled during background checks.
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await expect
    .poll(() => page.evaluate(() => document.visibilityState))
    .toBe("visible");
}

test("minimized Chromium window reports actual background visibility", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3100/practice");
  await page.evaluate(() => {
    const probe = { freezes: 0, resumes: 0 };
    (window as any).__freezeProbe = probe;
    document.addEventListener("freeze", () => probe.freezes++);
    document.addEventListener("resume", () => probe.resumes++);
  });
  const { cdp, windowId } = await minimize(page);
  try {
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  } finally {
    await restore(page, cdp, windowId);
  }
  expect(await page.evaluate(() => (window as any).__freezeProbe)).toEqual({
    freezes: 1,
    resumes: 1,
  });
});

test("WASM initialization survives a frozen background window", async ({
  page,
}, info) => {
  const files: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/ai/")) files.push(request.url());
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/ai/policy.onnx", async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });
  await page.goto("http://127.0.0.1:3100/practice");
  await page
    .getByRole("button", { name: "Play the computer", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Loading computer");
  const { cdp, windowId } = await minimize(page);
  try {
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    release();
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await restore(page, cdp, windowId);
    await expect(page.getByRole("status")).toContainText("Computer ready", {
      timeout: 30000,
    });
    expect(files.some((url) => url.endsWith(".wasm"))).toBe(true);
    await page.locator(".board button:enabled").first().click();
    await expect(
      page.locator(".board button").filter({ hasText: "◯" }),
    ).toHaveCount(1, { timeout: 20000 });
    await expect(page.locator(".board button:enabled").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("wasm-load-resumed.png") });
    console.log(
      "Background WASM initialization: hidden, frozen, resumed, legal CPU response",
    );
  } finally {
    release();
    await restore(page, cdp, windowId);
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("repeated strongest-WASM turns survive background freeze and reset", async ({
  page,
}, info) => {
  const errors: string[] = [];
  const files: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url().endsWith("policy.onnx")) files.push(request.url());
  });
  await page.goto("http://127.0.0.1:3100/practice");
  await page.getByRole("slider", { name: /Difficulty/ }).press("End");
  await page
    .getByRole("button", { name: "Play the computer", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Computer ready", {
    timeout: 30000,
  });
  for (let game = 0; game < 3; game++) {
    for (let turn = 0; turn < 2; turn++) {
      await page.locator(".board button:enabled").first().click();
      const { cdp, windowId } = await minimize(page);
      try {
        await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
        await new Promise((resolve) => setTimeout(resolve, 2000));
        await restore(page, cdp, windowId);
        await expect(
          page.locator(".board button").filter({ hasText: "◯" }),
        ).toHaveCount(turn + 1, { timeout: 20000 });
        await expect(
          page.locator(".board button:enabled").first(),
        ).toBeVisible();
      } finally {
        await restore(page, cdp, windowId);
      }
    }
    await page.getByRole("button", { name: "New Game", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Computer ready");
    await expect(
      page.locator(".board button").filter({ hasText: "◯" }),
    ).toHaveCount(0);
    console.log(
      `Background WASM turns: game ${game + 1}/3, two freezes, controls recovered`,
    );
  }
  expect(files).toHaveLength(1);
  expect(errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("wasm-turns-resumed.png") });
});

test("a frozen background action releases expired pending controls on return", async ({
  page,
}) => {
  await page.goto("http://127.0.0.1:3100/");
  const host = page.getByRole("button", {
    name: "Host a friend Royale →",
    exact: true,
  });
  await expect(host).toBeEnabled();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/rpc", async (route) => {
    if (route.request().postDataJSON()?.name === "growth.host") {
      await gate;
      await route.abort().catch(() => {});
    } else await route.continue();
  });
  await host.click();
  await expect(host).toBeDisabled();
  const { cdp, windowId } = await minimize(page);
  try {
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await new Promise((resolve) => setTimeout(resolve, 16000));
    const resumed = Date.now();
    await restore(page, cdp, windowId);
    await expect(host).toBeEnabled({ timeout: 3000 });
    await expect(page.locator('.royale-error[role="alert"]')).toContainText(
      "taking too long",
    );
    console.log(
      `Background action: expired request released controls ${Date.now() - resumed}ms after return`,
    );
  } finally {
    release();
    await restore(page, cdp, windowId);
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("Royale continues on the server while its window is frozen and resyncs on return", async ({
  page,
}, info) => {
  await page.goto("http://127.0.0.1:3100/");
  await page
    .getByRole("button", { name: "Host a friend Royale →", exact: true })
    .click();
  const code = new URL(
    await page.getByLabel("Challenge link").inputValue(),
  ).searchParams.get("room");
  const row = (
    await query("SELECT * FROM tournaments WHERE room_code=$1", [code])
  ).rows[0];
  const state = row.state as Tournament;
  state.settings = { ...state.settings!, countdownMs: 0, botDelayMs: 100 };
  await query("UPDATE tournaments SET state=$1 WHERE id=$2", [
    JSON.stringify(state),
    row.id,
  ]);
  await page
    .getByRole("button", { name: "Start Royale now →", exact: true })
    .click();
  await expect(
    page.locator(".arena .board button:enabled").first(),
  ).toBeVisible({ timeout: 15000 });
  const ready = (
    await query("SELECT state FROM tournaments WHERE id=$1", [row.id])
  ).rows[0].state as Tournament;
  const match = ready.matches.find(
    (m) => m.players.includes(state.entrants[0].id) && m.status === "playing",
  )!;
  const { cdp, windowId } = await minimize(page);
  try {
    await cdp.send("Page.setWebLifecycleState", { state: "frozen" });
    await new Promise((resolve) => setTimeout(resolve, 18000));
    const saved = (
      await query("SELECT state FROM tournaments WHERE id=$1", [row.id])
    ).rows[0].state as Tournament;
    expect(saved.matches[match.id].status).toBe("finished");
    expect(saved.matches[match.id].reason).toBe("clock");
    const resumed = Date.now();
    await restore(page, cdp, windowId);
    await expect(
      page.getByRole("button", { name: "Play again →", exact: true }),
    ).toBeEnabled({ timeout: 10000 });
    const profile = (
      await query("SELECT active FROM profiles WHERE id=$1", [
        state.entrants[0].id,
      ])
    ).rows[0];
    expect(profile.active).toBeNull();
    console.log(
      `Background Royale: server clock settled while frozen; results synchronized ${Date.now() - resumed}ms after return`,
    );
    await page.screenshot({ path: info.outputPath("royale-resynced.png") });
    await page
      .getByRole("button", { name: "Host a friend Royale →", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Start Royale now →", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Leave lobby", exact: true })
      .click();
  } finally {
    await restore(page, cdp, windowId);
  }
});

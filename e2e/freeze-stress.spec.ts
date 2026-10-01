import { test, expect } from "@playwright/test";
import { query } from "../lib/db";
import type { Tournament } from "../lib/royale";
import { RPC_TIMEOUT_MS } from "../lib/rpc";
const localDb = "postgresql://stress_user@127.0.0.1:55432/freeze_stress";

for (const accepted of [false, true]) {
  test(`a move times out ${accepted ? "after being accepted" : "before reaching the server"} and releases action controls`, async ({
    page,
  }, info) => {
    test.skip(
      process.env.DATABASE_URL !== localDb ||
        info.project.use.baseURL !== "http://127.0.0.1:3100",
      "Isolated stress server required",
    );
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
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
    // Extend only this disposable game's clock so the 12-second network fault
    // can be tested independently of the 15-second gameplay clock.
    state.settings = {
      ...state.settings!,
      countdownMs: 0,
      clockMs: 60000,
      matchMs: 120000,
      botDelayMs: 100,
    };
    await query("UPDATE tournaments SET state=$1 WHERE id=$2", [
      JSON.stringify(state),
      row.id,
    ]);
    await page
      .getByRole("button", { name: "Start Royale now →", exact: true })
      .click();
    const square = page.locator(".arena .board button:enabled").first();
    await expect(square).toBeVisible({ timeout: 15000 });
    const ready = (
      await query("SELECT state FROM tournaments WHERE id=$1", [row.id])
    ).rows[0].state as Tournament;
    const initial = ready.matches.find(
      (m) => m.players.includes(state.entrants[0].id) && m.status === "playing",
    )!;
    const initialMoves = initial.state.moves.length;
    const symbol = initial.state.turn === 1 ? "X" : "O";
    ready.settings!.botDelayMs = 60000;
    await query("UPDATE tournaments SET state=$1 WHERE id=$2", [
      JSON.stringify(ready),
      row.id,
    ]);
    const label = (await square.getAttribute("aria-label"))!;
    let intercepted = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/api/rpc", async (route) => {
      if (
        route.request().postDataJSON()?.name !== "royale.move" ||
        intercepted++
      ) {
        await route.continue();
        return;
      }
      if (accepted) {
        // Commit the action, but lose its response: polling must reconcile it.
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        await gate;
        await route.fulfill({ response }).catch(() => {});
      } else {
        await gate;
        await route.abort().catch(() => {});
      }
    });
    try {
      const started = Date.now();
      await square.click();
      await expect(
        page.getByRole("button", { name: "Resign match", exact: true }),
      ).toBeDisabled();
      await expect(page.locator(".arena .board button:enabled")).toHaveCount(0);
      await expect(page.locator('.royale-error[role="alert"]')).toContainText(
        "The connection is taking too long. Please try again.",
        { timeout: RPC_TIMEOUT_MS + 4000 },
      );
      const elapsedMs = Date.now() - started;
      expect(elapsedMs).toBeGreaterThanOrEqual(RPC_TIMEOUT_MS - 1000);
      expect(elapsedMs).toBeLessThan(RPC_TIMEOUT_MS + 4000);
      await expect(
        page.getByRole("button", { name: "Resign match", exact: true }),
      ).toBeEnabled();
      const saved = (
        await query("SELECT state FROM tournaments WHERE id=$1", [row.id])
      ).rows[0].state as Tournament;
      const match = saved.matches.find((m) =>
        m.players.includes(state.entrants[0].id),
      )!;
      expect(match.state.moves).toHaveLength(initialMoves + (accepted ? 1 : 0));
      await page.getByRole("button", { name: "Dismiss", exact: true }).click();
      if (accepted) {
        await expect(
          page.getByRole("button", {
            name: `${label}, ${symbol}`,
            exact: true,
          }),
        ).toBeVisible();
      } else {
        // The optimistic move must be rolled back and the same square retryable.
        const retry = page.getByRole("button", { name: label, exact: true });
        await expect(retry).toBeEnabled();
        const response = page.waitForResponse(
          (r) =>
            r.url().endsWith("/api/rpc") &&
            r.request().postDataJSON()?.name === "royale.move",
        );
        await retry.click();
        expect((await response).status()).toBe(200);
      }
      const final = (
        await query("SELECT state FROM tournaments WHERE id=$1", [row.id])
      ).rows[0].state as Tournament;
      expect(final.matches[match.id].state.moves).toHaveLength(
        initialMoves + 1,
      );
      await expect(
        page.getByRole("button", { name: "Resign match", exact: true }),
      ).toBeEnabled();
      await page
        .getByRole("button", { name: "Resign match", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Play again →", exact: true }),
      ).toBeVisible();
      expect(errors).toEqual([]);
      console.log(
        `Action timeout: accepted=${accepted}, elapsed=${elapsedMs}ms, player move recorded once, controls recovered`,
      );
      await page.screenshot({
        path: info.outputPath("action-timeout-recovered.jpg"),
        fullPage: true,
      });
    } finally {
      release();
      await page.unrouteAll({ behavior: "wait" });
    }
  });
}

test("an unanswered turn expires and the player can enter another game", async ({
  page,
}, info) => {
  test.skip(
    process.env.DATABASE_URL !== localDb ||
      info.project.use.baseURL !== "http://127.0.0.1:3100",
    "Isolated stress server required",
  );
  await page.goto("/");
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
  const seat = match.players.indexOf(state.entrants[0].id);
  expect(match.clocks[seat]).toBe(15000);
  await expect(
    page.getByRole("button", { name: "Play again →", exact: true }),
  ).toBeVisible({ timeout: 22000 });
  const finished = (
    await query("SELECT state FROM tournaments WHERE id=$1", [row.id])
  ).rows[0].state as Tournament;
  expect(finished.matches[match.id].status).toBe("finished");
  expect(finished.matches[match.id].reason).toBe("clock");
  expect(finished.matches[match.id].winner).not.toBe(state.entrants[0].id);
  await page
    .getByRole("button", { name: "Host a friend Royale →", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start Royale now →", exact: true }),
  ).toBeEnabled();
  const profile = (
    await query("SELECT active FROM profiles WHERE id=$1", [
      state.entrants[0].id,
    ])
  ).rows[0];
  expect(profile.active).toBeTruthy();
  expect(profile.active).not.toBe(row.id);
  console.log(
    "Turn timeout: 15-second clock expired, result settled, player requeued",
  );
  await page.getByRole("button", { name: "Leave lobby", exact: true }).click();
});

test("six consecutive games recover from a hung dashboard without losing the player", async ({
  page,
}, info) => {
  test.skip(
    process.env.DATABASE_URL !== localDb ||
      info.project.use.baseURL !== "http://127.0.0.1:3100",
    "Isolated stress server required",
  );
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  let player: string | null = null;
  for (let round = 0; round < 6; round++) {
    await page
      .getByRole("button", { name: "Host a friend Royale →", exact: true })
      .click();
    const invite = await page.getByLabel("Challenge link").inputValue();
    const code = new URL(invite).searchParams.get("room");
    const row = (
      await query("SELECT * FROM tournaments WHERE room_code=$1", [code])
    ).rows[0];
    const state = row.state as Tournament;
    if (player) expect(state.entrants[0].id).toBe(player);
    else player = state.entrants[0].id;
    state.settings = { ...state.settings!, countdownMs: 0, botDelayMs: 100 };
    await query("UPDATE tournaments SET state=$1 WHERE id=$2", [
      JSON.stringify(state),
      row.id,
    ]);
    await page.getByRole("button", { name: "Start Royale now →" }).click();
    await expect(
      page.locator(".arena .board button:enabled").first(),
    ).toBeVisible({ timeout: 15000 });
    await page.locator(".arena .board button:enabled").first().click();
    await expect(
      page.getByRole("button", { name: "Resign match", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Resign match", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Play again →", exact: true }),
    ).toBeVisible();
    console.log(`UI repeat: ${round + 1}/6 completed`);
    if (round === 2) {
      let held = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/rpc", async (route) => {
        if (route.request().postDataJSON()?.name === "royale.dashboard") {
          held++;
          await gate;
          await route.continue().catch(() => {});
        } else await route.continue();
      });
      await expect(
        page.getByText(
          "Connection interrupted. Reconnecting to your saved game…",
          { exact: true },
        ),
      ).toBeVisible({ timeout: 16000 });
      expect(held).toBeGreaterThan(0);
      release();
      await expect(
        page.getByText(
          "Connection interrupted. Reconnecting to your saved game…",
          { exact: true },
        ),
      ).not.toBeVisible({ timeout: 10000 });
      await page.unrouteAll({ behavior: "wait" });
    }
  }
  await page.screenshot({
    path: info.outputPath("six-games-recovered.jpg"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

import { test, expect } from "@playwright/test";
import { observeAudio, audioEvents } from "./audio";
import { localRelay } from "./relay";
import winning from "./fixtures/winning-game.json";
test("single player makes distinct X/O sounds, restarts, and respects persistent mute", async ({
  page,
}) => {
  await observeAudio(page);
  await page.goto("/practice");
  expect(
    await page.evaluate(
      () => (window as unknown as { audioContexts: number }).audioContexts,
    ),
  ).toBe(0);
  await page
    .getByRole("button", { name: "Play the computer", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Computer ready");
  await page
    .getByRole("button", { name: "Board 5, square 5", exact: true })
    .click();
  await expect(
    page.locator(".board button").filter({ hasText: "◯" }),
  ).toHaveCount(1);
  await expect.poll(async () => (await audioEvents(page)).length).toBe(2);
  expect(await audioEvents(page)).toEqual([
    { type: "tone", frequency: 520 },
    { type: "tone", frequency: 360 },
  ]);
  await page.getByRole("button", { name: "New Game", exact: true }).click();
  await expect(
    page.locator(".board button").filter({ hasText: /✕|◯/ }),
  ).toHaveCount(0);
  expect(await audioEvents(page)).toHaveLength(2);
  await page.getByRole("button", { name: "Mute sounds", exact: true }).click();
  await page
    .getByRole("button", { name: "Board 1, square 1", exact: true })
    .click();
  await expect(
    page.locator(".board button").filter({ hasText: "◯" }),
  ).toHaveCount(1);
  expect(await audioEvents(page)).toHaveLength(2);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Enable sounds", exact: true }),
  ).toBeVisible();
});
test("a complete hosted game plays one fanfare for the winner and one woosh for the loser", async ({
  browser,
}) => {
  const relay = await localRelay(),
    a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  try {
    const host = await a.newPage(),
      guest = await b.newPage(),
      viewer = await c.newPage();
    await observeAudio(host);
    await observeAudio(guest);
    await observeAudio(viewer);
    await host.goto("/practice");
    await host.getByText("Relay settings", { exact: true }).click();
    await host.getByLabel("Relay URLs").fill(relay.url);
    await host.getByRole("button", { name: "Host game", exact: true }).click();
    await expect(host.getByRole("status")).toContainText("Private lobby ready");
    const link = await host.getByLabel("Invite link").inputValue();
    await guest.goto(link);
    await expect(guest.getByRole("status")).toContainText("Connected");
    await guest
      .getByRole("heading", { name: "Your next rival.", exact: true })
      .click();
    for (let i = 0; i < winning.moves.length; i++) {
      const action = winning.moves[i],
        page = i % 2 === 0 ? host : guest;
      await page
        .getByRole("button", {
          name: `Board ${Math.floor(action / 9) + 1}, square ${(action % 9) + 1}`,
          exact: true,
        })
        .click();
      const other = page === host ? guest : host;
      await expect(
        other.getByRole("button", {
          name: `Board ${Math.floor(action / 9) + 1}, square ${(action % 9) + 1}, ${i % 2 === 0 ? "X" : "O"}`,
          exact: true,
        }),
      ).toBeVisible();
    }
    await expect(host.locator(".score")).toContainText("You win");
    await expect(guest.locator(".score")).toContainText("You lose");
    for (const page of [host, guest]) {
      await expect(
        page.getByRole("img", {
          name: "X wins across boards 4, 5, 6",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.locator(".last-move")).toHaveCount(1);
      await expect(page.locator(".last-move")).toHaveAttribute(
        "aria-description",
        "Most recent move",
      );
      await expect(page.locator(".last-move")).toHaveCSS("opacity", "1");
    }
    await host.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        host.evaluate(() => {
          const board = document.querySelector<HTMLElement>(".board")!,
            svg = document.querySelector<SVGSVGElement>(".winning-line")!,
            line = svg.querySelector("line")!;
          return (
            Math.abs(svg.viewBox.baseVal.width - board.clientWidth) < 1 &&
            Math.abs(Number(line.getAttribute("y1")) - board.clientHeight / 2) <
              1 &&
            line.getAttribute("y1") === line.getAttribute("y2")
          );
        }),
      )
      .toBe(true);
    await host.screenshot({
      path: "test-results/winning-board.png",
      fullPage: true,
    });
    await expect
      .poll(async () => (await audioEvents(host)).length)
      .toBe(winning.moves.length + 4);
    await expect
      .poll(async () => (await audioEvents(guest)).length)
      .toBe(winning.moves.length + 1);
    expect((await audioEvents(host)).slice(-4).map((e) => e.frequency)).toEqual(
      [523.25, 659.25, 783.99, 1046.5],
    );
    expect((await audioEvents(guest)).at(-1)).toEqual({ type: "noise" });
    // A late viewer sees the completed game without replaying past sounds.
    await viewer.goto(link);
    await expect(viewer.getByRole("status")).toContainText("Watching");
    await viewer
      .getByRole("heading", { name: "Watch the game.", exact: true })
      .click();
    await expect(viewer.locator(".score")).toContainText("X wins");
    await expect(
      viewer.getByRole("img", {
        name: "X wins across boards 4, 5, 6",
        exact: true,
      }),
    ).toBeVisible();
    expect(await audioEvents(viewer)).toEqual([]);
    await host.close();
    await expect(guest.getByRole("status")).toContainText("host left");
    await expect(guest.locator(".score")).toContainText("You lose");
    expect(await audioEvents(guest)).toHaveLength(winning.moves.length + 1);
  } finally {
    await Promise.all([a.close(), b.close(), c.close()]);
    await relay.close();
  }
});

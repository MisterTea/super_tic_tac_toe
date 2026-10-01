import { test, expect } from "@playwright/test";
import { initial, legal, play } from "../lib/game";
import { newLobby, startTournament, publicTournament } from "../lib/royale";
import winning from "./fixtures/winning-game.json";

for (const perspective of ["winner", "loser", "spectator"] as const) {
  test(`Royale holds the final board after an opponent move for the ${perspective}`, async ({
    page,
  }, info) => {
    const tournament = newLobby(0, Date.now(), 9);
    tournament.entrants.push({
      id: "player",
      name: "Test Player",
      cpu: false,
      avatar: "X",
      skill: 1,
      points: 0,
      moved: true,
      wins: 0,
      boards: 0,
    });
    startTournament(tournament, Date.now());
    const match = tournament.matches[0];
    match.players =
      perspective === "winner"
        ? ["player", "cpu-1"]
        : perspective === "loser"
          ? ["cpu-1", "player"]
          : ["cpu-1", "cpu-2"];
    match.status = "playing";
    match.state = winning.moves.slice(0, -1).reduce(play, initial());
    let complete = false;
    await page.route("**/api/auth/get-session**", (route) =>
      route.fulfill({
        json: {
          user: {
            id: "player",
            name: "Test Player",
            email: "test@example.com",
            isAnonymous: false,
          },
          session: {
            id: "session",
            userId: "player",
            expiresAt: new Date(Date.now() + 86400000).toISOString(),
          },
        },
      }),
    );
    await page.route("**/api/rpc", async (route) => {
      const name = route.request().postDataJSON().name;
      let result: unknown = null;
      if (name === "royale.dashboard") {
        const t = structuredClone(tournament);
        if (complete) {
          t.matches[0].state = play(match.state, winning.moves.at(-1)!);
          t.matches[0].status = "finished";
          t.matches[0].winner = match.players[0];
          t.entrants.find((e) => e.id === "player")!.finish =
            perspective === "winner" ? 4 : 0;
          t.entrants.find((e) => e.id === "player")!.wins =
            perspective === "winner" ? 1 : 0;
        }
        result = {
          profile: {
            _id: "player",
            id: "player",
            name: "Test Player",
            points: 0,
            xp: 0,
            crowns: 0,
            cosmetics: [],
            equipped: {},
            active: complete ? undefined : "test",
            joinedAt: Date.now(),
          },
          tournament: { ...publicTournament(t), id: "test" },
          view: complete
            ? { phase: "results" }
            : {
                phase: perspective === "spectator" ? "spectating" : "playing",
                matchId: 0,
                nextRound: 1,
              },
          history: [],
          quests: null,
          serverNow: Date.now(),
        };
      } else if (name === "leaderboard.top") result = [];
      await route.fulfill({ json: { result } });
    });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/");
    await expect(page.locator(".arena .board button")).toHaveCount(81);
    if (perspective === "winner") {
      const action = legal(match.state).find((a) => match.state.boards[a % 9]);
      expect(action).toBeDefined();
      await page
        .getByRole("button", {
          name: `Board ${Math.floor(action! / 9) + 1}, square ${(action! % 9) + 1}`,
          exact: true,
        })
        .focus();
      await expect(page.locator(".preview .routing-caption")).toHaveText(
        `Board ${(action! % 9) + 1} is closed · free choice`,
      );
      await expect(page.locator(".move-routing.preview rect")).toHaveCount(
        match.state.boards.filter((b) => !b).length,
      );
    }
    await page.getByRole("button", { name: "Sound on", exact: true }).click();
    complete = true;
    const overlay = page.locator(".board-result");
    await expect(overlay).toHaveText(
      perspective === "winner"
        ? "Victory"
        : perspective === "loser"
          ? "Defeat"
          : /wins/,
    );
    await expect(page.locator(".result-card")).toHaveCount(0);
    await expect(page.locator(".arena .board button:enabled")).toHaveCount(0);
    await page.waitForTimeout(1200);
    await expect(overlay).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`result-${perspective}.png`),
      fullPage: true,
    });
    await expect(page.locator(".result-card")).toBeVisible({ timeout: 5000 });
    await expect(overlay).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

test("square previews route to the matching board and remain readable with reduced motion", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/practice?mode=computer");
  const square = page.getByRole("button", {
    name: "Board 5, square 1",
    exact: true,
  });
  await expect(square).toBeEnabled({ timeout: 30000 });
  await square.focus();
  await expect(page.locator(".preview .routing-caption")).toHaveText(
    "Square 1 → board 1",
  );
  await expect(page.locator(".move-routing.preview rect")).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: info.outputPath("routing-mobile.png"),
    fullPage: true,
  });
  await square.click();
  await expect(page.locator(".move-routing:not(.preview)")).toHaveCount(1);
  await expect(page.locator(".small.eligible")).toHaveCount(1);
});

test("routing animates once per move across previews and turn changes", async ({
  page,
}) => {
  await page.goto("/practice?mode=computer");
  const square = page.getByRole("button", {
    name: "Board 5, square 1",
    exact: true,
  });
  await expect(square).toBeEnabled({ timeout: 30000 });
  await page.evaluate(() => {
    (window as any).routingStarts = 0;
    document.addEventListener("animationstart", (event) => {
      if (
        event.animationName === "routing-trail" &&
        (event.target as Element).matches(".move-routing path")
      ) {
        (window as any).routingStarts++;
      }
    });
  });
  await square.hover();
  await page.waitForTimeout(650);
  await square.click();
  await expect(
    page.getByRole("button", { name: "Board 5, square 1, X", exact: true }),
  ).toBeVisible();
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => (window as any).routingStarts)).toBe(1);
  await expect(page.locator(".last-move")).toHaveText("◯", { timeout: 15000 });
  await expect
    .poll(() => page.evaluate(() => (window as any).routingStarts))
    .toBe(2);
  await page.locator(".board button:enabled").first().hover();
  await page.waitForTimeout(150);
  await page.mouse.move(0, 0);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => (window as any).routingStarts)).toBe(2);
});

test("Royale confirmation preserves the optimistic move's animation", async ({
  page,
}) => {
  const tournament = newLobby(0, Date.now(), 9);
  tournament.entrants.push({
    id: "player",
    name: "Test Player",
    cpu: false,
    avatar: "X",
    skill: 1,
    points: 0,
    moved: true,
    wins: 0,
    boards: 0,
  });
  startTournament(tournament, Date.now());
  const match = tournament.matches[0];
  match.players = ["player", "cpu-1"];
  match.status = "playing";
  match.state = initial();
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let confirmed = false;
  await page.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "player",
          name: "Test Player",
          email: "test@example.com",
          isAnonymous: false,
        },
        session: {
          id: "session",
          userId: "player",
          expiresAt: new Date(Date.now() + 86400000).toISOString(),
        },
      },
    }),
  );
  await page.route("**/api/rpc", async (route) => {
    const { name, args } = route.request().postDataJSON();
    let result: unknown = null;
    if (name === "royale.move") {
      await responseGate;
      match.state = play(match.state, args.action);
      tournament.version++;
      confirmed = true;
      result = {
        match: publicTournament(tournament).matches[0],
        serverNow: Date.now(),
      };
    } else if (name === "royale.dashboard") {
      result = {
        profile: {
          _id: "player",
          id: "player",
          name: "Test Player",
          points: 0,
          xp: 0,
          crowns: 0,
          cosmetics: [],
          equipped: {},
          active: "test",
          joinedAt: Date.now(),
        },
        tournament: { ...publicTournament(tournament), id: "test" },
        view: { phase: "playing", matchId: 0 },
        history: [],
        quests: null,
        serverNow: Date.now(),
      };
    } else if (name === "leaderboard.top") result = [];
    await route.fulfill({ json: { result } });
  });
  await page.goto("/");
  const square = page.getByRole("button", {
    name: "Board 5, square 1",
    exact: true,
  });
  await expect(square).toBeEnabled();
  await page.evaluate(() => {
    (window as any).routingStarts = 0;
    document.addEventListener("animationstart", (event) => {
      if (
        event.animationName === "routing-trail" &&
        (event.target as Element).matches(".move-routing path")
      )
        (window as any).routingStarts++;
    });
  });
  try {
    await square.hover();
    await square.click();
    await expect(
      page.getByRole("heading", { name: "Opponent’s turn.", exact: true }),
    ).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as any).routingStarts))
      .toBe(1);
    await page.evaluate(() => {
      (window as any).firstTrail = document.querySelector(
        ".move-routing:not(.preview) path",
      );
    });
    // Let the optimistic animation finish while old dashboard snapshots arrive.
    await page.waitForTimeout(1300);
    release();
    await expect.poll(() => confirmed).toBe(true);
    await expect(
      page.getByRole("button", { name: "Resign match", exact: true }),
    ).toBeEnabled();
    await page.waitForTimeout(650);
    expect(await page.evaluate(() => (window as any).routingStarts)).toBe(1);
    expect(
      await page.evaluate(
        () =>
          (window as any).firstTrail ===
          document.querySelector(".move-routing:not(.preview) path"),
      ),
    ).toBe(true);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

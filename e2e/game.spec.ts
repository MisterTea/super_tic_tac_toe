import { test, expect } from "@playwright/test";
import { localRelay } from "./relay";
import { observeAudio, audioEvents } from "./audio";
test("private invite seats one guest, streams late spectators, and ends everyone on guest departure", async ({
  browser,
}) => {
  const relay = await localRelay(),
    a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext(),
    d = await browser.newContext();
  try {
    const host = await a.newPage(),
      guest = await b.newPage(),
      viewer = await c.newPage(),
      late = await d.newPage();
    await observeAudio(host);
    await observeAudio(guest);
    const errors: string[] = [];
    for (const p of [host, guest, viewer, late])
      p.on("pageerror", (e) => errors.push(e.message));
    await host.goto("/practice");
    await host.getByText("Relay settings", { exact: true }).click();
    await host.getByLabel("Relay URLs").fill(relay.url);
    await host.getByRole("button", { name: "Host game", exact: true }).click();
    await expect(host.getByRole("status")).toContainText("Private lobby ready");
    await expect(host.locator(".board")).toHaveCount(0);
    const link = await host.getByLabel("Invite link").inputValue();
    expect(new URL(link).searchParams.get("code")).toMatch(
      /^[a-f0-9]{64}\.[a-f0-9]{64}$/,
    );
    await expect(
      host.getByRole("button", { name: "Play random opponent", exact: true }),
    ).toHaveCount(0);
    await guest.goto(link);
    await expect(host.getByRole("status")).toContainText("Connected", {
      timeout: 20000,
    });
    await expect(guest.getByRole("status")).toContainText("Connected");
    await expect(host.locator(".board")).toBeVisible();
    await expect(
      guest.getByRole("button", { name: "Board 5, square 5", exact: true }),
    ).toBeDisabled();
    await host
      .getByRole("button", { name: "Board 5, square 5", exact: true })
      .click();
    await expect(
      guest.getByRole("button", { name: "Board 5, square 5, X", exact: true }),
    ).toHaveText("✕");
    await expect(guest.locator(".score")).toContainText("Your turn");
    await expect(host.getByLabel("Seconds remaining")).toHaveText(
      /(?:5[0-9]|60)s/,
    );
    await viewer.goto(link);
    await expect(viewer.getByRole("status")).toContainText("Watching", {
      timeout: 20000,
    });
    await expect(viewer.getByText("View mode", { exact: false })).toBeVisible();
    await expect(viewer.locator(".board button:enabled")).toHaveCount(0);
    await expect(
      viewer.getByRole("button", { name: "Board 5, square 5, X", exact: true }),
    ).toHaveText("✕");
    await guest
      .getByRole("button", { name: "Board 5, square 1", exact: true })
      .click();
    await expect(
      viewer.getByRole("button", { name: "Board 5, square 1, O", exact: true }),
    ).toHaveText("◯");
    await late.goto(link);
    await expect(late.getByRole("status")).toContainText("Watching");
    await expect(late.locator(".board")).toHaveText(
      (await host.locator(".board").textContent())!,
    );
    await expect(late.locator(".board button:enabled")).toHaveCount(0);
    expect(
      relay.events.every(
        (e) => typeof JSON.parse(e.content).sealed === "string",
      ),
    ).toBe(true);
    await guest
      .getByRole("button", { name: "Leave game", exact: true })
      .click();
    for (const p of [host, viewer, late]) {
      await expect(p.getByRole("status")).toContainText("guest left");
      await expect(p.locator(".board button:enabled")).toHaveCount(0);
      await expect(p.locator(".winning-line")).toHaveCount(0);
    }
    await expect(host.locator(".score")).toContainText("You win");
    await expect
      .poll(async () => (await audioEvents(guest)).at(-1)?.type)
      .toBe("noise");
    for (const p of [viewer, late])
      await expect(p.locator(".score")).toContainText("X wins");
    await expect
      .poll(
        async () =>
          (await audioEvents(host)).filter((e) => e.type === "tone").length,
      )
      .toBe(6);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all([a.close(), b.close(), c.close(), d.close()]);
    await relay.close();
  }
});
test("host tab closing notifies the guest and spectators", async ({
  browser,
}) => {
  const relay = await localRelay(),
    contexts = await Promise.all([
      browser.newContext(),
      browser.newContext(),
      browser.newContext(),
    ]);
  try {
    const [host, guest, viewer] = await Promise.all(
      contexts.map((c) => c.newPage()),
    );
    await host.goto("/practice");
    await host.getByText("Relay settings", { exact: true }).click();
    await host.getByLabel("Relay URLs").fill(relay.url);
    await host.getByRole("button", { name: "Host game", exact: true }).click();
    await expect(host.getByRole("status")).toContainText("Private lobby ready");
    await observeAudio(guest);
    const link = await host.getByLabel("Invite link").inputValue();
    await guest.goto(link);
    await expect(guest.getByRole("status")).toContainText("Connected");
    await viewer.goto(link);
    await expect(viewer.getByRole("status")).toContainText("Watching");
    // A freshly loaded invite tab needs a gesture before its browser permits sound.
    await guest
      .getByRole("heading", { name: "Your next rival.", exact: true })
      .click();
    await host.close();
    for (const p of [guest, viewer])
      await expect(p.getByRole("status")).toContainText("host left", {
        timeout: 20000,
      });
    await expect(guest.locator(".score")).toContainText("You win");
    await expect(viewer.locator(".score")).toContainText("O wins");
    await expect.poll(async () => (await audioEvents(guest)).length).toBe(4);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await relay.close();
  }
});
test("Invite host enforces automatic random moves on both seats after sixty seconds", async ({
  browser,
}) => {
  const relay = await localRelay(),
    a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const host = await a.newPage(),
      guest = await b.newPage();
    for (const page of [host, guest])
      await page.addInitScript(() => {
        const stats = window as unknown as Window & { receivedPings: number };
        stats.receivedPings = 0;
        const observe = (channel: RTCDataChannel) =>
          channel.addEventListener("message", (event) => {
            if (JSON.parse(event.data).type === "ping") stats.receivedPings++;
          });
        const Native = RTCPeerConnection;
        window.RTCPeerConnection = class extends Native {
          constructor(configuration?: RTCConfiguration) {
            super(configuration);
            this.addEventListener("datachannel", (event) =>
              observe(event.channel),
            );
          }
          createDataChannel(label: string, options?: RTCDataChannelInit) {
            const channel = super.createDataChannel(label, options);
            observe(channel);
            return channel;
          }
        };
      });
    for (const page of [host, guest]) {
      await page.goto("/practice");
      await page.getByText("Relay settings", { exact: true }).click();
      await page.getByLabel("Relay URLs").fill(relay.url);
    }
    await host.getByRole("button", { name: "Host game", exact: true }).click();
    await expect(host.getByRole("status")).toContainText("Private lobby ready");
    await guest.goto(await host.getByLabel("Invite link").inputValue());
    await expect(guest.getByRole("status")).toContainText("Connected");
    await host.evaluate(() => {
      Math.random = () => 0.999999;
    });
    await host.clock.install();
    await guest.clock.install();
    const paused = new Date(Date.now() + 100);
    await host.clock.pauseAt(paused);
    await guest.clock.pauseAt(paused);
    for (let step = 0; step < 12; step++) {
      const before = await host.evaluate(
        () =>
          (window as unknown as Window & { receivedPings: number })
            .receivedPings,
      );
      await host.clock.runFor(5000);
      await guest.clock.runFor(5000);
      // Drain real WebRTC delivery before advancing either browser's virtual clock again.
      await expect
        .poll(() =>
          host.evaluate(
            () =>
              (window as unknown as Window & { receivedPings: number })
                .receivedPings,
          ),
        )
        .toBeGreaterThan(before);
    }
    await expect(
      host.locator(".board button").filter({ hasText: "✕" }),
    ).toHaveCount(1);
    await expect(
      guest.locator(".board button").filter({ hasText: "✕" }),
    ).toHaveCount(1);
    await expect(
      host.getByRole("button", { name: "Board 9, square 9, X", exact: true }),
    ).toHaveText("✕");
    for (let step = 0; step < 12; step++) {
      const before = await host.evaluate(
        () =>
          (window as unknown as Window & { receivedPings: number })
            .receivedPings,
      );
      await host.clock.runFor(5000);
      await guest.clock.runFor(5000);
      // Drain real WebRTC delivery before advancing either browser's virtual clock again.
      await expect
        .poll(() =>
          host.evaluate(
            () =>
              (window as unknown as Window & { receivedPings: number })
                .receivedPings,
          ),
        )
        .toBeGreaterThan(before);
    }
    await host.clock.runFor(1500);
    await guest.clock.runFor(1500);
    await expect(host.getByRole("status")).not.toContainText("left");
    await expect(
      host.locator(".board button").filter({ hasText: "◯" }),
    ).toHaveCount(1);
    await expect(
      guest.locator(".board button").filter({ hasText: "◯" }),
    ).toHaveCount(1);
    await expect(
      guest.getByRole("button", {
        name: "Board 9, square 8, O",
        exact: true,
      }),
    ).toHaveText("◯");
    await expect(host.getByRole("status")).not.toContainText("left");
  } finally {
    await a.close();
    await b.close();
    await relay.close();
  }
});

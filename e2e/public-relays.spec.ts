import { test, expect } from "@playwright/test";
test("public Nostr relays connect private invite peers", async ({
  browser,
}) => {
  test.skip(!process.env.PUBLIC_RELAYS, "Opt-in external network test");
  const a = await browser.newContext(),
    b = await browser.newContext();
  try {
    const host = await a.newPage(),
      guest = await b.newPage();
    await host.goto("/");
    await host.getByText("Relay settings", { exact: true }).click();
    await host.getByLabel("Relay URLs").fill(process.env.PUBLIC_RELAYS!);
    await host.getByRole("button", { name: "Host game", exact: true }).click();
    await expect(host.getByRole("status")).toContainText(
      "Private lobby ready",
      { timeout: 20000 },
    );
    await guest.goto(await host.getByLabel("Invite link").inputValue());
    await expect(host.getByRole("status")).toContainText("Connected", {
      timeout: 25000,
    });
    await expect(guest.getByRole("status")).toContainText("Connected");
    await host
      .getByRole("button", { name: "Board 5, square 5", exact: true })
      .click();
    await expect(
      guest.getByRole("button", { name: "Board 5, square 5, X", exact: true }),
    ).toHaveText("✕");
  } finally {
    await a.close();
    await b.close();
  }
});

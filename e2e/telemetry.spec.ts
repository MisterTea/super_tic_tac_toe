import { test, expect } from "@playwright/test";

test("public totals appear on Royale and practice without exposing private telemetry", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.DATABASE_URL, "Requires configured Neon database");
  const rpc = async (name: string) => {
    const response = await page.request.post("/api/rpc", {
      data: { name, args: {} },
    });
    expect(response.ok()).toBe(true);
    return (await response.json()).result;
  };
  for (const route of ["/", "/practice"]) {
    const before = await rpc("telemetry.publicStats");
    await page.goto(route);
    const header = page.locator("header .brand-stats");
    await expect(header).toHaveText(
      /◎ [\d,]+ (games played|crowns given|total players)/,
    );
    const label = (await header.innerText()).replace("◎ ", "");
    const displayed = Number(label.split(" ")[0].replaceAll(",", ""));
    const key = label.endsWith("games played")
      ? "games"
      : label.endsWith("crowns given")
        ? "crowns"
        : "players";
    const after = await rpc("telemetry.publicStats");
    expect(displayed).toBeGreaterThanOrEqual(Math.min(before[key], after[key]));
    expect(displayed).toBeLessThanOrEqual(Math.max(before[key], after[key]));
    expect(Object.keys(after).sort()).toEqual(["crowns", "games", "players"]);
    if (route === "/practice")
      await page.screenshot({ path: testInfo.outputPath("stat-header.jpg") });
  }
  const privateReport = await page.request.post("/api/rpc", {
    data: { name: "telemetry:report", args: {} },
  });
  expect(privateReport.status()).toBe(400);
  expect((await privateReport.json()).error).toMatch(/unknown function/i);
});

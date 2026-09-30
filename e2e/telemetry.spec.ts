import { test, expect } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "../convex/_generated/api";

test("public totals appear on Royale and practice without exposing private telemetry", async ({
  page,
}, testInfo) => {
  test.skip(!process.env.NEXT_PUBLIC_CONVEX_URL, "Requires configured Convex");
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  for (const route of ["/", "/practice"]) {
    const before = await client.query(api.telemetry.publicStats, {});
    await page.goto(route);
    const header = page.locator("header .brand");
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
    const after = await client.query(api.telemetry.publicStats, {});
    expect(displayed).toBeGreaterThanOrEqual(Math.min(before[key], after[key]));
    expect(displayed).toBeLessThanOrEqual(Math.max(before[key], after[key]));
    expect(Object.keys(after).sort()).toEqual(["crowns", "games", "players"]);
    if (route === "/practice")
      await page.screenshot({ path: testInfo.outputPath("stat-header.jpg") });
  }
  await expect(
    client.query(makeFunctionReference<"query">("telemetry:report"), {}),
  ).rejects.toThrow(/Server Error|public function|internal/i);
});

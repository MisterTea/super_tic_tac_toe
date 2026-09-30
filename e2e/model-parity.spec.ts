import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
test("browser WASM graph matches PyTorch at every difficulty", async ({
  page,
}) => {
  await page.goto("/");
  const rows = JSON.parse(
    readFileSync("e2e/fixtures/browser-policy.json", "utf8"),
  );
  const actual = await page.evaluate(async (rows) => {
    const path = "/ai/ort/ort.wasm.bundle.min.mjs";
    const ort = await import(path);
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = new URL("/ai/ort/", location.href).href;
    const session = await ort.InferenceSession.create("/ai/policy.onnx", {
      executionProviders: ["wasm"],
    });
    const outputs = [];
    for (const row of rows) {
      const feeds: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(row.inputs))
        feeds[name] = new ort.Tensor(
          "float32",
          Float32Array.from(value as number[]),
          name === "features" ? [81, 12] : [(value as number[]).length],
        );
      const result = await session.run(feeds);
      outputs.push(
        Object.fromEntries(
          Object.entries(result).map(([key, value]) => [
            key,
            Array.from((value as { data: Float32Array }).data),
          ]),
        ),
      );
    }
    await session.release();
    return outputs;
  }, rows);
  expect(actual).toHaveLength(rows.length);
  actual.forEach((out, i) => {
    for (const [key, values] of Object.entries(out))
      for (let j = 0; j < (values as number[]).length; j++)
        expect(
          Math.abs((values as number[])[j] - rows[i].expected[key][j]),
        ).toBeLessThan(2e-4);
  });
});

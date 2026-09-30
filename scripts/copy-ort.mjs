import { mkdir, copyFile, readdir } from "node:fs/promises";
const source = new URL(
    "../node_modules/onnxruntime-web/dist/",
    import.meta.url,
  ),
  target = new URL("../public/ai/ort/", import.meta.url);
await mkdir(target, { recursive: true });
for (const name of await readdir(source))
  if (
    name.startsWith("ort-wasm-simd-threaded") &&
    (name.endsWith(".wasm") || name.endsWith(".mjs"))
  )
    await copyFile(new URL(name, source), new URL(name, target));
await copyFile(
  new URL("ort.wasm.bundle.min.mjs", source),
  new URL("ort.wasm.bundle.min.mjs", target),
);

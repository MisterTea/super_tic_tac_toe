import { afterEach, expect, it, vi } from "vitest";
import { callRpc, RPC_TIMEOUT_MS } from "../lib/rpc";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("aborts a hung RPC and lets the next attempt succeed", async () => {
  vi.useFakeTimers();
  // Use fake-timer-backed signals so the deadline can be tested without a real wait.
  const deadline = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(
      () => controller.abort(new DOMException("Timeout", "TimeoutError")),
      ms,
    );
    return controller.signal;
  });
  const fetch = vi
    .fn()
    .mockImplementationOnce(
      (_url, options) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener("abort", () =>
            reject(options.signal.reason),
          ),
        ),
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ result: { version: 2 } })),
    );
  vi.stubGlobal("fetch", fetch);
  const hung = callRpc("royale.dashboard");
  const rejected = expect(hung).rejects.toThrow("taking too long");
  await vi.advanceTimersByTimeAsync(RPC_TIMEOUT_MS);
  await rejected;
  expect(await callRpc("royale.dashboard")).toEqual({ version: 2 });
  deadline.mockRestore();
});

import { afterEach, describe, expect, it, vi } from "vitest";

const recover = vi.hoisted(() => vi.fn());
vi.mock("../lib/backend/royale", () => ({ recover }));
import { GET } from "../app/api/cron/royale/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  recover.mockReset();
});
const request = (token?: string) =>
  new Request("http://localhost/api/cron/royale", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("Royale watchdog authorization and failure reporting", () => {
  it("fails closed without a configured secret", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(request("undefined"))).status).toBe(503);
    expect(recover).not.toHaveBeenCalled();
  });
  it("rejects absent or incorrect authorization before touching games", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(recover).not.toHaveBeenCalled();
  });
  it("returns awaited recovery results for authorized requests", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    const result = { scanned: 3, due: 2, advanced: 2, failed: 0 };
    recover.mockResolvedValue(result);
    const response = await GET(request("test-secret"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
  });
  it("reports partial failures so monitoring can retry", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    recover.mockResolvedValue({ scanned: 3, due: 2, advanced: 1, failed: 1 });
    expect((await GET(request("test-secret"))).status).toBe(503);
  });
  it("reports scan failures without exposing database details", async () => {
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    recover.mockRejectedValue(new Error("private database details"));
    const response = await GET(request("test-secret"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Watchdog scan failed" });
  });
});

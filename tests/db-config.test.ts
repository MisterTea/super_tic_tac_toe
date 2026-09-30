import { afterEach, describe, expect, it, vi } from "vitest";

const { Pool } = vi.hoisted(() => ({ Pool: vi.fn(function () {}) }));
vi.mock("pg", () => ({ Pool }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  Pool.mockClear();
});

describe("database credentials", () => {
  it.each([undefined, "", "   "])(
    "refuses to initialize without DATABASE_URL (%s)",
    async (value) => {
      vi.stubEnv("DATABASE_URL", value);
      await expect(import("../lib/db")).rejects.toThrow(
        "DATABASE_URL is required",
      );
      expect(Pool).not.toHaveBeenCalled();
    },
  );

  it("uses only the configured connection string and reuses the pool", async () => {
    const connectionString = "postgresql://test:test@localhost/test";
    vi.stubEnv("DATABASE_URL", connectionString);
    const { getPool, pool } = await import("../lib/db");
    expect(getPool()).toBe(pool);
    expect(Pool).toHaveBeenCalledOnce();
    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({ connectionString }),
    );
  });
});

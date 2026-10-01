import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("pg", () => ({
  Pool: vi.fn(function () {
    return mocks;
  }),
}));
afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.connect.mockReset();
});

it("rolls back and retries a deadlock before committing once", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://test@localhost/test");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const client = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
  mocks.connect.mockResolvedValue(client);
  const work = vi
    .fn()
    .mockRejectedValueOnce(
      Object.assign(new Error("deadlock"), { code: "40P01" }),
    )
    .mockResolvedValueOnce("saved");
  const { withTransaction } = await import("../lib/db");
  expect(await withTransaction(work)).toBe("saved");
  expect(work).toHaveBeenCalledTimes(2);
  expect(
    client.query.mock.calls
      .map(([sql]) => sql)
      .filter((sql) => /^(BEGIN|ROLLBACK|COMMIT)$/.test(sql)),
  ).toEqual(["BEGIN", "ROLLBACK", "BEGIN", "COMMIT"]);
  expect(client.query).toHaveBeenCalledWith(
    expect.stringContaining("SET LOCAL lock_timeout"),
  );
  expect(client.release).toHaveBeenCalledTimes(2);
});

it("discards a broken connection instead of retrying after rollback fails", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://test@localhost/test");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const rollbackError = new Error("connection lost");
  const client = {
    query: vi
      .fn()
      .mockImplementation((sql) =>
        sql === "ROLLBACK"
          ? Promise.reject(rollbackError)
          : Promise.resolve({}),
      ),
    release: vi.fn(),
  };
  mocks.connect.mockResolvedValue(client);
  const work = vi
    .fn()
    .mockRejectedValue(Object.assign(new Error("deadlock"), { code: "40P01" }));
  const { withTransaction } = await import("../lib/db");
  await expect(withTransaction(work)).rejects.toThrow("deadlock");
  expect(work).toHaveBeenCalledOnce();
  expect(client.release).toHaveBeenCalledWith(rollbackError);
});

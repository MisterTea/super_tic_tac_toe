import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { initial, play } from "../lib/game";
import {
  advanceTime,
  CLOCK_MS,
  newLobby,
  startTournament,
  type Tournament,
} from "../lib/royale";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  transaction: vi.fn(),
  skill: vi.fn(),
}));
vi.mock("../lib/db", () => ({
  query: mocks.query,
  withTransaction: mocks.transaction,
}));
vi.mock("../lib/skill", () => ({ skillMove: mocks.skill }));
vi.mock("../lib/backend/telemetry", () => ({
  activity: vi.fn(),
  mergeActivity: vi.fn(),
  observeProfile: vi.fn(),
  observeReward: vi.fn(),
  observeTournament: vi.fn(),
  recordEvent: vi.fn(),
}));
import { driveBots } from "../lib/backend/royale";

let tournament: Tournament;
let locked: boolean;
let saved: Tournament | undefined;
const client = { query: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(13_001);
  locked = false;
  saved = undefined;
  tournament = newLobby(0, 1000, 42);
  tournament.entrants.push({
    id: "human",
    name: "Human",
    cpu: false,
    avatar: "●",
    skill: 0,
    points: 0,
    moved: false,
    wins: 0,
    boards: 0,
  });
  startTournament(tournament, 1000);
  advanceTime(tournament, 11_000);
  mocks.query.mockImplementation(async () => ({
    rows: [{ state: structuredClone(tournament) }],
  }));
  mocks.transaction.mockImplementation(async (work) => {
    locked = true;
    try {
      return await work(client);
    } finally {
      locked = false;
    }
  });
  client.query.mockImplementation(async (sql: string, params: unknown[]) => {
    if (sql.includes("FOR UPDATE"))
      return { rows: [{ state: structuredClone(tournament) }] };
    if (sql.startsWith("SELECT state"))
      return { rows: [{ state: structuredClone(tournament) }] };
    if (sql.startsWith("UPDATE tournaments"))
      saved = JSON.parse(params[1] as string);
    return { rows: [] };
  });
  mocks.skill.mockImplementation((state) => {
    expect(locked).toBe(false);
    return state.cells.findIndex((cell: number) => cell === 0);
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("computes CPU moves outside the write lock and coalesces concurrent drives", async () => {
  await Promise.all([
    driveBots("room", tournament.version),
    driveBots("room", tournament.version),
  ]);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.skill).toHaveBeenCalled();
  expect(saved).toBeDefined();
  const played = saved!.matches.filter((m) => m.state.moves.length === 1);
  expect(played.length).toBeGreaterThan(0);
  for (const match of played) {
    expect(match.turnAt).toBe(13_001);
    expect(match.clocks[match.state.turn === 1 ? 0 : 1]).toBe(CLOCK_MS);
  }
});

it("discards calculated moves when the locked match has already changed", async () => {
  const original = structuredClone(tournament);
  mocks.transaction.mockImplementation(async (work) => {
    for (const match of tournament.matches) {
      if (match.status !== "playing") continue;
      match.state = play(initial(), 0);
      match.botAt = 20_000;
    }
    locked = true;
    try {
      return await work(client);
    } finally {
      locked = false;
    }
  });
  await driveBots("room", original.version);
  expect(mocks.skill).toHaveBeenCalled();
  expect(saved).toBeUndefined();
});

it("advances overdue countdowns even with an outdated wake version", async () => {
  tournament = newLobby(0, 1000, 42);
  tournament.entrants.push({
    id: "human",
    name: "Human",
    cpu: false,
    avatar: "●",
    skill: 0,
    points: 0,
    moved: false,
    wins: 0,
    boards: 0,
  });
  startTournament(tournament, 1000);
  await driveBots("room", -1);
  expect(saved!.matches.slice(0, 8).every((m) => m.status === "playing")).toBe(
    true,
  );
});

import { generatePlayerName } from "./player-names";
import { initial, legal, lines, play, scoreWinner, type State } from "./game";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export const RULES_VERSION = 3;
export const LOBBY_MS = 30_000;
export const CLOCK_MS = 15_000;
export const MATCH_MS = 180_000;
export const COUNTDOWN_MS = 10_000;
export const BOT_DELAY_MS = 2_000;
export const DEFAULT_SETTINGS = {
  clockMs: CLOCK_MS,
  matchMs: MATCH_MS,
  countdownMs: COUNTDOWN_MS,
  botDelayMs: BOT_DELAY_MS,
  rankDeltas: [-20, -10, 15, 40, 80],
  baseXp: 50,
  winXp: 25,
  crownXp: 100,
  questXp: 75,
};
export const tiers = [
  "Bronze",
  "Silver",
  "Gold",
  "Platinum",
  "Diamond",
  "Crown",
];
export const thresholds = [0, 200, 500, 900, 1400, 2000];
export const botSkills = [0.2, 0.35, 0.5, 0.65, 0.8, 0.95];
export const roundNames = ["Round of 16", "Quarterfinal", "Semifinal", "Final"];
export function tierIndex(points: number) {
  return thresholds.reduce((tier, value, i) => (points >= value ? i : tier), 0);
}
export const cosmetics = Array.from({ length: 15 }, (_, i) => ({
  id: `unlock-${i + 2}`,
  level: i + 2,
  kind: (["theme", "title", "effect"] as const)[i % 5 === 4 ? 2 : i % 2],
  name: [
    "Glacier",
    "First Challenger",
    "Ember",
    "Board Explorer",
    "Starlight",
    "Ocean",
    "Bracket Breaker",
    "Orchid",
    "Tactician",
    "Confetti",
    "Midnight",
    "Finalist",
    "Sunrise",
    "Royale Legend",
    "Crown Burst",
  ][i],
}));
// Six themes, six titles, three effects, in a fixed progression.
export const levelFor = (xp: number) => 1 + Math.floor(xp / 250);
export type Entrant = {
  id: string;
  name: string;
  cpu: boolean;
  avatar: string;
  skill: number;
  points: number;
  moved: boolean;
  wins: number;
  boards: number;
  finish?: number;
  disqualified?: boolean;
};
export type Match = {
  id: number;
  round: number;
  feeders: number[];
  players: string[];
  status: "pending" | "countdown" | "playing" | "finished";
  state: State;
  clocks: number[];
  startAt: number;
  turnAt: number;
  deadline: number;
  botAt: number;
  winner?: string;
  reason?: string;
  version: number;
  tieSecret: string;
  commitment: string;
  tieReveal?: string;
  finishedAt?: number;
};
export type Tournament = {
  version: number;
  rules: number;
  tier: number;
  status: "lobby" | "active" | "finished" | "cancelled";
  createdAt: number;
  closesAt: number;
  entrants: Entrant[];
  matches: Match[];
  seed: number;
  champion?: string;
  settings?: typeof DEFAULT_SETTINGS;
};
export function seeded(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}
export function newLobby(tier: number, now: number, seed: number): Tournament {
  return {
    version: 0,
    rules: RULES_VERSION,
    tier,
    status: "lobby",
    createdAt: now,
    closesAt: now + LOBBY_MS,
    entrants: [],
    matches: [],
    seed,
    settings: {
      ...DEFAULT_SETTINGS,
      rankDeltas: [...DEFAULT_SETTINGS.rankDeltas],
    },
  };
}
export function startTournament(t: Tournament, now: number) {
  if (t.status !== "lobby") return;
  if (!t.entrants.length) {
    t.status = "cancelled";
    return;
  }
  const rng = seeded(t.seed);
  const names = new Set(t.entrants.map((e) => e.name.toLowerCase()));
  while (t.entrants.length < 16) {
    const i = t.entrants.length;
    let name: string;
    do {
      name = generatePlayerName(Math.floor(rng() * 2 ** 32));
    } while (names.has(name.toLowerCase()));
    names.add(name.toLowerCase());
    t.entrants.push({
      id: `cpu-${i}`,
      name,
      cpu: true,
      avatar: "◆",
      skill: Math.min(1, Math.max(0, botSkills[t.tier] + (rng() - 0.5) * 0.1)),
      points: thresholds[t.tier],
      moved: false,
      wins: 0,
      boards: 0,
    });
  }
  for (let i = 15; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [t.entrants[i], t.entrants[j]] = [t.entrants[j], t.entrants[i]];
  }
  let offset = 0,
    previous: number[] = [];
  for (let round = 0; round < 4; round++) {
    const current: number[] = [];
    for (let i = 0; i < 8 / 2 ** round; i++) {
      const id = offset++;
      const secret = `${t.seed}:${id}:${Math.floor(rng() * 2 ** 32)}`;
      const players =
        round === 0 ? t.entrants.slice(i * 2, i * 2 + 2).map((e) => e.id) : [];
      if (rng() < 0.5) players.reverse();
      t.matches.push({
        id,
        round,
        feeders: round ? previous.slice(i * 2, i * 2 + 2) : [],
        players,
        status: round ? "pending" : "countdown",
        state: initial(),
        clocks: [
          (t.settings || DEFAULT_SETTINGS).clockMs,
          (t.settings || DEFAULT_SETTINGS).clockMs,
        ],
        startAt: round ? 0 : now + (t.settings || DEFAULT_SETTINGS).countdownMs,
        turnAt: 0,
        deadline: 0,
        botAt: 0,
        version: 0,
        tieSecret: secret,
        commitment: bytesToHex(sha256(new TextEncoder().encode(secret))),
      });
      current.push(id);
    }
    previous = current;
  }
  t.status = "active";
  t.version++;
}
export function boardScore(state: State, side: number) {
  const claimed = state.boards.filter((b) => b === side).length;
  let threats = 0;
  state.boards.forEach((closed, b) => {
    if (closed) return;
    for (const line of lines) {
      const cells = line.map((c) => state.cells[b * 9 + c]);
      if (cells.filter((c) => c === side).length === 2 && cells.includes(0))
        threats++;
    }
  });
  return [claimed, threats];
}
function tieWinner(m: Match) {
  return scoreWinner(m.state.boards) === 1 ? 0 : 1;
}
export function finishMatch(
  t: Tournament,
  m: Match,
  winner: string,
  reason: string,
  now: number,
) {
  if (m.status === "finished") return;
  m.status = "finished";
  m.winner = winner;
  m.reason = reason;
  m.finishedAt = now;
  m.version++;
  const winning = t.entrants.find((e) => e.id === winner)!;
  winning.wins++;
  const loser = t.entrants.find(
    (e) => m.players.includes(e.id) && e.id !== winner,
  )!;
  loser.finish = m.round;
  if (m.round === 3) {
    winning.finish = 4;
    t.champion = winner;
    t.status = "finished";
  } else {
    const parent = t.matches.find((next) => next.feeders.includes(m.id))!;
    if (
      parent.status === "pending" &&
      parent.feeders.every((id) => t.matches[id].status === "finished")
    ) {
      parent.players = parent.feeders.map((id) => t.matches[id].winner!);
      if (seeded(t.seed + parent.id)() < 0.5) parent.players.reverse();
      parent.status = "countdown";
      parent.startAt = now + (t.settings || DEFAULT_SETTINGS).countdownMs;
    }
  }
  t.version++;
}
export function advanceTime(t: Tournament, now: number) {
  if (t.status === "lobby" && now >= t.closesAt) startTournament(t, now);
  if (t.status !== "active") return;
  for (const m of t.matches) {
    if (m.status === "countdown" && now >= m.startAt) {
      m.status = "playing";
      m.turnAt = now;
      m.deadline = now + (t.settings || DEFAULT_SETTINGS).matchMs;
      m.botAt = now + (t.settings || DEFAULT_SETTINGS).botDelayMs;
      m.version++;
      t.version++;
    }
    if (m.status !== "playing") continue;
    const forfeits = m.players.map(
      (id) => t.entrants.find((e) => e.id === id)?.disqualified,
    );
    if (forfeits.some(Boolean)) {
      finishMatch(
        t,
        m,
        m.players[forfeits.every(Boolean) ? tieWinner(m) : forfeits[0] ? 1 : 0],
        "resigned",
        now,
      );
      continue;
    }
    const seat = m.state.turn === 1 ? 0 : 1;
    const expiry = m.turnAt + m.clocks[seat];
    if (now >= Math.min(expiry, m.deadline)) {
      const clockLoss = expiry < m.deadline;
      const winnerSeat = clockLoss ? 1 - seat : tieWinner(m);
      const losing = t.entrants.find((e) => e.id === m.players[seat])!;
      if (clockLoss && !losing.moved) losing.disqualified = true;
      finishMatch(
        t,
        m,
        m.players[winnerSeat],
        clockLoss ? "clock" : "board score",
        now,
      );
    }
  }
}
export function submitMove(
  t: Tournament,
  matchId: number,
  player: string,
  seq: number,
  action: number,
  now: number,
) {
  const m = t.matches[matchId];
  if (!m || m.status !== "playing" || t.status !== "active")
    throw new Error("Match is not active");
  if (m.state.moves.length !== seq)
    throw new Error("Board changed. Please retry.");
  const seat = m.state.turn === 1 ? 0 : 1;
  if (m.players[seat] !== player) throw new Error("Wait for your turn");
  if (now >= Math.min(m.deadline, m.turnAt + m.clocks[seat]))
    throw new Error("Clock expired");
  const next = play(m.state, action);
  const entrant = t.entrants.find((e) => e.id === player)!;
  entrant.moved = true;
  entrant.boards +=
    next.boards.filter((b) => b === m.state.turn).length -
    m.state.boards.filter((b) => b === m.state.turn).length;
  m.clocks[seat] -= Math.max(0, now - m.turnAt);
  m.state = next;
  m.clocks[next.turn === 1 ? 0 : 1] = (t.settings || DEFAULT_SETTINGS).clockMs;
  m.turnAt = now;
  m.botAt = now + (t.settings || DEFAULT_SETTINGS).botDelayMs;
  m.version++;
  t.version++;
  if (next.winner)
    finishMatch(
      t,
      m,
      m.players[next.winner === 2 ? tieWinner(m) : next.winner === 1 ? 0 : 1],
      next.winner === 2 ? "board score" : "board victory",
      now,
    );
}
export function playerView(t: Tournament, player: string) {
  const entrant = t.entrants.find((e) => e.id === player);
  if (!entrant)
    return {
      phase: "spectating" as const,
      matchId: t.matches.find((m) => m.status === "playing")?.id,
    };
  if (t.status === "lobby") return { phase: "lobby" as const };
  if (entrant.finish !== undefined) return { phase: "results" as const };
  const active = t.matches.find(
    (m) =>
      m.players.includes(player) &&
      (m.status === "playing" || m.status === "countdown"),
  );
  if (active) return { phase: active.status, matchId: active.id };
  const won = [...t.matches].reverse().find((m) => m.winner === player);
  const parent = won && t.matches.find((m) => m.feeders.includes(won.id));
  const sibling = parent?.feeders.find((id) => id !== won?.id);
  return {
    phase: "spectating" as const,
    matchId: sibling,
    nextRound: parent?.round,
  };
}
export function publicTournament(t: Tournament) {
  const { seed: _seed, ...rest } = t;
  return {
    ...rest,
    entrants: t.entrants.map(({ skill: _skill, ...entrant }) => entrant),
    matches: t.matches.map(({ tieSecret: _secret, ...match }) => match),
  };
}
export type PublicTournament = ReturnType<typeof publicTournament>;
export function placementReward(e: Entrant, settings = DEFAULT_SETTINGS) {
  if (e.finish === undefined) return null;
  const eligible = e.moved && !e.disqualified;
  const raw = settings.rankDeltas[e.finish];
  const delta =
    raw < 0 && tierIndex(e.points) === 0 ? 0 : raw > 0 && !eligible ? 0 : raw;
  return {
    delta,
    xp: eligible
      ? settings.baseXp +
        e.wins * settings.winXp +
        (e.finish === 4 ? settings.crownXp : 0)
      : 0,
    wins: e.wins,
    boards: e.boards,
    completed: eligible && !e.disqualified,
    crown: e.finish === 4 && eligible,
  };
}
export function nextWake(t: Tournament, now: number) {
  if (t.status === "lobby") return t.closesAt;
  const times = t.matches.flatMap((m) => {
    if (m.status === "countdown") return [m.startAt];
    if (m.status !== "playing") return [];
    const seat = m.state.turn === 1 ? 0 : 1;
    return [
      m.deadline,
      m.turnAt + m.clocks[seat],
      ...(t.entrants.find((e) => e.id === m.players[seat])?.cpu
        ? [m.botAt]
        : []),
    ];
  });
  return times.length ? Math.max(now + 20, Math.min(...times)) : null;
}
export function resign(t: Tournament, player: string, now: number) {
  const e = t.entrants.find((e) => e.id === player);
  if (!e || e.finish !== undefined) return;
  e.disqualified = true;
  const view = playerView(t, player);
  // A winner waiting on its feeder still occupies a future bracket slot.
  if (view.phase === "spectating") return;
  const m = view.matchId === undefined ? undefined : t.matches[view.matchId];
  if (m)
    finishMatch(
      t,
      m,
      m.players.find((id) => id !== player)!,
      "resigned",
      now,
    );
}

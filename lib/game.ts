export type Player = 1 | -1;
export type State = {
  cells: number[];
  boards: number[];
  turn: Player;
  forced: number;
  winner: number;
  moves: number[];
};
export const lines = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];
export const initial = (): State => ({
  cells: Array(81).fill(0),
  boards: Array(9).fill(0),
  turn: 1,
  forced: -1,
  winner: 0,
  moves: [],
});
export function result(c: number[]): number {
  for (const [a, b, d] of lines)
    if (Math.abs(c[a]) === 1 && c[a] === c[b] && c[b] === c[d]) return c[a];
  return c.every((x) => x !== 0) ? 2 : 0;
}
export function legal(s: State): number[] {
  return s.winner
    ? []
    : s.cells.flatMap((v, a) =>
        !v &&
        !s.boards[Math.floor(a / 9)] &&
        (s.forced < 0 || Math.floor(a / 9) === s.forced)
          ? [a]
          : [],
      );
}
export function play(s: State, a: number): State {
  if (!Number.isInteger(a) || !legal(s).includes(a))
    throw new Error("Illegal move");
  const cells = [...s.cells],
    boards = [...s.boards];
  cells[a] = s.turn;
  const b = Math.floor(a / 9);
  boards[b] = result(cells.slice(b * 9, b * 9 + 9));
  return {
    cells,
    boards,
    turn: s.turn === 1 ? -1 : 1,
    forced: boards[a % 9] ? -1 : a % 9,
    winner: result(boards),
    moves: [...s.moves, a],
  };
}
export function replay(moves: number[]): State {
  if (!Array.isArray(moves) || moves.length > 81)
    throw new Error("Invalid history");
  return moves.reduce(play, initial());
}
export function features(s: State): number[] {
  return [
    ...s.cells.map((x) => (x === s.turn ? 1 : 0)),
    ...s.cells.map((x) => (x === -s.turn ? 1 : 0)),
    ...Array.from({ length: 9 }, (_, b) =>
      s.forced === -1 || s.forced === b ? 1 : 0,
    ),
  ];
}
// Shared, player-relative tactical features. The learner sets their priorities.
export function actionFeatures(s: State, a: number): number[] {
  const b = Math.floor(a / 9),
    c = a % 9,
    p = s.turn;
  const board = s.cells.slice(b * 9, b * 9 + 9);
  const blocking = lines.filter(
    (l) => l.includes(c) && l.filter((i) => board[i] === -p).length === 2,
  ).length;
  const potential =
    lines.filter(
      (l) =>
        l.includes(c) &&
        !l.some((i) => board[i] === -p) &&
        l.some((i) => board[i] === p),
    ).length / 4;
  board[c] = p;
  const won = result(board) === p,
    macro = [...s.boards];
  macro[b] = result(board);
  const threat = (v: number[], index: number, player: number) =>
    lines.some(
      (l) =>
        l.includes(index) &&
        l.filter((i) => v[i] === player).length === 2 &&
        l.filter((i) => v[i] === 0).length === 1,
    );
  const closed = macro[c] !== 0;
  const target = b === c ? board : s.cells.slice(c * 9, c * 9 + 9);
  const danger =
    !closed &&
    lines.some(
      (l) =>
        l.filter((i) => target[i] === -p).length === 2 &&
        l.filter((i) => target[i] === 0).length === 1,
    );
  const macroPotential =
    lines.filter(
      (l) =>
        l.includes(b) &&
        !l.some((i) => s.boards[i] === -p || s.boards[i] === 2) &&
        l.some((i) => s.boards[i] === p),
    ).length / 4;
  return [
    +won,
    +(blocking > 0),
    +(result(macro) === p),
    +(won && threat(s.boards, b, -p)),
    +danger,
    +(danger && threat(macro, c, -p)),
    +closed,
    +(c === 4),
    +(won && b === 4),
    potential,
    +won * macroPotential,
    blocking / 2,
  ];
}

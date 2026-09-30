"use client";
import { legal, type State } from "../../lib/game";

export default function Board({
  state,
  enabled = false,
  onMove,
  label = "Game board",
}: {
  state: State;
  enabled?: boolean;
  onMove?: (action: number) => void;
  label?: string;
}) {
  const allowed = new Set(legal(state));
  return (
    <div className="board" role="group" aria-label={label}>
      {state.boards.map((won, b) => (
        <div
          key={b}
          className={`small ${won ? "closed" : ""} ${!won && (state.forced === -1 || state.forced === b) ? "eligible" : ""}`}
        >
          {Array.from({ length: 9 }, (_, c) => {
            const a = b * 9 + c,
              v = state.cells[a];
            return (
              <button
                key={a}
                aria-label={`Board ${b + 1}, square ${c + 1}${v ? `, ${v === 1 ? "X" : "O"}` : ""}`}
                className={`${v === -1 ? "o" : ""} ${state.moves.at(-1) === a ? "last-move" : ""}`}
                disabled={!enabled || !allowed.has(a)}
                onClick={() => onMove?.(a)}
              >
                {v === 1 ? "✕" : v === -1 ? "◯" : ""}
              </button>
            );
          })}
          {won !== 0 ? (
            <div
              className={`won ${won === -1 ? "o" : ""}`}
              aria-label={
                won === 2 ? "Wildcard: counts for X and O" : undefined
              }
            >
              {won === 2 ? "★" : won === 1 ? "✕" : "◯"}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

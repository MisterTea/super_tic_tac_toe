"use client";
import { useLayoutEffect, useRef, useState } from "react";
import type { State } from "../../lib/game";

// Measure the actual cells so the trail follows the board at every screen size.
export default function BoardEffects({
  state,
  preview,
  result,
}: {
  state: State;
  preview?: number | null;
  result?: string;
}) {
  const lastMove = state.moves.at(-1);
  return (
    <div className="board-effects">
      {!state.winner && !result ? (
        <>
          {lastMove !== undefined ? (
            <RoutingTrail
              key={state.moves.join(",")}
              state={state}
              action={lastMove}
              obscured={preview != null}
            />
          ) : null}
          {preview != null ? (
            <RoutingTrail state={state} action={preview} preview />
          ) : null}
        </>
      ) : null}
      {result ? (
        <div
          key={result}
          className={`board-result ${result === "Defeat" ? "defeat" : ""}`}
          aria-live="polite"
          aria-atomic="true"
        >
          <span>{result}</span>
        </div>
      ) : null}
    </div>
  );
}

// Preview changes never remount a played move's trail. Server snapshots and
// turn labels keep the same move key, so they cannot restart its animation.
function RoutingTrail({
  state,
  action,
  preview = false,
  obscured = false,
}: {
  state: State;
  action: number;
  preview?: boolean;
  obscured?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<{
    width: number;
    height: number;
    x: number;
    y: number;
    targets: { x: number; y: number; width: number; height: number }[];
  } | null>(null);
  const target = action % 9;
  const free = !!state.boards[target];
  useLayoutEffect(() => {
    const board = ref.current?.closest(".board");
    if (!board) return;
    const measure = () => {
      const bounds = board.getBoundingClientRect();
      const small = board.querySelectorAll<HTMLElement>(".small");
      const cell =
        small[Math.floor(action / 9)]?.querySelectorAll("button")[action % 9];
      if (!cell) return;
      const source = cell.getBoundingClientRect();
      const targets = Array.from(small).flatMap((element, index) => {
        if (free ? !!state.boards[index] : index !== target) return [];
        const r = element.getBoundingClientRect();
        return [
          {
            x: r.left - bounds.left,
            y: r.top - bounds.top,
            width: r.width,
            height: r.height,
          },
        ];
      });
      setGeometry({
        width: bounds.width,
        height: bounds.height,
        x: source.left - bounds.left + source.width / 2,
        y: source.top - bounds.top + source.height / 2,
        targets,
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(board);
    measure();
    return () => observer.disconnect();
  }, [action, state.boards, target, free]);
  return (
    <div
      ref={ref}
      className={`move-routing ${preview ? "preview" : ""} ${obscured ? "routing-obscured" : ""}`}
      aria-hidden="true"
    >
      {geometry ? (
        <>
          <svg viewBox={`0 0 ${geometry.width} ${geometry.height}`}>
            {geometry.targets.map((r, i) => (
              <g key={i}>
                <path
                  d={`M ${geometry.x} ${geometry.y} L ${r.x + r.width / 2} ${r.y + r.height / 2}`}
                  pathLength="1"
                />
                <rect
                  x={r.x + 2}
                  y={r.y + 2}
                  width={r.width - 4}
                  height={r.height - 4}
                  rx="6"
                />
              </g>
            ))}
          </svg>
          <span className="routing-caption">
            {free
              ? `Board ${target + 1} is closed · free choice`
              : `Square ${target + 1} → board ${target + 1}`}
          </span>
        </>
      ) : null}
    </div>
  );
}

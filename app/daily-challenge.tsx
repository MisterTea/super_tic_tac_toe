"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import Board from "./royale/board";
import ShareLink from "./share-link";
export default function DailyChallenge() {
  const data = useQuery(api.daily.today, {}),
    attempt = useMutation(api.daily.attempt);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      if (data && new Date(current).toISOString().slice(0, 10) !== data.day)
        location.reload();
      setNow(current);
    }, 60_000);
    return () => clearInterval(timer);
  }, [data?.day]);
  async function choose(action: number) {
    if (!data || pending) return;
    setPending(true);
    setError("");
    try {
      await attempt({ day: data.day, action });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Please try again.");
    } finally {
      setPending(false);
    }
  }
  if (!data) return <p role="status">Loading today's position…</p>;
  const squares = "🟩".repeat(data.solved ? 1 : 0);
  const score = `${"⬛".repeat(data.attempts.length - (data.solved ? 1 : 0))}${squares}`;
  return (
    <div className="royale-workspace daily-workspace">
      <section className="royale-card">
        <div className="eyebrow">DAILY CHALLENGE · {data.day} UTC</div>
        <h1 className="compact-heading">One move. Find the win.</h1>
        <p>
          Everyone gets the same position. You are{" "}
          {data.state.turn === 1 ? "X" : "O"}. Pick the move that wins the whole
          board, with three chances.
        </p>
        <Board
          state={data.state}
          enabled={!data.done && !pending}
          onMove={(action) => void choose(action)}
          label="Daily challenge board"
        />
      </section>
      <section className="royale-card">
        <h2>
          {data.solved
            ? "You found it!"
            : data.done
              ? "Come back for the next one."
              : "Can you spot it?"}
        </h2>
        <p role="status">
          {pending
            ? "Checking your move…"
            : `${data.attempts.length}/3 chances used${data.attempts.length && !data.done ? " · Not quite. Try another square." : ""}`}
        </p>
        {data.done && data.solution !== undefined ? (
          <p>
            Winning move: board {Math.floor(data.solution / 9) + 1}, square{" "}
            {(data.solution % 9) + 1}.
          </p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
        <p>
          New challenge at midnight UTC · about{" "}
          {Math.ceil(
            (Date.parse(data.day + "T00:00:00Z") + 86400_000 - now) / 3600_000,
          )}{" "}
          hours to go.
        </p>
        {data.done ? (
          <ShareLink
            url={`${location.origin}/daily?utm_source=daily&utm_campaign=${data.day}`}
            text={`Tic Tac Toe Royale daily ${data.day}\n${score}\n${data.solved ? `${data.attempts.length}/3` : "X/3"} — can you find the win?`}
          />
        ) : null}
        <a className="secondary" href="/">
          Back to Royale →
        </a>
        <details className="royale-rules">
          <summary>How the board works</summary>
          <p>
            Win three small boards in a row to win the big board. The
            highlighted boards show where you can play. Stars count for either
            player.
          </p>
          <p>
            Your attempts are saved to this player profile. Daily challenges
            don't award crowns or rank points.
          </p>
        </details>
      </section>
    </div>
  );
}

"use client";
import { useEffect, useState } from "react";
import { ConvexHttpClient, api } from "../lib/neon-client";

type Stats = { players: number; games: number; crowns: number };
const client = new ConvexHttpClient();

export default function StatHeader() {
  const [stats, setStats] = useState<Stats>();
  const [selection, setSelection] = useState(0);
  useEffect(() => {
    setSelection(Math.floor(Math.random() * 3));
    let live = true;
    const refresh = () =>
      client
        .query(api.telemetry.publicStats, {})
        .then((data) => {
          if (live) setStats(data);
        })
        .catch(() => {
          /* Keep the last successful total during a reconnect. */
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const text = stats
    ? [
        `${stats.games.toLocaleString("en-US")} games played`,
        `${stats.crowns.toLocaleString("en-US")} crowns given`,
        `${stats.players.toLocaleString("en-US")} total players`,
      ][selection]
    : "Royale stats";
  return (
    <a
      className="brand"
      href="/"
      aria-label={`Super Tic Tac Toe Royale home — ${text}`}
      title="Lifetime Royale totals"
    >
      <span>Super Tic Tac Toe Royale</span>
      <span className="brand-stats">◎ {text}</span>
    </a>
  );
}

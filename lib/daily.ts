import puzzles from "./daily-puzzles.json";
import { replay } from "./game";
export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);
export function dailyPosition(day: string) {
  const index =
    Math.floor(Date.parse(day + "T00:00:00Z") / 86400_000) % puzzles.length;
  return replay(puzzles[index]);
}

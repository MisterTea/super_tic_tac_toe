import { query, withTransaction } from "../db";
import { getProfileByAuthId, ApiError } from "./royale";
import { dailyPosition, utcDay } from "../daily";
import { legal, play } from "../game";
import { activity, recordEvent } from "./telemetry";

export async function today(authId: string) {
  const p = await getProfileByAuthId(authId);
  const currentDay = utcDay(Date.now());
  const res = await query(
    "SELECT * FROM daily_attempts WHERE profile = $1 AND day = $2",
    [p.id, currentDay],
  );
  const run = res.rows[0];
  const state = dailyPosition(currentDay);
  const attempts: number[] = run?.attempts ?? [];
  const done = !!run?.solved || attempts.length >= 3;
  return {
    day: currentDay,
    state,
    attempts,
    solved: !!run?.solved,
    done,
    solution: done
      ? legal(state).find((a) => play(state, a).winner === state.turn)
      : undefined,
  };
}

export async function attempt(authId: string, targetDay: string, action: number) {
  return withTransaction(async (client) => {
    const p = await getProfileByAuthId(authId, client);
    const currentDay = utcDay(Date.now());
    if (targetDay !== currentDay) {
      throw new ApiError("A new daily challenge is here. Refresh and try it.");
    }
    const res = await client.query(
      "SELECT * FROM daily_attempts WHERE profile = $1 AND day = $2 FOR UPDATE",
      [p.id, currentDay],
    );
    const run = res.rows[0];
    const attempts: number[] = run?.attempts ?? [];
    if (run?.solved || attempts.length >= 3) return;
    if (attempts.includes(action)) {
      throw new ApiError("You've already tried that square. Pick another.");
    }
    const state = dailyPosition(currentDay);
    if (!legal(state).includes(action)) {
      throw new ApiError("Pick a highlighted empty square.");
    }
    const solved = play(state, action).winner === state.turn;
    const newAttempts = [...attempts, action];
    const now = Date.now();

    if (run) {
      await client.query(
        "UPDATE daily_attempts SET attempts = $1, solved = $2 WHERE id = $3",
        [JSON.stringify(newAttempts), solved, run.id],
      );
    } else {
      const id = crypto.randomUUID();
      await client.query(
        "INSERT INTO daily_attempts (id, profile, day, attempts, solved) VALUES ($1, $2, $3, $4, $5)",
        [id, p.id, currentDay, JSON.stringify(newAttempts), solved],
      );
      await recordEvent(client, { kind: "daily_challenge_start", at: now });
    }

    if (solved) {
      await recordEvent(client, { kind: "daily_challenge_solved", at: now });
    }
    await activity(client, p, now);
  });
}

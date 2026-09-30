import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { profile } from "./royale";
import { dailyPosition, utcDay } from "../lib/daily";
import { legal, play } from "../lib/game";
import { activity, recordEvent } from "./telemetry";
export const today = query({
  args: {},
  handler: async (ctx) => {
    const p = await profile(ctx),
      day = utcDay(Date.now());
    const run = await ctx.db
      .query("dailyAttempts")
      .withIndex("by_profile_day", (q) => q.eq("profile", p._id).eq("day", day))
      .unique();
    const state = dailyPosition(day);
    const done = !!run?.solved || (run?.attempts.length ?? 0) >= 3;
    return {
      day,
      state,
      attempts: run?.attempts ?? [],
      solved: !!run?.solved,
      done,
      solution: done
        ? legal(state).find((a) => play(state, a).winner === state.turn)
        : undefined,
    };
  },
});
export const attempt = mutation({
  args: { day: v.string(), action: v.number() },
  handler: async (ctx, args) => {
    const p = await profile(ctx),
      day = utcDay(Date.now());
    if (args.day !== day)
      throw new ConvexError(
        "A new daily challenge is here. Refresh and try it.",
      );
    const run = await ctx.db
      .query("dailyAttempts")
      .withIndex("by_profile_day", (q) => q.eq("profile", p._id).eq("day", day))
      .unique();
    if (run?.solved || (run?.attempts.length ?? 0) >= 3) return;
    if (run?.attempts.includes(args.action))
      throw new ConvexError("You've already tried that square. Pick another.");
    const state = dailyPosition(day);
    if (!legal(state).includes(args.action))
      throw new ConvexError("Pick a highlighted empty square.");
    const solved = play(state, args.action).winner === state.turn;
    const attempts = [...(run?.attempts ?? []), args.action];
    if (run) await ctx.db.patch(run._id, { attempts, solved });
    else {
      await ctx.db.insert("dailyAttempts", {
        profile: p._id,
        day,
        attempts,
        solved,
      });
      await recordEvent(ctx, { kind: "daily_challenge_start", at: Date.now() });
    }
    if (solved)
      await recordEvent(ctx, {
        kind: "daily_challenge_solved",
        at: Date.now(),
      });
    await activity(ctx, p, Date.now());
  },
});

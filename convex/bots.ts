"use node";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { advanceTime, seeded, type Tournament } from "../lib/royale";
import { skillMove, type SkillModel } from "../lib/skill";
import model from "../public/skill-policy.json";

export const drive = internalAction({
  args: { tournament: v.id("tournaments"), version: v.number() },
  handler: async (ctx, args) => {
    const row = await ctx.runQuery(internal.royale.snapshot, {
      tournament: args.tournament,
    });
    if (!row || row.state.version !== args.version) return;
    const t = row.state as Tournament,
      now = Date.now();
    advanceTime(t, now);
    const moves: { match: number; seq: number; action: number }[] = [];
    for (const m of t.matches) {
      if (m.status !== "playing" || m.botAt > now) continue;
      const entrant = t.entrants.find(
        (e) => e.id === m.players[m.state.turn === 1 ? 0 : 1],
      );
      if (entrant?.cpu)
        moves.push({
          match: m.id,
          seq: m.state.moves.length,
          action: skillMove(
            m.state,
            entrant.skill,
            model as SkillModel,
            seeded(t.seed + m.id * 1000 + m.version),
          ),
        });
    }
    await ctx.runMutation(internal.royale.tick, { ...args, moves });
  },
});

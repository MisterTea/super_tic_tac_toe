import { ConvexError, v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { components } from "./_generated/api";
import { authComponent } from "./auth";
import { levelFor, tierIndex, tiers } from "../lib/royale";

export const top = query({
  args: {},
  handler: async (ctx) => {
    const players = await ctx.db
      .query("profiles")
      .withIndex("by_leaderboard", (q) => q.eq("leaderboardEligible", true))
      .order("desc")
      .take(10);
    return players.map((p, index) => ({
      rank: index + 1,
      name: p.name,
      points: p.points,
      crowns: p.crowns,
      tier: tiers[tierIndex(p.points)],
      level: levelFor(p.xp),
    }));
  },
});
export const setOptOut = mutation({
  args: { optOut: v.boolean() },
  handler: async (ctx, { optOut }) => {
    const user = await authComponent.getAuthUser(ctx);
    if (user.isAnonymous)
      throw new ConvexError("Log in to change leaderboard settings.");
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_auth", (q) => q.eq("authId", user._id))
      .unique();
    if (!p) throw new ConvexError("Create a player profile first.");
    await ctx.db.patch(p._id, {
      leaderboardOptOut: optOut,
      leaderboardEligible: !optOut,
    });
  },
});
export const migrate = internalMutation({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db.query("profiles").collect();
    let eligible = 0;
    for (const p of profiles) {
      const user = p.authId.startsWith("linked:")
        ? null
        : await ctx.runQuery(components.betterAuth.adapter.findOne, {
            model: "user",
            where: [{ field: "_id", value: p.authId }],
          });
      const visible = !!user && !user.isAnonymous && !p.leaderboardOptOut;
      await ctx.db.patch(p._id, {
        leaderboardOptOut: p.leaderboardOptOut ?? false,
        leaderboardEligible: visible,
      });
      if (visible) eligible++;
    }
    return { profiles: profiles.length, eligible };
  },
});

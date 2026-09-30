import { ConvexError, v } from "convex/values";
import { mutation, query, internalQuery } from "./_generated/server";
import { newLobby, startTournament, type Tournament } from "../lib/royale";
import { profile, save } from "./royale";
import { activity, observeTournament, recordEvent } from "./telemetry";
export const report = internalQuery({
  args: { day: v.optional(v.string()) },
  handler: async (ctx, { day }) => {
    const rows = await ctx.db
      .query("campaignMetrics")
      .withIndex("by_bucket", (q) => q.eq("bucket", day || "all"))
      .take(1001);
    return {
      bucket: day || "all",
      truncated: rows.length > 1000,
      campaigns: rows
        .slice(0, 1000)
        .map((r) => ({ source: r.source, campaign: r.campaign, ...r.values }))
        .sort(
          (a, b) => (b.firstMatchesStarted || 0) - (a.firstMatchesStarted || 0),
        ),
    };
  },
});

export const attribute = mutation({
  args: { source: v.string(), campaign: v.string() },
  handler: async (ctx, args) => {
    const p = await profile(ctx);
    if (p.acquisition) return;
    const clean = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, "")
        .slice(0, 48);
    const source = clean(args.source) || "direct",
      campaign = clean(args.campaign) || "none";
    await ctx.db.patch(p._id, {
      acquisition: { source, campaign, at: Date.now() },
    });
    await recordEvent(ctx, {
      kind: `source_visit:${source}:${campaign}`,
      at: Date.now(),
    });
  },
});
export const host = mutation({
  args: {},
  handler: async (ctx) => {
    const p = await profile(ctx);
    if (p.active)
      throw new ConvexError(
        "Leave your current lobby or finish your Royale first.",
      );
    let roomCode: string;
    const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
    do {
      roomCode = Array.from(
        { length: 10 },
        () => alphabet[Math.floor(Math.random() * alphabet.length)],
      ).join("");
    } while (
      await ctx.db
        .query("tournaments")
        .withIndex("by_room", (q) => q.eq("roomCode", roomCode))
        .unique()
    );
    const now = Date.now(),
      state = newLobby(0, now, Math.floor(Math.random() * 2 ** 32));
    state.closesAt = now + 120_000;
    state.settings!.rankDeltas = [0, 0, 0, 0, 0];
    state.entrants.push({
      id: p._id,
      name: p.name,
      avatar: "●",
      cpu: false,
      skill: 0,
      points: p.points,
      moved: false,
      wins: 0,
      boards: 0,
    });
    const id = await ctx.db.insert("tournaments", {
      tier: 0,
      status: "lobby",
      state,
      updatedAt: now,
      roomCode,
      host: p._id,
    });
    await ctx.db.patch(p._id, { active: id, last: id });
    await activity(ctx, p, now);
    await observeTournament(ctx, id, state);
    await recordEvent(ctx, {
      kind: "friend_lobby_created",
      tournament: id,
      at: now,
    });
    await recordEvent(ctx, { kind: "join", tournament: id, at: now });
    if (p.acquisition)
      await recordEvent(ctx, {
        kind: `source_join:${p.acquisition.source}:${p.acquisition.campaign}`,
        tournament: id,
        at: now,
      });
    await save(ctx, id, state, now);
    return roomCode;
  },
});
export const room = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    if (!/^[a-z2-9]{10}$/.test(code)) return null;
    const row = await ctx.db
      .query("tournaments")
      .withIndex("by_room", (q) => q.eq("roomCode", code))
      .unique();
    if (!row) return null;
    return {
      open: row.status === "lobby" && row.state.closesAt > Date.now(),
      count: row.state.entrants.length,
    };
  },
});
export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const p = await profile(ctx),
      row = p.active ? await ctx.db.get(p.active) : null;
    if (!row || !row.roomCode || row.host !== p._id)
      throw new ConvexError("Only the lobby host can start this Royale.");
    if (row.status !== "lobby") return;
    const state = row.state as Tournament;
    startTournament(state, Date.now());
    await save(ctx, row._id, state, Date.now());
  },
});
export const shareResult = mutation({
  args: { tournament: v.id("tournaments") },
  handler: async (ctx, { tournament }) => {
    const p = await profile(ctx);
    const reward = await ctx.db
      .query("rewards")
      .withIndex("by_profile_tournament", (q) =>
        q.eq("profile", p._id).eq("tournament", tournament),
      )
      .unique();
    if (!reward) throw new ConvexError("Your result isn't ready to share yet.");
    const previous = await ctx.db
      .query("sharedResults")
      .withIndex("by_reward", (q) => q.eq("reward", reward._id))
      .unique();
    if (previous) return previous._id;
    const state = (await ctx.db.get(tournament))?.state as Tournament;
    const entrantId = reward.entrant ?? p._id;
    const entrant = state.entrants.find((e) => e.id === entrantId);
    if (!entrant)
      throw new ConvexError(
        "This older result cannot be shared. Play a new Royale to make a card.",
      );
    const id = await ctx.db.insert("sharedResults", {
      reward: reward._id,
      name: entrant.name,
      finish: reward.finish,
      wins: entrant.wins,
      crown: !!reward.crown,
      delta: reward.delta,
      rounds: state.matches
        .filter((m) => m.players.includes(entrantId) && m.status === "finished")
        .map((m) => ({ round: m.round, won: m.winner === entrantId })),
    });
    await recordEvent(ctx, {
      kind: "result_share",
      at: Date.now(),
      tournament,
    });
    return id;
  },
});
export const sharedResult = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const id = ctx.db.normalizeId("sharedResults", token);
    const row = id ? await ctx.db.get(id) : null;
    return row
      ? {
          name: row.name,
          finish: row.finish,
          wins: row.wins,
          crown: row.crown,
          delta: row.delta,
          rounds: row.rounds,
        }
      : null;
  },
});

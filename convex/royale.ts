import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  internalMutation,
  internalQuery,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import { authComponent } from "./auth";
import { claimName, generatedName } from "./names";
import { displayName } from "../lib/player-names";
import {
  activity,
  mergeActivity,
  observeProfile,
  observeReward,
  observeTournament,
  recordEvent,
} from "./telemetry";
import {
  advanceTime,
  DEFAULT_SETTINGS,
  cosmetics,
  levelFor,
  newLobby,
  nextWake,
  placementReward,
  playerView,
  publicTournament,
  resign as resignPlayer,
  startTournament,
  submitMove,
  tierIndex,
  type Tournament,
} from "../lib/royale";

async function profile(ctx: QueryCtx | MutationCtx) {
  const user = await authComponent.getAuthUser(ctx);
  const p = await ctx.db
    .query("profiles")
    .withIndex("by_auth", (q) => q.eq("authId", user._id))
    .unique();
  if (!p) throw new Error("Create a player profile first");
  return p;
}
const day = (now: number) => new Date(now).toISOString().slice(0, 10);
async function settle(
  ctx: MutationCtx,
  id: Id<"tournaments">,
  t: Tournament,
  now: number,
) {
  for (const e of t.entrants) {
    if (e.cpu || e.finish === undefined) continue;
    const profileId = e.id as Id<"profiles">;
    const prior = await ctx.db
      .query("rewards")
      .withIndex("by_profile_tournament", (q) =>
        q.eq("profile", profileId).eq("tournament", id),
      )
      .unique();
    if (prior) continue;
    const p = await ctx.db.get(profileId);
    if (!p) continue;
    const reward = placementReward(e, t.settings || DEFAULT_SETTINGS)!;
    const existing = await ctx.db
      .query("quests")
      .withIndex("by_profile_day", (q) =>
        q.eq("profile", p._id).eq("day", day(now)),
      )
      .unique();
    const quest = {
      completed: (existing?.completed || 0) + (reward.completed ? 1 : 0),
      boards: (existing?.boards || 0) + (reward.completed ? reward.boards : 0),
      wins: (existing?.wins || 0) + (reward.completed ? reward.wins : 0),
      claimed: [...(existing?.claimed || [])],
    };
    let bonus = 0;
    for (const [key, value, goal] of [
      ["completed", quest.completed, 2],
      ["boards", quest.boards, 5],
      ["wins", quest.wins, 1],
    ] as const) {
      if (value >= goal && !quest.claimed.includes(key)) {
        quest.claimed.push(key);
        bonus += (t.settings || DEFAULT_SETTINGS).questXp;
      }
    }
    if (existing) await ctx.db.patch(existing._id, quest);
    else
      await ctx.db.insert("quests", {
        profile: p._id,
        day: day(now),
        ...quest,
      });
    const xp = p.xp + reward.xp + bonus;
    const unlocked = cosmetics
      .filter((c) => c.level <= levelFor(xp))
      .map((c) => c.id);
    await ctx.db.patch(p._id, {
      points: Math.max(0, p.points + reward.delta),
      xp,
      crowns: p.crowns + (reward.crown ? 1 : 0),
      cosmetics: [...new Set([...p.cosmetics, ...unlocked])],
      ...(p.active === id ? { active: undefined } : {}),
    });
    const rewardId = await ctx.db.insert("rewards", {
      profile: p._id,
      tournament: id,
      finish: e.finish,
      delta: reward.delta,
      xp: reward.xp + bonus,
      createdAt: now,
      crown: reward.crown,
    });
    await observeReward(ctx, (await ctx.db.get(rewardId))!);
    await recordEvent(ctx, {
      kind: "result",
      tournament: id,
      at: now,
      value: e.finish,
    });
  }
}
async function save(
  ctx: MutationCtx,
  id: Id<"tournaments">,
  t: Tournament,
  now: number,
) {
  const previous = (await ctx.db.get(id))?.state as Tournament | undefined;
  if (previous?.status === "lobby" && t.status === "active") {
    for (const entrant of t.entrants) {
      if (!entrant.cpu) continue;
      const owner = `cpu:${id}:${entrant.id}`;
      if (!(await claimName(ctx, entrant.name, owner)))
        entrant.name = await generatedName(ctx, owner);
    }
  }
  if (previous?.status === "lobby" && t.status === "active") {
    await recordEvent(ctx, {
      kind: "queue_ms",
      tournament: id,
      at: now,
      value: now - t.createdAt,
    });
    await recordEvent(ctx, {
      kind: "cpu_count",
      tournament: id,
      at: now,
      value: t.entrants.filter((e) => e.cpu).length,
    });
  }
  if (previous?.status !== "finished" && t.status === "finished") {
    await recordEvent(ctx, {
      kind: "tournament_complete",
      tournament: id,
      at: now,
      value: now - t.createdAt,
    });
  }
  for (const m of t.matches)
    if (
      m.feeders.length &&
      m.status === "countdown" &&
      previous?.matches[m.id]?.status === "pending"
    ) {
      for (const feeder of m.feeders) {
        await recordEvent(ctx, {
          kind: "spectator_wait_ms",
          tournament: id,
          at: now,
          value: Math.max(0, now - (t.matches[feeder].finishedAt || now)),
        });
      }
    }
  await settle(ctx, id, t, now);
  await observeTournament(ctx, id, t, previous);
  await ctx.db.patch(id, { status: t.status, state: t, updatedAt: now });
  const wake = nextWake(t, now);
  if (wake !== null)
    await ctx.scheduler.runAt(wake, internal.bots.drive, {
      tournament: id,
      version: t.version,
    });
}
export const ensureProfile = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await authComponent.getAuthUser(ctx);
    const prior = await ctx.db
      .query("profiles")
      .withIndex("by_auth", (q) => q.eq("authId", user._id))
      .unique();
    if (prior) {
      const eligible = !user.isAnonymous && !prior.leaderboardOptOut;
      if (prior.leaderboardEligible !== eligible)
        await ctx.db.patch(prior._id, { leaderboardEligible: eligible });
      await activity(ctx, prior, Date.now());
      if (prior.lastVisitDay !== day(Date.now())) {
        await ctx.db.patch(prior._id, { lastVisitDay: day(Date.now()) });
        await recordEvent(ctx, { kind: "daily_return", at: Date.now() });
      }
      return prior._id;
    }
    const id = await ctx.db.insert("profiles", {
      authId: user._id,
      name: "",
      leaderboardOptOut: false,
      leaderboardEligible: !user.isAnonymous,
      points: 0,
      xp: 0,
      crowns: 0,
      cosmetics: [],
      equipped: { theme: "default", title: "default", effect: "default" },
      joinedAt: Date.now(),
      lastVisitDay: day(Date.now()),
    });
    await ctx.db.patch(id, { name: await generatedName(ctx, id) });
    const created = (await ctx.db.get(id))!;
    await observeProfile(ctx, created);
    await activity(ctx, created, Date.now());
    return id;
  },
});
export const rename = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const user = await authComponent.getAuthUser(ctx);
    if (user.isAnonymous)
      throw new ConvexError("Log in to change your player name.");
    const p = await profile(ctx);
    if (p.active)
      throw new ConvexError(
        "Finish your tournament before changing your name.",
      );
    let name: string;
    try {
      name = displayName(args.name);
    } catch (e) {
      throw new ConvexError(
        e instanceof Error ? e.message : "Invalid player name.",
      );
    }
    if (!(await claimName(ctx, name, p._id)))
      throw new ConvexError("That player name is already taken.");
    await ctx.db.patch(p._id, { name });
    return name;
  },
});
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    const p = await profile(ctx);
    const id = p.active || p.last;
    const tournament = id ? await ctx.db.get(id) : null;
    const t = tournament?.state as Tournament | undefined;
    const history = await ctx.db
      .query("rewards")
      .withIndex("by_profile", (q) => q.eq("profile", p._id))
      .order("desc")
      .take(10);
    const quests = await ctx.db
      .query("quests")
      .withIndex("by_profile_day", (q) =>
        q.eq("profile", p._id).eq("day", day(Date.now())),
      )
      .unique();
    return {
      profile: { ...p, authId: undefined },
      tournament: t ? { id, ...publicTournament(t) } : null,
      view: t ? playerView(t, p._id) : null,
      history,
      quests,
      serverNow: Date.now(),
    };
  },
});
export const join = mutation({
  args: {},
  handler: async (ctx) => {
    const p = await profile(ctx),
      now = Date.now();
    if (p.active) return p.active;
    await activity(ctx, p, now);
    if (p.last) {
      const last = await ctx.db
        .query("rewards")
        .withIndex("by_profile_tournament", (q) =>
          q.eq("profile", p._id).eq("tournament", p.last!),
        )
        .unique();
      if (last && now - last.createdAt < 120_000)
        await recordEvent(ctx, {
          kind: "immediate_requeue",
          at: now,
          value: now - last.createdAt,
        });
    }
    const tier = tierIndex(p.points);
    const candidates = await ctx.db
      .query("tournaments")
      .withIndex("by_status_tier", (q) =>
        q.eq("status", "lobby").eq("tier", tier),
      )
      .take(20);
    let room = candidates.find(
      (r) =>
        (r.state as Tournament).closesAt > now &&
        (r.state as Tournament).entrants.length < 16,
    );
    if (!room) {
      const id = await ctx.db.insert("tournaments", {
        tier,
        status: "lobby",
        state: newLobby(tier, now, Math.floor(Math.random() * 2 ** 32)),
        updatedAt: now,
      });
      room = (await ctx.db.get(id))!;
      await observeTournament(ctx, id, room.state as Tournament);
    }
    const t = room.state as Tournament;
    t.entrants.push({
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
    t.version++;
    if (t.entrants.length === 16) startTournament(t, now);
    await ctx.db.patch(p._id, { active: room._id, last: room._id });
    await recordEvent(ctx, {
      kind: "join",
      tournament: room._id,
      at: now,
    });
    await save(ctx, room._id, t, now);
    return room._id;
  },
});
export const leaveLobby = mutation({
  args: {},
  handler: async (ctx) => {
    const p = await profile(ctx);
    if (!p.active) return;
    const row = await ctx.db.get(p.active);
    if (!row || row.status !== "lobby" || row.state.closesAt <= Date.now())
      throw new Error("The bracket is locked");
    const t = row.state as Tournament;
    t.entrants = t.entrants.filter((e) => e.id !== p._id);
    t.version++;
    if (!t.entrants.length) t.status = "cancelled";
    await ctx.db.patch(p._id, { active: undefined, last: undefined });
    await recordEvent(ctx, {
      kind: "lobby_leave",
      tournament: row._id,
      at: Date.now(),
    });
    await save(ctx, row._id, t, Date.now());
  },
});
export const move = mutation({
  args: {
    tournament: v.id("tournaments"),
    match: v.number(),
    seq: v.number(),
    action: v.number(),
  },
  handler: async (ctx, args) => {
    const p = await profile(ctx);
    if (p.active !== args.tournament)
      throw new Error("You are not in this tournament");
    const row = await ctx.db.get(args.tournament);
    if (!row) throw new Error("Tournament not found");
    await activity(ctx, p, Date.now());
    const t = row.state as Tournament,
      now = Date.now(),
      previousVersion = t.version;
    advanceTime(t, now);
    let error: string | undefined;
    try {
      submitMove(t, args.match, p._id, args.seq, args.action, now);
    } catch (e) {
      error = e instanceof Error ? e.message : "Move failed";
    }
    if (t.version !== previousVersion) await save(ctx, row._id, t, now);
    return { error };
  },
});
export const resign = mutation({
  args: {},
  handler: async (ctx) => {
    const p = await profile(ctx);
    if (!p.active) return;
    const row = await ctx.db.get(p.active);
    if (!row || row.status !== "active") throw new Error("No active match");
    await activity(ctx, p, Date.now());
    const t = row.state as Tournament;
    resignPlayer(t, p._id, Date.now());
    await save(ctx, row._id, t, Date.now());
  },
});
export const equip = mutation({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const p = await profile(ctx),
      item = cosmetics.find((c) => c.id === id);
    if (!item || !p.cosmetics.includes(id))
      throw new Error("Cosmetic is locked");
    await ctx.db.patch(p._id, { equipped: { ...p.equipped, [item.kind]: id } });
  },
});
export const snapshot = internalQuery({
  args: { tournament: v.id("tournaments") },
  handler: async (ctx, args) => ctx.db.get(args.tournament),
});
export const tick = internalMutation({
  args: {
    tournament: v.id("tournaments"),
    version: v.number(),
    moves: v.array(
      v.object({ match: v.number(), seq: v.number(), action: v.number() }),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.tournament);
    if (!row || row.state.version !== args.version) return;
    const t = row.state as Tournament,
      now = Date.now();
    advanceTime(t, now);
    for (const move of args.moves) {
      const m = t.matches[move.match];
      if (
        !m ||
        m.status !== "playing" ||
        m.state.moves.length !== move.seq ||
        m.botAt > now
      )
        continue;
      const player = m.players[m.state.turn === 1 ? 0 : 1];
      if (t.entrants.find((e) => e.id === player)?.cpu)
        submitMove(t, m.id, player, move.seq, move.action, now);
    }
    // Consuming the version also invalidates duplicate jobs when this tick
    // only checks time and has no move to apply.
    t.version++;
    await save(ctx, row._id, t, now);
  },
});
export const recover = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const status of ["lobby", "active"]) {
      const rows = await ctx.db
        .query("tournaments")
        .withIndex("by_status_tier", (q) => q.eq("status", status))
        .take(100);
      for (const row of rows)
        if (row.updatedAt < Date.now() - 15_000) {
          await recordEvent(ctx, {
            kind: "scheduler_recovery",
            tournament: row._id,
            at: Date.now(),
          });
          await ctx.scheduler.runAfter(0, internal.bots.drive, {
            tournament: row._id,
            version: row.state.version,
          });
        }
    }
  },
});
export const linkProfiles = internalMutation({
  args: { from: v.string(), to: v.string() },
  handler: async (ctx, { from, to }) => {
    if (from === to) return;
    const source = await ctx.db
      .query("profiles")
      .withIndex("by_auth", (q) => q.eq("authId", from))
      .unique();
    const target = await ctx.db
      .query("profiles")
      .withIndex("by_auth", (q) => q.eq("authId", to))
      .unique();
    if (!source) return;
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "_id", value: to }],
    });
    const eligible = !!user && !user.isAnonymous;
    if (source.active || target?.active)
      throw new Error("Finish your tournament before linking accounts");
    if (!target) {
      await ctx.db.patch(source._id, {
        authId: to,
        leaderboardEligible: eligible && !source.leaderboardOptOut,
      });
      return;
    }
    const rewards = await ctx.db
      .query("rewards")
      .withIndex("by_profile", (q) => q.eq("profile", source._id))
      .collect();
    let xp = 0,
      crowns = 0;
    for (const r of rewards) {
      const duplicate = await ctx.db
        .query("rewards")
        .withIndex("by_profile_tournament", (q) =>
          q.eq("profile", target._id).eq("tournament", r.tournament),
        )
        .unique();
      if (!duplicate) {
        xp += r.xp;
        if (r.crown ?? (r.finish === 4 && r.xp > 0)) crowns++;
        await ctx.db.patch(r._id, { profile: target._id });
      }
    }
    const quests = await ctx.db
      .query("quests")
      .withIndex("by_profile_day", (q) => q.eq("profile", source._id))
      .collect();
    for (const quest of quests) {
      const other = await ctx.db
        .query("quests")
        .withIndex("by_profile_day", (q) =>
          q.eq("profile", target._id).eq("day", quest.day),
        )
        .unique();
      if (!other) await ctx.db.patch(quest._id, { profile: target._id });
      else
        await ctx.db.patch(other._id, {
          completed: other.completed + quest.completed,
          boards: other.boards + quest.boards,
          wins: other.wins + quest.wins,
          claimed: [...new Set([...other.claimed, ...quest.claimed])],
        });
    }
    const unlocked = [...new Set([...target.cosmetics, ...source.cosmetics])];
    await ctx.db.patch(target._id, {
      points: Math.max(target.points, source.points),
      xp: target.xp + xp,
      crowns: target.crowns + crowns,
      cosmetics: unlocked,
      leaderboardEligible: eligible && !target.leaderboardOptOut,
      playedAt:
        source.playedAt === undefined
          ? target.playedAt
          : Math.min(source.playedAt, target.playedAt ?? source.playedAt),
    });
    await observeProfile(ctx, (await ctx.db.get(target._id))!);
    // Retain historical entrant IDs, but revoke the old profile's account association.
    await ctx.db.patch(source._id, {
      authId: `linked:${from}`,
      leaderboardEligible: false,
      last: undefined,
    });
    await observeProfile(ctx, (await ctx.db.get(source._id))!);
    await mergeActivity(ctx, source, target);
  },
});

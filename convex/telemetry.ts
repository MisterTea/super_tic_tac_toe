import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  query,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { DEFAULT_SETTINGS, type Tournament } from "../lib/royale";

type Values = Record<string, number>;
const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10);
export async function sourceMetric(
  ctx: MutationCtx,
  acquisition: { source: string; campaign: string },
  at: number,
  metric: string,
) {
  for (const bucket of ["all", utcDay(at)]) {
    const row = await ctx.db
      .query("campaignMetrics")
      .withIndex("by_campaign_bucket", (q) =>
        q
          .eq("source", acquisition.source)
          .eq("campaign", acquisition.campaign)
          .eq("bucket", bucket),
      )
      .unique();
    const values = { ...(row?.values || {}) };
    values[metric] = (values[metric] || 0) + 1;
    if (row) await ctx.db.patch(row._id, { values });
    else
      await ctx.db.insert("campaignMetrics", {
        ...acquisition,
        bucket,
        values,
      });
  }
}

// Facts are stable source IDs. Retries, account linking, and historical backfill
// apply only the difference, in the same transaction as the game operation.
async function fact(ctx: MutationCtx, key: string, at: number, values: Values) {
  const prior = await ctx.db
    .query("metricFacts")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const day = prior?.day || utcDay(at);
  const delta: Values = {};
  for (const name of new Set([
    ...Object.keys(values),
    ...Object.keys(prior?.values || {}),
  ])) {
    const change = (values[name] || 0) - (prior?.values[name] || 0);
    if (change) delta[name] = change;
  }
  if (!Object.keys(delta).length && prior) return;
  for (const bucket of ["all", day]) {
    const rollup = await ctx.db
      .query("metricRollups")
      .withIndex("by_bucket", (q) => q.eq("bucket", bucket))
      .unique();
    const totals = { ...(rollup?.values || {}) };
    for (const [name, change] of Object.entries(delta))
      totals[name] = (totals[name] || 0) + change;
    if (rollup) await ctx.db.patch(rollup._id, { values: totals });
    else await ctx.db.insert("metricRollups", { bucket, values: totals });
  }
  if (prior) await ctx.db.patch(prior._id, { values });
  else await ctx.db.insert("metricFacts", { key, day, values });
}

export async function observeProfile(ctx: MutationCtx, p: Doc<"profiles">) {
  await fact(ctx, `profile:${p._id}`, p.joinedAt, {
    profilesCreated: 1,
    uniquePlayers: p.authId.startsWith("linked:") ? 0 : 1,
  });
  if (p.playedAt !== undefined)
    await fact(ctx, `participant:${p._id}`, p.playedAt, {
      playersWhoPlayed: p.authId.startsWith("linked:") ? 0 : 1,
    });
}

async function participated(ctx: MutationCtx, id: Id<"profiles">, at: number) {
  const p = await ctx.db.get(id);
  if (!p || p.authId.startsWith("linked:") || p.playedAt !== undefined) return;
  await ctx.db.patch(id, { playedAt: at });
  await observeProfile(ctx, { ...p, playedAt: at });
  if (p.acquisition)
    await sourceMetric(ctx, p.acquisition, at, "firstMatchesStarted");
}

export async function activity(
  ctx: MutationCtx,
  p: Doc<"profiles">,
  now: number,
) {
  if (p.authId.startsWith("linked:")) return;
  const day = utcDay(now);
  const prior = await ctx.db
    .query("playerActivity")
    .withIndex("by_profile_day", (q) => q.eq("profile", p._id).eq("day", day))
    .unique();
  if (prior) return;
  await ctx.db.insert("playerActivity", { profile: p._id, day });
  await fact(ctx, `activity:${p._id}:${day}`, now, {
    activePlayerDays: 1,
    returningPlayerDays: utcDay(p.joinedAt) < day ? 1 : 0,
  });
}

export async function mergeActivity(
  ctx: MutationCtx,
  source: Doc<"profiles">,
  target: Doc<"profiles">,
) {
  const rows = await ctx.db
    .query("playerActivity")
    .withIndex("by_profile_day", (q) => q.eq("profile", source._id))
    .collect();
  for (const row of rows) {
    // Source facts stay as zero-valued tombstones so a retry cannot recount them.
    await fact(
      ctx,
      `activity:${source._id}:${row.day}`,
      Date.parse(row.day),
      {},
    );
    await activity(ctx, target, Date.parse(`${row.day}T12:00:00Z`));
  }
}

export async function observeReward(ctx: MutationCtx, r: Doc<"rewards">) {
  if (r.xp > 0) await participated(ctx, r.profile, r.createdAt);
  await fact(ctx, `reward:${r._id}`, r.createdAt, {
    placementsAwarded: 1,
    xpAwarded: r.xp,
    crownsGiven: (r.crown ?? (r.finish === 4 && r.xp > 0)) ? 1 : 0,
  });
}

export async function observeTournament(
  ctx: MutationCtx,
  id: Id<"tournaments">,
  t: Tournament,
  previous?: Tournament,
) {
  if (!previous)
    await fact(ctx, `lobby:${id}`, t.createdAt, { lobbiesCreated: 1 });
  if (t.status === "cancelled" && previous?.status !== "cancelled")
    await fact(ctx, `cancelled:${id}`, t.createdAt, { cancelledLobbies: 1 });
  const started = t.matches.length > 0;
  if (started && !previous?.matches.length) {
    const at =
      t.matches[0].startAt - (t.settings || DEFAULT_SETTINGS).countdownMs;
    await fact(ctx, `locked:${id}`, at, {
      tournamentsStarted: 1,
      humanEntries: t.entrants.filter((e) => !e.cpu).length,
      cpuEntries: t.entrants.filter((e) => e.cpu).length,
      queueSamples: 1,
      queueMs: Math.max(0, at - t.createdAt),
    });
  }
  for (const m of t.matches) {
    const before = previous?.matches[m.id];
    if (previous && before?.status === m.status) continue;
    const human = m.players.some((p) =>
      t.entrants.some((e) => e.id === p && !e.cpu),
    );
    const began =
      m.status === "playing" ||
      (m.status === "finished" && (m.finishedAt || 0) >= m.startAt);
    if (began) {
      for (const player of m.players) {
        if (t.entrants.some((e) => e.id === player && !e.cpu))
          await participated(ctx, player as Id<"profiles">, m.startAt);
      }
      await fact(ctx, `match-start:${id}:${m.id}`, m.startAt, {
        gamesPlayed: 1,
        humanGamesPlayed: human ? 1 : 0,
        cpuOnlyGamesPlayed: human ? 0 : 1,
      });
    }
    if (m.status === "finished") {
      for (const player of began ? m.players : []) {
        if (!t.entrants.some((e) => e.id === player && !e.cpu)) continue;
        const key = `first-finish:${player}`;
        if (
          await ctx.db
            .query("metricFacts")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique()
        )
          continue;
        const p = await ctx.db.get(player as Id<"profiles">);
        const playedThrough =
          m.reason === "board victory" || m.reason === "board score";
        if (p?.acquisition)
          await sourceMetric(
            ctx,
            p.acquisition,
            m.finishedAt || m.startAt,
            "firstMatchesCompleted",
          );
        await fact(ctx, key, m.finishedAt || m.startAt, {
          firstMatchesCompleted: 1,
          firstMatchesPlayedThrough: playedThrough ? 1 : 0,
        });
      }
      await fact(ctx, `match-finish:${id}:${m.id}`, m.finishedAt || m.startAt, {
        matchesCompleted: 1,
        humanMatchesCompleted: human ? 1 : 0,
        legalMoves: m.state.moves.length,
        clockForfeits: m.reason === "clock" ? 1 : 0,
        resignations: m.reason === "resigned" ? 1 : 0,
        cappedMatches:
          m.reason === "board score" && (m.finishedAt || 0) >= m.deadline
            ? 1
            : 0,
        matchDurationSamples: began ? 1 : 0,
        matchDurationMs: began
          ? Math.max(0, (m.finishedAt || m.startAt) - m.startAt)
          : 0,
      });
    }
  }
  if (t.status === "finished" && previous?.status !== "finished") {
    const at = Math.max(...t.matches.map((m) => m.finishedAt || 0));
    await fact(ctx, `complete:${id}`, at, {
      tournamentsCompleted: 1,
      tournamentDurationMs: Math.max(0, at - t.createdAt),
      cpuChampions: t.entrants.find((e) => e.id === t.champion)?.cpu ? 1 : 0,
    });
  }
}

async function observeEvent(ctx: MutationCtx, e: Doc<"events">) {
  const mapped: Record<string, string> = {
    join: "lobbyJoins",
    lobby_leave: "lobbyLeaves",
    immediate_requeue: "immediateRequeues",
    daily_return: "returnVisits",
    scheduler_recovery: "schedulerRecoveries",
    friend_lobby_created: "friendLobbiesCreated",
    result_share: "resultsShared",
    daily_challenge_start: "dailyChallengesStarted",
    daily_challenge_solved: "dailyChallengesSolved",
  };
  const values: Values = mapped[e.kind] ? { [mapped[e.kind]]: 1 } : {};
  const sourceEvent = /^source_(visit|join|result):([^:]+):([^:]+)$/.exec(
    e.kind,
  );
  if (sourceEvent)
    await sourceMetric(
      ctx,
      { source: sourceEvent[2], campaign: sourceEvent[3] },
      e.at,
      { visit: "visitors", join: "entries", result: "results" }[
        sourceEvent[1] as "visit" | "join" | "result"
      ],
    );
  if (e.kind === "spectator_wait_ms")
    Object.assign(values, {
      spectatorWaitSamples: 1,
      spectatorWaitMs: e.value || 0,
    });
  if (Object.keys(values).length)
    await fact(ctx, `event:${e._id}`, e.at, values);
}
export async function recordEvent(
  ctx: MutationCtx,
  e: Omit<Doc<"events">, "_id" | "_creationTime">,
) {
  const id = await ctx.db.insert("events", e);
  await observeEvent(ctx, (await ctx.db.get(id))!);
}

export const publicStats = query({
  args: {},
  handler: async (ctx) => {
    const totals =
      (
        await ctx.db
          .query("metricRollups")
          .withIndex("by_bucket", (q) => q.eq("bucket", "all"))
          .unique()
      )?.values || {};
    return {
      players: totals.playersWhoPlayed || 0,
      games: totals.gamesPlayed || 0,
      crowns: totals.crownsGiven || 0,
    };
  },
});

function describe(values: Values): Record<string, number | null> {
  const zeros = Object.fromEntries(
    [
      "uniquePlayers",
      "playersWhoPlayed",
      "profilesCreated",
      "activePlayerDays",
      "returningPlayerDays",
      "gamesPlayed",
      "humanGamesPlayed",
      "cpuOnlyGamesPlayed",
      "matchesCompleted",
      "humanMatchesCompleted",
      "crownsGiven",
      "cpuChampions",
      "tournamentsStarted",
      "tournamentsCompleted",
      "lobbiesCreated",
      "cancelledLobbies",
      "humanEntries",
      "cpuEntries",
      "lobbyJoins",
      "lobbyLeaves",
      "immediateRequeues",
      "returnVisits",
      "clockForfeits",
      "resignations",
      "cappedMatches",
      "legalMoves",
      "xpAwarded",
      "placementsAwarded",
      "schedulerRecoveries",
    ].map((key) => [key, 0]),
  );
  const average = (sum: string, count: string) =>
    values[count] ? Math.round((values[sum] || 0) / values[count]) : null;
  return {
    ...zeros,
    ...values,
    averageQueueMs: average("queueMs", "queueSamples"),
    averageSpectatorWaitMs: average("spectatorWaitMs", "spectatorWaitSamples"),
    averageMatchMs: average("matchDurationMs", "matchDurationSamples"),
    cpuFillShare:
      (values.humanEntries || 0) + (values.cpuEntries || 0)
        ? (values.cpuEntries || 0) /
          ((values.humanEntries || 0) + (values.cpuEntries || 0))
        : null,
  };
}
// Accessible only to deployment administrators through Convex, never public clients.
export const report = internalQuery({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, { days }) => {
    const count = Math.max(1, Math.min(90, Math.floor(days || 30)));
    const rows = await ctx.db
      .query("metricRollups")
      .withIndex("by_bucket")
      .filter((q) => q.neq(q.field("bucket"), "all"))
      .order("desc")
      .take(count);
    const all = await ctx.db
      .query("metricRollups")
      .withIndex("by_bucket", (q) => q.eq("bucket", "all"))
      .unique();
    return {
      totals: describe(all?.values || {}),
      daily: rows.map((r) => ({ day: r.bucket, metrics: describe(r.values) })),
    };
  },
});

const sourceTables = ["profiles", "tournaments", "rewards", "events"] as const;
export const backfill = internalMutation({
  args: {
    table: v.optional(
      v.union(
        v.literal("profiles"),
        v.literal("tournaments"),
        v.literal("rewards"),
        v.literal("events"),
      ),
    ),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { table = "profiles", cursor = null }) => {
    const page = await ctx.db.query(table).paginate({ cursor, numItems: 10 });
    for (const row of page.page) {
      if (table === "profiles") {
        const p = row as Doc<"profiles">;
        await observeProfile(ctx, p);
        await activity(ctx, p, p.joinedAt);
        if (p.lastVisitDay)
          await activity(ctx, p, Date.parse(`${p.lastVisitDay}T12:00:00Z`));
      } else if (table === "tournaments") {
        const t = row as Doc<"tournaments">;
        await observeTournament(ctx, t._id, t.state as Tournament);
      } else if (table === "rewards")
        await observeReward(ctx, row as Doc<"rewards">);
      else await observeEvent(ctx, row as Doc<"events">);
    }
    const next = sourceTables[sourceTables.indexOf(table) + 1];
    if (!page.isDone || next)
      await ctx.scheduler.runAfter(0, internal.telemetry.backfill, {
        table: page.isDone ? next : table,
        cursor: page.isDone ? null : page.continueCursor,
      });
    return { table, processed: page.page.length, done: page.isDone && !next };
  },
});

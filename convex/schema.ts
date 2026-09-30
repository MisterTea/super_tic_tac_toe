import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  feedback: defineTable({
    message: v.string(),
    category: v.string(),
    email: v.optional(v.string()),
    page: v.string(),
    createdAt: v.number(),
    client: v.string(),
    request: v.string(),
  })
    .index("by_request", ["request"])
    .index("by_client_created", ["client", "createdAt"]),
  nameClaims: defineTable({ key: v.string(), owner: v.string() }).index(
    "by_key",
    ["key"],
  ),
  profiles: defineTable({
    authId: v.string(),
    name: v.string(),
    points: v.number(),
    xp: v.number(),
    crowns: v.number(),
    cosmetics: v.array(v.string()),
    equipped: v.object({
      theme: v.string(),
      title: v.string(),
      effect: v.string(),
    }),
    active: v.optional(v.id("tournaments")),
    last: v.optional(v.id("tournaments")),
    joinedAt: v.number(),
    lastVisitDay: v.optional(v.string()),
    playedAt: v.optional(v.number()),
    leaderboardOptOut: v.optional(v.boolean()),
    leaderboardEligible: v.optional(v.boolean()),
  })
    .index("by_auth", ["authId"])
    .index("by_leaderboard", ["leaderboardEligible", "points", "crowns", "xp"]),
  tournaments: defineTable({
    tier: v.number(),
    status: v.string(),
    state: v.any(),
    updatedAt: v.number(),
  }).index("by_status_tier", ["status", "tier"]),
  rewards: defineTable({
    profile: v.id("profiles"),
    tournament: v.id("tournaments"),
    finish: v.number(),
    delta: v.number(),
    xp: v.number(),
    createdAt: v.number(),
    crown: v.optional(v.boolean()),
  })
    .index("by_profile_tournament", ["profile", "tournament"])
    .index("by_profile", ["profile"]),
  quests: defineTable({
    profile: v.id("profiles"),
    day: v.string(),
    completed: v.number(),
    boards: v.number(),
    wins: v.number(),
    claimed: v.array(v.string()),
  }).index("by_profile_day", ["profile", "day"]),
  events: defineTable({
    kind: v.string(),
    tournament: v.optional(v.id("tournaments")),
    at: v.number(),
    value: v.optional(v.number()),
  }).index("by_kind_at", ["kind", "at"]),
  metricFacts: defineTable({
    key: v.string(),
    day: v.string(),
    values: v.record(v.string(), v.number()),
  }).index("by_key", ["key"]),
  metricRollups: defineTable({
    bucket: v.string(),
    values: v.record(v.string(), v.number()),
  }).index("by_bucket", ["bucket"]),
  playerActivity: defineTable({
    profile: v.id("profiles"),
    day: v.string(),
  }).index("by_profile_day", ["profile", "day"]),
});

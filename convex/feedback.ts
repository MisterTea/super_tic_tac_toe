import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";

export const send = mutation({
  args: {
    message: v.string(),
    category: v.union(v.literal("Bug"), v.literal("Idea"), v.literal("Other")),
    email: v.string(),
    page: v.string(),
    client: v.string(),
    request: v.string(),
    website: v.string(),
  },
  handler: async (ctx, args) => {
    if (args.website) return { accepted: true };
    const message = args.message.trim();
    const email = args.email.trim();
    if (message.length < 10 || message.length > 3000)
      throw new ConvexError("Please write 10–3,000 characters of feedback.");
    if (
      email &&
      (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      throw new ConvexError(
        "Please enter a valid email address or leave it blank.",
      );
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      !uuid.test(args.client) ||
      !uuid.test(args.request) ||
      args.page.length > 200 ||
      !/^\/[a-z0-9/_-]*$/i.test(args.page)
    )
      throw new ConvexError("Please refresh the page and try again.");
    const prior = await ctx.db
      .query("feedback")
      .withIndex("by_request", (q) => q.eq("request", args.request))
      .unique();
    if (prior) return { accepted: true };
    const now = Date.now();
    const recent = await ctx.db
      .query("feedback")
      .withIndex("by_client_created", (q) =>
        q.eq("client", args.client).gte("createdAt", now - 3600_000),
      )
      .take(3);
    if (recent.length >= 3)
      throw new ConvexError(
        "Thanks for your feedback. Please wait an hour before sending more.",
      );
    await ctx.db.insert("feedback", {
      message,
      category: args.category,
      ...(email ? { email } : {}),
      page: args.page,
      createdAt: now,
      client: args.client,
      request: args.request,
    });
    return { accepted: true };
  },
});

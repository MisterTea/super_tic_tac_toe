import type { MutationCtx } from "./_generated/server";
import { internalMutation } from "./_generated/server";
import { displayName, generatePlayerName, nameKey } from "../lib/player-names";

// Indexed reads and writes share a Convex transaction, so concurrent claims retry
// against the committed owner rather than allowing duplicate names.
export async function claimName(ctx: MutationCtx, name: string, owner: string) {
  const key = nameKey(name);
  const claim = await ctx.db
    .query("nameClaims")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  if (claim) return claim.owner === owner;
  await ctx.db.insert("nameClaims", { key, owner });
  return true;
}
export async function generatedName(ctx: MutationCtx, owner: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const name = generatePlayerName();
    if (await claimName(ctx, name, owner)) return name;
  }
  throw new Error("Could not find an available name. Please try again.");
}
export const migrate = internalMutation({
  args: {},
  handler: async (ctx) => {
    let renamed = 0;
    const profiles = await ctx.db.query("profiles").collect();
    for (const profile of profiles) {
      let name: string;
      try {
        name = displayName(profile.name);
      } catch {
        name = await generatedName(ctx, profile._id);
      }
      if (!(await claimName(ctx, name, profile._id)))
        name = await generatedName(ctx, profile._id);
      if (name !== profile.name) {
        await ctx.db.patch(profile._id, { name });
        renamed++;
      }
    }
    return { profiles: profiles.length, renamed };
  },
});

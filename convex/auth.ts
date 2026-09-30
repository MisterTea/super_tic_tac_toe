import { createClient, type GenericCtx } from "@convex-dev/better-auth";
import { convex } from "@convex-dev/better-auth/plugins";
import { betterAuth } from "better-auth/minimal";
import { anonymous } from "better-auth/plugins";
import { components, internal } from "./_generated/api";
import type { DataModel } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { requireActionCtx } from "@convex-dev/better-auth/utils";
import authConfig from "./auth.config";

export const authComponent = createClient<DataModel>(components.betterAuth);
export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.SITE_URL || "http://localhost:3000",
    secret: process.env.BETTER_AUTH_SECRET,
    database: authComponent.adapter(ctx),
    session: { expiresIn: 60 * 60 * 24 * 365, updateAge: 60 * 60 * 24 },
    trustedOrigins: (
      process.env.TRUSTED_ORIGINS ||
      process.env.SITE_URL ||
      "http://localhost:3000"
    ).split(","),
    socialProviders: {
      ...(process.env.VERCEL_CLIENT_ID && process.env.VERCEL_CLIENT_SECRET
        ? {
            vercel: {
              clientId: process.env.VERCEL_CLIENT_ID,
              clientSecret: process.env.VERCEL_CLIENT_SECRET,
              scope: ["openid", "email", "profile"],
            },
          }
        : {}),
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    plugins: [
      anonymous({
        disableDeleteAnonymousUser: true,
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          await requireActionCtx(ctx).runMutation(
            internal.royale.linkProfiles,
            { from: anonymousUser.user.id, to: newUser.user.id },
          );
        },
      }),
      convex({ authConfig }),
    ],
  });
export const { getAuthUser } = authComponent.clientApi();
export const currentUser = query({
  args: {},
  handler: (ctx) => authComponent.safeGetAuthUser(ctx),
});
export const providers = query({
  args: {},
  handler: () => ({
    vercel: !!(
      process.env.VERCEL_CLIENT_ID && process.env.VERCEL_CLIENT_SECRET
    ),
    google: !!(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
    ),
  }),
});

import { betterAuth } from "better-auth";
import { anonymous } from "better-auth/plugins";
import { pool } from "./db";
import { linkProfiles } from "./backend/royale";

export const auth = betterAuth({
  baseURL:
    process.env.BETTER_AUTH_URL ||
    process.env.SITE_URL ||
    "http://localhost:3000",
  secret:
    process.env.BETTER_AUTH_SECRET ||
    "f98a287cd4e910248467bb98e54736f8a20d43c8b16e492f8011246985a49c31",
  database: pool,
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
        await linkProfiles(anonymousUser.user.id, newUser.user.id);
      },
    }),
  ],
});

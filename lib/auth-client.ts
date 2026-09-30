"use client";
import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
export const authClient = createAuthClient({
  plugins: [anonymousClient(), convexClient()],
});

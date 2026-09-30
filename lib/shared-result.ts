import { cache } from "react";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
export const loadSharedResult = cache(async (token: string) => {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) return null;
  return new ConvexHttpClient(url).query(api.growth.sharedResult, { token });
});
export const resultTitle = (r: { crown: boolean; finish: number }) =>
  r.crown
    ? "Victory Royale"
    : ["Top 16", "Top 8", "Top 4", "Runner-up", "Champion"][r.finish] ||
      "My run";

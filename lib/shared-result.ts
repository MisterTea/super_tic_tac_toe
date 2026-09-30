import { cache } from "react";
import { sharedResult } from "./backend/growth";

export type SharedResultData = {
  name: string;
  finish: number;
  wins: number;
  crown: boolean;
  delta: number;
  rounds: Array<{ round: number; won: boolean }>;
};

export const loadSharedResult = cache(async (token: string): Promise<SharedResultData | null> => {
  return (await sharedResult(token)) as SharedResultData | null;
});

export const resultTitle = (r: { crown: boolean; finish: number }) =>
  r.crown
    ? "Victory Royale"
    : ["Top 16", "Top 8", "Top 4", "Runner-up", "Champion"][r.finish] ||
      "My run";

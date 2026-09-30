/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as bots from "../bots.js";
import type * as crons from "../crons.js";
import type * as daily from "../daily.js";
import type * as feedback from "../feedback.js";
import type * as growth from "../growth.js";
import type * as http from "../http.js";
import type * as leaderboard from "../leaderboard.js";
import type * as names from "../names.js";
import type * as royale from "../royale.js";
import type * as telemetry from "../telemetry.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  bots: typeof bots;
  crons: typeof crons;
  daily: typeof daily;
  feedback: typeof feedback;
  growth: typeof growth;
  http: typeof http;
  leaderboard: typeof leaderboard;
  names: typeof names;
  royale: typeof royale;
  telemetry: typeof telemetry;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};

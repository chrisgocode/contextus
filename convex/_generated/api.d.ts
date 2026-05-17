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
import type * as auth_helpers from "../auth_helpers.js";
import type * as contexto from "../contexto.js";
import type * as games from "../games.js";
import type * as giveup from "../giveup.js";
import type * as guesses from "../guesses.js";
import type * as hints from "../hints.js";
import type * as http from "../http.js";
import type * as lib_code from "../lib/code.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_hint from "../lib/hint.js";
import type * as requests from "../requests.js";
import type * as rooms from "../rooms.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  auth_helpers: typeof auth_helpers;
  contexto: typeof contexto;
  games: typeof games;
  giveup: typeof giveup;
  guesses: typeof guesses;
  hints: typeof hints;
  http: typeof http;
  "lib/code": typeof lib_code;
  "lib/dates": typeof lib_dates;
  "lib/hint": typeof lib_hint;
  requests: typeof requests;
  rooms: typeof rooms;
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

export declare const components: {};

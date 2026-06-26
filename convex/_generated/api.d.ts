/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as auth from "../auth.js";
import type * as cleanup from "../cleanup.js";
import type * as contexto from "../contexto.js";
import type * as crons from "../crons.js";
import type * as gameTransitions from "../gameTransitions.js";
import type * as games from "../games.js";
import type * as giveup from "../giveup.js";
import type * as guesses from "../guesses.js";
import type * as hints from "../hints.js";
import type * as http from "../http.js";
import type * as lib_cleanup from "../lib/cleanup.js";
import type * as lib_code from "../lib/code.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_gameTransitions from "../lib/gameTransitions.js";
import type * as lib_hint from "../lib/hint.js";
import type * as lib_roomActivity from "../lib/roomActivity.js";
import type * as lib_usernames from "../lib/usernames.js";
import type * as lib_words from "../lib/words.js";
import type * as presence from "../presence.js";
import type * as requests from "../requests.js";
import type * as rooms from "../rooms.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  auth: typeof auth;
  cleanup: typeof cleanup;
  contexto: typeof contexto;
  crons: typeof crons;
  gameTransitions: typeof gameTransitions;
  games: typeof games;
  giveup: typeof giveup;
  guesses: typeof guesses;
  hints: typeof hints;
  http: typeof http;
  "lib/cleanup": typeof lib_cleanup;
  "lib/code": typeof lib_code;
  "lib/dates": typeof lib_dates;
  "lib/gameTransitions": typeof lib_gameTransitions;
  "lib/hint": typeof lib_hint;
  "lib/roomActivity": typeof lib_roomActivity;
  "lib/usernames": typeof lib_usernames;
  "lib/words": typeof lib_words;
  presence: typeof presence;
  requests: typeof requests;
  rooms: typeof rooms;
  users: typeof users;
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
  presence: import("@convex-dev/presence/_generated/component.js").ComponentApi<"presence">;
};

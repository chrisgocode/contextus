import {
  HOUR,
  MINUTE,
  RateLimiter,
  type ActionCtx,
  type MutationCtx,
} from "@convex-dev/rate-limiter";
import { ConvexError } from "convex/values";
import { components } from "../_generated/api";

export const RATE_LIMITED_MESSAGE =
  "Too many requests. Wait a moment and try again.";

// Every uncached guess and every hint reaches Contexto from this deployment,
// so one script could get it throttled for everyone. These keep any one user
// well under that, and cap how many users a script can mint to multiply it.
export const rateLimits = {
  guess: { kind: "token bucket", rate: 40, period: MINUTE, capacity: 30 },
  // Spent per tip requested, so a hint that walks past guessed words costs more.
  hint: { kind: "token bucket", rate: 15, period: MINUTE, capacity: 15 },
  giveup: { kind: "token bucket", rate: 15, period: MINUTE, capacity: 8 },
  createRoom: { kind: "token bucket", rate: 30, period: HOUR, capacity: 20 },
  // Guest sign-ups carry no identity to key on, so this one is shared.
  createGuest: { kind: "token bucket", rate: 80, period: MINUTE, capacity: 80 },
} as const;

export const rateLimiter = new RateLimiter(components.rateLimiter, rateLimits);

// Spends one token from `name`'s bucket for `key`, or from the shared bucket
// when `key` is omitted, and throws a user-facing ConvexError when it's empty.
export async function enforceRateLimit(
  ctx: MutationCtx | ActionCtx,
  name: keyof typeof rateLimits,
  key?: string,
) {
  const { ok } = await rateLimiter.limit(ctx, name, { key });
  if (!ok) throw new ConvexError(RATE_LIMITED_MESSAGE);
}

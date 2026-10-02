/// <reference types="vite/client" />
import { register as registerPresence } from "@convex-dev/presence/test";
import { register as registerRateLimiter } from "@convex-dev/rate-limiter/test";
import { convexTest } from "convex-test";
import { vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { contextoOracle } from "./contexto";
import { rateLimiter, type rateLimits } from "./lib/rateLimits";
import schema from "./schema";

// The backend `e2eCleanup.purgeAccount` tests pretend to run on.
export const E2E_DEPLOYMENT_URL = "http://127.0.0.1:3210";

export function setupTest(
  options: Pick<Parameters<typeof convexTest>[0], "transactionLimits"> = {},
) {
  const modules = import.meta.glob("./**/!(*.test).*s");
  const t = convexTest({ schema, modules, ...options });
  registerPresence(t);
  registerRateLimiter(t);
  return t;
}

// Auth checks require the token's session row, so each seeded user gets one
// for `asUser` to sign in with.
const seededSessions = new WeakMap<
  ReturnType<typeof setupTest>,
  Map<Id<"users">, Id<"authSessions">>
>();

export async function seedUser(
  t: ReturnType<typeof setupTest>,
  attrs: {
    name?: string;
    email?: string;
    image?: string;
    username?: string;
    displayUsername?: string;
    isAnonymous?: boolean;
    guestExpiresAt?: number;
    guestCompletedGames?: number;
    guestPromptedGames?: number;
  } = {},
): Promise<Id<"users">> {
  const { userId, sessionId } = await t.run(async (ctx) => {
    const userId = await ctx.db.insert("users", {
      name: attrs.name ?? "Test User",
      email: attrs.email ?? `u${Math.random().toString(36).slice(2)}@test.dev`,
      image: attrs.image,
      username: attrs.username,
      displayUsername: attrs.displayUsername,
      isAnonymous: attrs.isAnonymous,
      guestExpiresAt: attrs.guestExpiresAt,
      guestCompletedGames: attrs.guestCompletedGames,
      guestPromptedGames: attrs.guestPromptedGames,
    });
    const sessionId = await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 60_000,
    });
    return { userId, sessionId };
  });
  const sessions =
    seededSessions.get(t) ?? new Map<Id<"users">, Id<"authSessions">>();
  sessions.set(userId, sessionId);
  seededSessions.set(t, sessions);
  return userId;
}

export function sessionOf(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
): Id<"authSessions"> {
  const sessionId = seededSessions.get(t)?.get(userId);
  if (sessionId === undefined) {
    throw new Error(`${userId} was not created with seedUser`);
  }
  return sessionId;
}

// Refills `userId`'s `name` bucket, for tests that play faster than a person
// can or move the clock backwards.
export async function resetRateLimit(
  t: ReturnType<typeof setupTest>,
  name: keyof typeof rateLimits,
  userId: Id<"users">,
) {
  await t.run((ctx) => rateLimiter.reset(ctx, name, { key: userId }));
}

export function asUser(t: ReturnType<typeof setupTest>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|${sessionOf(t, userId)}`,
    issuer: "test",
  });
}

// Runs scheduled functions to completion. Tests that inspect state between
// scheduled batches install fake timers first; with real timers convex-test
// also runs them on its own in the background.
export async function finishScheduledFunctions(
  t: ReturnType<typeof setupTest>,
) {
  const alreadyFake = vi.isFakeTimers();
  if (!alreadyFake) vi.useFakeTimers();
  try {
    await t.finishAllScheduledFunctions(vi.runAllTimers);
  } finally {
    if (!alreadyFake) vi.useRealTimers();
  }
}

export type WordOracleMock = {
  guesses?: Record<number, Record<string, number>>; // gameId -> word -> distance
  canonical?: Record<number, Record<string, string>>; // gameId -> input -> lemma
  tips?: Record<number, Record<number, string>>; // gameId -> distance -> word
  answers?: Record<number, string>; // gameId -> answer lemma
};

// Fakes the word oracle beneath the wordDistances cache, so each spy call is
// one cache miss that would have hit Contexto.
export function fakeWordOracle(mock: WordOracleMock) {
  return {
    distance: vi
      .spyOn(contextoOracle, "distance")
      .mockImplementation(async (contextoGameId, word) => {
        const lemma = mock.canonical?.[contextoGameId]?.[word] ?? word;
        const distance = mock.guesses?.[contextoGameId]?.[lemma];
        if (distance === undefined) {
          return { ok: false, error: "I'm sorry, I don't know this word" };
        }
        return { ok: true, lemma, distance };
      }),
    tip: vi
      .spyOn(contextoOracle, "tip")
      .mockImplementation(async (contextoGameId, distance) => {
        const lemma = mock.tips?.[contextoGameId]?.[distance];
        if (lemma === undefined) {
          throw new Error(
            `tip mock missing for gameId=${contextoGameId} d=${distance}`,
          );
        }
        return { lemma, distance };
      }),
    answer: vi
      .spyOn(contextoOracle, "answer")
      .mockImplementation(async (contextoGameId) => {
        const lemma = mock.answers?.[contextoGameId];
        if (lemma === undefined) {
          throw new Error(`giveup mock missing for gameId=${contextoGameId}`);
        }
        return { lemma };
      }),
  };
}

// convex-test drops the blob's type on store, but real uploads record the
// Content-Type header on the `_storage` row, which avatar checks read.
export async function storeUpload(
  t: ReturnType<typeof setupTest>,
  blob: Blob,
): Promise<Id<"_storage">> {
  return await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(blob);
    if (blob.type !== "") {
      const patchSystem = ctx.db.patch as unknown as (
        table: "_storage",
        id: Id<"_storage">,
        value: { contentType: string },
      ) => Promise<void>;
      await patchSystem("_storage", storageId, { contentType: blob.type });
    }
    return storageId;
  });
}

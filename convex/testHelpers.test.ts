/// <reference types="vite/client" />
import { register as registerPresence } from "@convex-dev/presence/test";
import { convexTest } from "convex-test";
import { vi } from "vitest";
import type { Id } from "./_generated/dataModel";
import { contextoOracle } from "./contexto";
import schema from "./schema";

export function setupTest() {
  const modules = import.meta.glob("./**/!(*.test).*s");
  const t = convexTest(schema, modules);
  registerPresence(t);
  return t;
}

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
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
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
  });
}

export function asUser(t: ReturnType<typeof setupTest>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session-${userId}`,
    issuer: "test",
  });
}

export async function asUserWithSession(
  t: ReturnType<typeof setupTest>,
  userId: Id<"users">,
) {
  const sessionId = await t.run(async (ctx) => {
    return await ctx.db.insert("authSessions", {
      userId,
      expirationTime: Date.now() + 60_000,
    });
  });
  return t.withIdentity({
    subject: `${userId}|${sessionId}`,
    issuer: "test",
  });
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

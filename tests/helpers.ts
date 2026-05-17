/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { vi } from "vitest";
import schema from "../convex/schema";
import type { Id } from "../convex/_generated/dataModel";

export function setupTest() {
  const modules = import.meta.glob("../convex/**/!(*.test).*s");
  return convexTest(schema, modules);
}

export async function seedUser(
  t: ReturnType<typeof setupTest>,
  attrs: { name?: string; email?: string; image?: string } = {},
): Promise<Id<"users">> {
  return await t.run(async (ctx) => {
    return await ctx.db.insert("users", {
      name: attrs.name ?? "Test User",
      email: attrs.email ?? `u${Math.random().toString(36).slice(2)}@test.dev`,
      image: attrs.image,
    });
  });
}

export function asUser(t: ReturnType<typeof setupTest>, userId: Id<"users">) {
  return t.withIdentity({
    subject: `${userId}|test-session-${userId}`,
    issuer: "test",
  });
}

export type ContextoMock = {
  guesses?: Record<number, Record<string, number>>; // gameId -> word -> distance
  tips?: Record<number, Record<number, string>>; // gameId -> distance -> word
  answers?: Record<number, string>; // gameId -> answer lemma
};

export function mockContextoFetch(mock: ContextoMock) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const guessMatch = url.match(/\/game\/(\d+)\/([^/?#]+)/);
    if (guessMatch) {
      const gameId = Number(guessMatch[1]);
      const word = decodeURIComponent(guessMatch[2]);
      const distance = mock.guesses?.[gameId]?.[word];
      if (distance === undefined) {
        return jsonResponse({ error: "I'm sorry, I don't know this word" });
      }
      return jsonResponse({ distance, lemma: word, word });
    }
    const tipMatch = url.match(/\/tip\/(\d+)\/(\d+)/);
    if (tipMatch) {
      const gameId = Number(tipMatch[1]);
      const distance = Number(tipMatch[2]);
      const word = mock.tips?.[gameId]?.[distance];
      if (word === undefined) {
        throw new Error(`tip mock missing for gameId=${gameId} d=${distance}`);
      }
      return jsonResponse({ distance, lemma: word, word });
    }
    const giveupMatch = url.match(/\/giveup\/(\d+)/);
    if (giveupMatch) {
      const gameId = Number(giveupMatch[1]);
      const word = mock.answers?.[gameId];
      if (word === undefined) {
        throw new Error(`giveup mock missing for gameId=${gameId}`);
      }
      return jsonResponse({ distance: 0, lemma: word, word });
    }
    throw new Error(`Unmatched fetch URL in test: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

import { ConvexError, v } from "convex/values";
import { internalAction } from "./_generated/server";

const BASE = "https://api.contexto.me/machado/en";

export const fetchGuess = internalAction({
	args: { contextoGameId: v.number(), word: v.string() },
	handler: async (
		_ctx,
		{ contextoGameId, word },
	): Promise<
		{ ok: true; lemma: string; distance: number } | { ok: false; error: string }
	> => {
		const url = `${BASE}/game/${contextoGameId}/${encodeURIComponent(word)}`;
		const res = await fetch(url);
		const body = (await res.json()) as
			| { distance: number; lemma: string; word: string }
			| { error: string };
		if ("error" in body) return { ok: false, error: body.error };
		return { ok: true, lemma: body.lemma, distance: body.distance };
	},
});

export const fetchTip = internalAction({
	args: { contextoGameId: v.number(), distance: v.number() },
	handler: async (
		_ctx,
		{ contextoGameId, distance },
	): Promise<{ lemma: string; distance: number }> => {
		const url = `${BASE}/tip/${contextoGameId}/${distance}`;
		const res = await fetch(url);
		const body = (await res.json()) as {
			distance: number;
			lemma: string;
			word: string;
		};
		if (typeof body.lemma !== "string") {
			throw new ConvexError("Tip API returned unexpected payload");
		}
		return { lemma: body.lemma, distance: body.distance };
	},
});

export const fetchAnswer = internalAction({
	args: { contextoGameId: v.number() },
	handler: async (_ctx, { contextoGameId }): Promise<{ lemma: string }> => {
		const url = `${BASE}/giveup/${contextoGameId}`;
		const res = await fetch(url);
		const body = (await res.json()) as {
			distance: number;
			lemma: string;
			word: string;
		};
		return { lemma: body.lemma };
	},
});

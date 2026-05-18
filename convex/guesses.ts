import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalQuery, query } from "./_generated/server";
import { requireMemberByGame, requireUser, tryMemberByGame } from "./access";

const ALREADY_GUESSED_MESSAGE = "The word was already guessed.";

function normalizeWord(input: string): string {
	return input.trim().toLowerCase();
}

export const _preflight = internalQuery({
	args: { gameId: v.id("games"), lemma: v.string() },
	handler: async (ctx, { gameId, lemma }) => {
		const { game } = await requireMemberByGame(ctx, { gameId });
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		const cached = await ctx.db
			.query("wordDistances")
			.withIndex("by_game_lemma", (q) =>
				q.eq("contextoGameId", game.contextoGameId).eq("lemma", lemma),
			)
			.unique();
		return {
			contextoGameId: game.contextoGameId,
			roomId: game.roomId,
			cached: cached?.distance ?? null,
		};
	},
});

export const submit = action({
	args: { gameId: v.id("games"), word: v.string() },
	handler: async (ctx, { gameId, word }) => {
		const userId = await requireUser(ctx);
		const lemma = normalizeWord(word);
		if (lemma.length === 0) throw new ConvexError("Empty word");

		const pre: { contextoGameId: number; cached: number | null } =
			await ctx.runQuery(internal.guesses._preflight, {
				gameId,
				lemma,
			});

		let distance: number;
		let canonicalLemma = lemma;
		if (pre.cached !== null) {
			distance = pre.cached;
		} else {
			const result = await ctx.runAction(internal.contexto.fetchGuess, {
				contextoGameId: pre.contextoGameId,
				word: lemma,
			});
			if (!result.ok) {
				throw new ConvexError(result.error);
			}
			distance = result.distance;
			canonicalLemma = result.lemma;
		}

		if (canonicalLemma !== lemma) {
			const result: { status: "recorded" | "duplicate"; won: boolean } =
				await ctx.runMutation(internal.gameTransitions.applyGuess, {
					gameId,
					userId,
					lemma: canonicalLemma,
					distance,
					source: "guess",
				});
			if (result.status === "duplicate") {
				return {
					lemma: canonicalLemma,
					distance,
					won: false,
					alreadyGuessed: true,
					message: ALREADY_GUESSED_MESSAGE,
				};
			}
			return { lemma: canonicalLemma, distance, won: result.won };
		}
		const result: { status: "recorded" | "duplicate"; won: boolean } =
			await ctx.runMutation(internal.gameTransitions.applyGuess, {
				gameId,
				userId,
				lemma,
				distance,
				source: "guess",
			});
		if (result.status === "duplicate") {
			return {
				lemma,
				distance,
				won: false,
				alreadyGuessed: true,
				message: ALREADY_GUESSED_MESSAGE,
			};
		}
		return { lemma, distance, won: result.won };
	},
});

export const listForGame = query({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const access = await tryMemberByGame(ctx, { gameId });
		if (access === null) return { sorted: [], latest: null };
		const sortedRaw = await ctx.db
			.query("gameGuesses")
			.withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
			.order("asc")
			.take(500);
		const latestRaw =
			sortedRaw.length === 0
				? null
				: sortedRaw.reduce((a, b) => (a.createdAt > b.createdAt ? a : b));

		const userIds = Array.from(new Set(sortedRaw.map((g) => g.userId)));
		const userDocs = await Promise.all(userIds.map((uid) => ctx.db.get(uid)));
		const userMap = new Map<Id<"users">, Doc<"users">>();
		userDocs.forEach((u, i) => {
			if (u !== null) userMap.set(userIds[i], u);
		});
		const hydrate = (g: Doc<"gameGuesses">) => {
			const u = userMap.get(g.userId);
			return {
				...g,
				userName: u?.name ?? null,
				userImage: u?.image ?? null,
			};
		};
		return {
			sorted: sortedRaw.map(hydrate),
			latest: latestRaw === null ? null : hydrate(latestRaw),
		};
	},
});

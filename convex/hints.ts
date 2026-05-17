import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalQuery,
} from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { initialHintTarget, MAX_WALK_ITERATIONS } from "./lib/hint";

export const _hintPreflight = internalQuery({
	args: { gameId: v.id("games"), hostUserId: v.id("users") },
	handler: async (ctx, { gameId, hostUserId }) => {
		const game = await ctx.db.get(gameId);
		if (game === null) throw new ConvexError("Game not found");
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		const room = await ctx.db.get(game.roomId);
		if (room === null) throw new ConvexError("Room not found");
		if (room.hostUserId !== hostUserId) {
			throw new ConvexError("Only host can apply hints");
		}
		const closest = await ctx.db
			.query("gameGuesses")
			.withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
			.order("asc")
			.first();
		const allGuessed = await ctx.db
			.query("gameGuesses")
			.withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
			.collect();
		return {
			contextoGameId: game.contextoGameId,
			best: closest?.distance ?? null,
			guessedLemmas: allGuessed.map((g) => g.lemma),
		};
	},
});

export const _execute = internalAction({
	args: {
		gameId: v.id("games"),
		hostUserId: v.id("users"),
		requesterUserId: v.id("users"),
		requestId: v.optional(v.id("pendingRequests")),
	},
	handler: async (
		ctx,
		{ gameId, hostUserId, requesterUserId, requestId },
	): Promise<{ lemma: string; distance: number }> => {
		const pre: {
			contextoGameId: number;
			best: number | null;
			guessedLemmas: string[];
		} = await ctx.runQuery(internal.hints._hintPreflight, {
			gameId,
			hostUserId,
		});
		const guessedSet = new Set(pre.guessedLemmas);

		let target = initialHintTarget(pre.best);
		const walking = pre.best === 1;

		for (let i = 0; i < MAX_WALK_ITERATIONS; i++) {
			const tip: { lemma: string; distance: number } = await ctx.runAction(
				internal.contexto.fetchTip,
				{ contextoGameId: pre.contextoGameId, distance: target },
			);
			if (!guessedSet.has(tip.lemma)) {
				const result: { status: "recorded" | "duplicate"; won: boolean } =
					await ctx.runMutation(internal.guesses._recordGuess, {
						gameId,
						userId: requesterUserId,
						lemma: tip.lemma,
						distance: tip.distance,
						source: "hint",
						approveRequestId: requestId,
					});
				if (result.status === "recorded") {
					return { lemma: tip.lemma, distance: tip.distance };
				}
				guessedSet.add(tip.lemma);
				if (!walking) {
					throw new ConvexError("Hint lemma already guessed");
				}
				target += 1;
				continue;
			}
			if (!walking) {
				throw new ConvexError("Hint lemma already guessed");
			}
			target += 1;
		}
		throw new ConvexError("Could not find an unguessed hint");
	},
});

export const hostHint = action({
	args: { gameId: v.id("games") },
	handler: async (
		ctx,
		{ gameId },
	): Promise<{ lemma: string; distance: number }> => {
		const hostUserId: Id<"users"> = await requireUser(ctx);
		return await ctx.runAction(internal.hints._execute, {
			gameId,
			hostUserId,
			requesterUserId: hostUserId,
		});
	},
});

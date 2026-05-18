import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
	action,
	internalAction,
	internalQuery,
} from "./_generated/server";
import { requireHostByGame, requireUser } from "./access";
import { initialHintTarget, MAX_WALK_ITERATIONS } from "./lib/hint";

export const _hintPreflight = internalQuery({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const { game } = await requireHostByGame(ctx, { gameId });
		if (game.status !== "in_progress") {
			throw new ConvexError("Game is no longer in progress");
		}
		const closest = await ctx.db
			.query("gameGuesses")
			.withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
			.order("asc")
			.first();
		return {
			contextoGameId: game.contextoGameId,
			best: closest?.distance ?? null,
		};
	},
});

export const _execute = internalAction({
	args: {
		gameId: v.id("games"),
		requesterUserId: v.id("users"),
		requestId: v.optional(v.id("pendingRequests")),
	},
	handler: async (
		ctx,
		{ gameId, requesterUserId, requestId },
	): Promise<{ lemma: string; distance: number }> => {
		const pre: {
			contextoGameId: number;
			best: number | null;
		} = await ctx.runQuery(internal.hints._hintPreflight, {
			gameId,
		});

		let target = initialHintTarget(pre.best);
		const walking = pre.best === 1;

		for (let i = 0; i < MAX_WALK_ITERATIONS; i++) {
			const tip: { lemma: string; distance: number } = await ctx.runAction(
				internal.contexto.fetchTip,
				{ contextoGameId: pre.contextoGameId, distance: target },
			);
			const result: { status: "recorded" | "duplicate"; won: boolean } =
				await ctx.runMutation(internal.gameTransitions.applyGuess, {
					gameId,
					userId: requesterUserId,
					lemma: tip.lemma,
					distance: tip.distance,
					source: "hint",
					closeRequestId: requestId,
				});
			if (result.status === "recorded") {
				return { lemma: tip.lemma, distance: tip.distance };
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
			requesterUserId: hostUserId,
		});
	},
});

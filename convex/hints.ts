import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx, MutationCtx } from "./_generated/server";
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
} from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { assertMember } from "./games";
import { initialHintTarget, MAX_WALK_ITERATIONS } from "./lib/hint";

async function loadGameAndRoom(
	ctx: Pick<MutationCtx, "db">,
	gameId: Id<"games">,
) {
	const game = await ctx.db.get(gameId);
	if (game === null) throw new ConvexError("Game not found");
	if (game.status !== "in_progress") {
		throw new ConvexError("Game is no longer in progress");
	}
	const room = await ctx.db.get(game.roomId);
	if (room === null) throw new ConvexError("Room not found");
	return { game, room };
}

export const request = mutation({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const userId = await requireUser(ctx);
		const { game, room } = await loadGameAndRoom(ctx, gameId);
		if (room.hostUserId === userId) {
			throw new ConvexError("Host should use hostHint to request directly");
		}
		await assertMember(ctx, game.roomId, userId);
		const existing = await ctx.db
			.query("pendingRequests")
			.withIndex("by_requester_game_type_status", (q) =>
				q
					.eq("requesterUserId", userId)
					.eq("gameId", gameId)
					.eq("type", "hint")
					.eq("status", "pending"),
			)
			.first();
		if (existing !== null) {
			throw new ConvexError("Hint request already pending");
		}
		await ctx.db.insert("pendingRequests", {
			roomId: game.roomId,
			gameId,
			requesterUserId: userId,
			type: "hint",
			status: "pending",
			createdAt: Date.now(),
		});
		return null;
	},
});

export const deny = mutation({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		const userId = await requireUser(ctx);
		const req = await ctx.db.get(requestId);
		if (req === null || req.type !== "hint") {
			throw new ConvexError("Request not found");
		}
		const room = await ctx.db.get(req.roomId);
		if (room === null || room.hostUserId !== userId) {
			throw new ConvexError("Only host can deny");
		}
		await ctx.db.patch(requestId, { status: "denied" });
		return null;
	},
});

export const _readRequest = internalQuery({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		return await ctx.db.get(requestId);
	},
});

export const _markRequestApproved = internalMutation({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		await ctx.db.patch(requestId, { status: "approved" });
	},
});

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

async function executeHint(
	ctx: Pick<ActionCtx, "runQuery" | "runAction" | "runMutation">,
	args: {
		gameId: Id<"games">;
		hostUserId: Id<"users">;
		requesterUserId: Id<"users">;
	},
): Promise<{ lemma: string; distance: number }> {
	const pre: {
		contextoGameId: number;
		best: number | null;
		guessedLemmas: string[];
	} = await ctx.runQuery(internal.hints._hintPreflight, {
		gameId: args.gameId,
		hostUserId: args.hostUserId,
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
					gameId: args.gameId,
					userId: args.requesterUserId,
					lemma: tip.lemma,
					distance: tip.distance,
					source: "hint",
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
}

export const approve = action({
	args: { requestId: v.id("pendingRequests") },
	handler: async (ctx, { requestId }) => {
		const hostUserId = await requireUser(ctx);
		const req: Doc<"pendingRequests"> | null = await ctx.runQuery(
			internal.hints._readRequest,
			{
				requestId,
			},
		);
		if (req === null || req.type !== "hint" || req.status !== "pending") {
			throw new ConvexError("Request not found or already handled");
		}
		const result = await executeHint(ctx, {
			gameId: req.gameId,
			hostUserId,
			requesterUserId: req.requesterUserId,
		});
		await ctx.runMutation(internal.hints._markRequestApproved, { requestId });
		return result;
	},
});

export const hostHint = action({
	args: { gameId: v.id("games") },
	handler: async (ctx, { gameId }) => {
		const hostUserId = await requireUser(ctx);
		return await executeHint(ctx, {
			gameId,
			hostUserId,
			requesterUserId: hostUserId,
		});
	},
});

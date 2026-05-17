import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	...authTables,

	rooms: defineTable({
		code: v.string(),
		hostUserId: v.id("users"),
		status: v.union(v.literal("active"), v.literal("ended")),
		lastActivityAt: v.number(),
	})
		.index("by_code", ["code"])
		.index("by_status_lastActivity", ["status", "lastActivityAt"]),

	roomMembers: defineTable({
		roomId: v.id("rooms"),
		userId: v.id("users"),
		joinedAt: v.number(),
	})
		.index("by_room", ["roomId"])
		.index("by_room_user", ["roomId", "userId"])
		.index("by_user", ["userId"]),

	games: defineTable({
		roomId: v.id("rooms"),
		contextoGameId: v.number(),
		status: v.union(
			v.literal("in_progress"),
			v.literal("won"),
			v.literal("given_up"),
		),
		winnerUserId: v.optional(v.id("users")),
		answerLemma: v.optional(v.string()),
		startedAt: v.number(),
		endedAt: v.optional(v.number()),
	})
		.index("by_room_status", ["roomId", "status"])
		.index("by_room_started", ["roomId", "startedAt"]),

	gameGuesses: defineTable({
		gameId: v.id("games"),
		userId: v.id("users"),
		lemma: v.string(),
		distance: v.number(),
		source: v.union(v.literal("guess"), v.literal("hint")),
		createdAt: v.number(),
	})
		.index("by_game_distance", ["gameId", "distance"])
		.index("by_game_lemma", ["gameId", "lemma"])
		.index("by_game_created", ["gameId", "createdAt"]),

	wordDistances: defineTable({
		contextoGameId: v.number(),
		lemma: v.string(),
		distance: v.number(),
	})
		.index("by_game_lemma", ["contextoGameId", "lemma"])
		.index("by_game_distance", ["contextoGameId", "distance"]),

	pendingRequests: defineTable({
		roomId: v.id("rooms"),
		gameId: v.id("games"),
		requesterUserId: v.id("users"),
		type: v.union(v.literal("hint"), v.literal("giveup")),
		status: v.union(
			v.literal("pending"),
			v.literal("approved"),
			v.literal("denied"),
		),
		createdAt: v.number(),
	})
		.index("by_game_status", ["gameId", "status"])
		.index("by_room_status", ["roomId", "status"])
		.index("by_requester_game_type_status", [
			"requesterUserId",
			"gameId",
			"type",
			"status",
		]),

	userGameHistory: defineTable({
		userId: v.id("users"),
		contextoGameId: v.number(),
		firstPlayedAt: v.number(),
	})
		.index("by_user_game", ["userId", "contextoGameId"])
		.index("by_user", ["userId"]),
});

import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
	users: defineTable({
		name: v.optional(v.string()),
		image: v.optional(v.string()),
		email: v.optional(v.string()),
		emailVerificationTime: v.optional(v.number()),
		phone: v.optional(v.string()),
		phoneVerificationTime: v.optional(v.number()),
		isAnonymous: v.optional(v.boolean()),
		username: v.optional(v.string()),
		displayUsername: v.optional(v.string()),
		avatarStorageId: v.optional(v.id("_storage")),
	})
		.index("email", ["email"])
		.index("phone", ["phone"])
		.index("by_username", ["username"]),

	authSessions: defineTable({
		userId: v.id("users"),
		expirationTime: v.number(),
	}).index("userId", ["userId"]),

	authAccounts: defineTable({
		userId: v.id("users"),
		provider: v.string(),
		providerAccountId: v.string(),
		secret: v.optional(v.string()),
		emailVerified: v.optional(v.string()),
		phoneVerified: v.optional(v.string()),
	})
		.index("userIdAndProvider", ["userId", "provider"])
		.index("providerAndAccountId", ["provider", "providerAccountId"]),

	authRefreshTokens: defineTable({
		sessionId: v.id("authSessions"),
		expirationTime: v.number(),
		firstUsedTime: v.optional(v.number()),
		parentRefreshTokenId: v.optional(v.id("authRefreshTokens")),
	})
		.index("sessionId", ["sessionId"])
		.index("sessionIdAndParentRefreshTokenId", [
			"sessionId",
			"parentRefreshTokenId",
		]),

	authVerificationCodes: defineTable({
		accountId: v.id("authAccounts"),
		provider: v.string(),
		code: v.string(),
		expirationTime: v.number(),
		verifier: v.optional(v.string()),
		emailVerified: v.optional(v.string()),
		phoneVerified: v.optional(v.string()),
	})
		.index("accountId", ["accountId"])
		.index("code", ["code"]),

	authVerifiers: defineTable({
		sessionId: v.optional(v.id("authSessions")),
		signature: v.optional(v.string()),
	}).index("signature", ["signature"]),

	authRateLimits: defineTable({
		identifier: v.string(),
		lastAttemptTime: v.number(),
		attemptsLeft: v.number(),
	}).index("identifier", ["identifier"]),

	rooms: defineTable({
		code: v.string(),
		hostUserId: v.id("users"),
		status: v.union(v.literal("active"), v.literal("ended")),
	})
		.index("by_code", ["code"])
		.index("by_status", ["status"]),

	roomActivity: defineTable({
		roomId: v.id("rooms"),
		lastActivityAt: v.number(),
	})
		.index("by_room", ["roomId"])
		.index("by_lastActivity", ["lastActivityAt"]),

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
		.index("by_user", ["userId"])
		.index("by_user_and_firstPlayedAt", ["userId", "firstPlayedAt"]),
});

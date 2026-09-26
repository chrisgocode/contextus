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
    guestCompletedGames: v.optional(v.number()),
    guestPromptedGames: v.optional(v.number()),
    guestExpiresAt: v.optional(v.number()),
    // IANA time zone reported by the client, for local-time achievements.
    timeZone: v.optional(v.string()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"])
    .index("by_username", ["username"])
    .index("by_is_anonymous_and_guest_expires_at", [
      "isAnonymous",
      "guestExpiresAt",
    ]),

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
    // Required by @convex-dev/auth, which queries this index by name.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
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

  // In-flight guest-to-account merge. Rows are moved in bounded batches
  // outside the sign-in transaction; the row is deleted once the guest is.
  guestMerges: defineTable({
    guestUserId: v.id("users"),
    targetUserId: v.id("users"),
    phase: v.union(
      v.literal("hostedRooms"),
      v.literal("memberships"),
      v.literal("guesses"),
      v.literal("requests"),
      v.literal("wins"),
      v.literal("history"),
      v.literal("achievements"),
      v.literal("achievementProgress"),
      v.literal("solveDays"),
      v.literal("gamePlayerStats"),
      v.literal("finalize"),
    ),
    // Puzzles both sides solved, so combined uniqueSolves counts them once.
    overlappingSolves: v.number(),
  }).index("by_guest_user", ["guestUserId"]),

  rooms: defineTable({
    code: v.string(),
    hostUserId: v.id("users"),
    status: v.union(v.literal("active"), v.literal("ended")),
  })
    .index("by_code", ["code"])
    .index("by_status", ["status"])
    .index("by_host_user", ["hostUserId"]),

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
    active: v.optional(v.boolean()),
  })
    .index("by_room_user", ["roomId", "userId"])
    // Not redundant: listRecentGroups needs memberships in creation order,
    // which by_user_and_active would reorder by `active` first.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_user", ["userId"])
    .index("by_user_and_active", ["userId", "active"]),

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
    .index("by_room_started", ["roomId", "startedAt"])
    .index("by_winner_user", ["winnerUserId"]),

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
    .index("by_game_created", ["gameId", "createdAt"])
    .index("by_user", ["userId"]),

  wordDistances: defineTable({
    contextoGameId: v.number(),
    lemma: v.string(),
    distance: v.number(),
    // Set when `lemma` is a raw input Contexto maps to a different lemma.
    // Absent means `lemma` is its own canonical lemma.
    canonicalLemma: v.optional(v.string()),
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
    firstAttemptAt: v.optional(v.number()),
    firstAttemptDistance: v.optional(v.number()),
    firstAttemptGameId: v.optional(v.id("games")),
    firstSolvedAt: v.optional(v.number()),
    firstSolvedGameId: v.optional(v.id("games")),
  })
    .index("by_user_game", ["userId", "contextoGameId"])
    .index("by_user_and_firstPlayedAt", ["userId", "firstPlayedAt"]),

  userAchievements: defineTable({
    userId: v.id("users"),
    achievementId: v.string(),
    unlockedAt: v.number(),
  }).index("by_user_achievement", ["userId", "achievementId"]),

  userAchievementProgress: defineTable({
    userId: v.id("users"),
    achievementId: v.string(),
    current: v.number(),
    target: v.number(),
    hidden: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user_achievement", ["userId", "achievementId"]),

  userAchievementStats: defineTable({
    userId: v.id("users"),
    redGuesses: v.number(),
    yellowGuesses: v.number(),
    greenGuesses: v.number(),
    uniqueSolves: v.number(),
  }).index("by_user", ["userId"]),

  // One row per local calendar day on which the user was credited with a
  // solve. Streak achievements count consecutive days.
  userSolveDays: defineTable({
    userId: v.id("users"),
    dayKey: v.string(),
  }).index("by_user_and_dayKey", ["userId", "dayKey"]),

  gamePlayerStats: defineTable({
    gameId: v.id("games"),
    userId: v.id("users"),
    realGuessCount: v.number(),
    bestDistance: v.number(),
    lastDistance: v.number(),
    noBacktrackingSoFar: v.boolean(),
    updatedAt: v.number(),
  })
    .index("by_game_user", ["gameId", "userId"])
    .index("by_user", ["userId"]),
});

// Game turn module: every way a Game changes state (a Guess, a Host hint, a
// Host give-up, approving a Pending request) goes through `performTurn`.
//
// Pipeline: `_prepare` (authorize, early checks) -> word oracle -> `_apply`.
// `_apply` re-runs authorization and the Pending request check in the same
// transaction that changes the Game, so no caller can skip them.
import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  internalAction,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireHostByGame, requireMemberByGame } from "./access";
import { recordAcceptedGuessForAchievements } from "./achievements";
import { analyticsEnabled, track } from "./analytics";
import { upsertHistory } from "./games";
import type { AchievementId } from "./lib/achievements";
import { decideGiveup, decideGuess } from "./lib/gameTransitions";
import { recordGuestGameCompletion } from "./lib/guestEngagement";
import { initialHintTarget, MAX_WALK_ITERATIONS } from "./lib/hint";
import { upsertRoomActivity } from "./lib/roomActivity";
import { puzzleWordOracle, type ScoredLemma } from "./wordOracle";

const ALREADY_GUESSED_MESSAGE = "The word was already guessed.";
const REQUEST_HANDLED_MESSAGE = "Request not found or already handled";
const NOT_IN_PROGRESS_MESSAGE = "Game is no longer in progress";

type TurnKind = "guess" | "hint" | "giveup";

export type GuessResult = {
  message?: string;
  lemma?: string;
  distance?: number;
  won: boolean;
  alreadyGuessed?: true;
  unlockedAchievementIds: AchievementId[];
};

type ApplyResult = {
  status: "recorded" | "duplicate";
  won: boolean;
  unlockedAchievementIds: AchievementId[];
};

const turnKindValidator = v.union(
  v.literal("guess"),
  v.literal("hint"),
  v.literal("giveup"),
);

// Guesses are open to any room member; everything else is Host only.
async function authorize(
  ctx: QueryCtx | MutationCtx,
  gameId: Id<"games">,
  kind: TurnKind,
) {
  return kind === "guess"
    ? await requireMemberByGame(ctx, { gameId })
    : await requireHostByGame(ctx, { gameId });
}

// A turn may resolve a Pending request only if it is still pending, belongs
// to this Game, and asks for this kind of turn.
async function requirePendingRequest(
  ctx: QueryCtx | MutationCtx,
  gameId: Id<"games">,
  kind: TurnKind,
  requestId: Id<"pendingRequests"> | undefined,
): Promise<Doc<"pendingRequests"> | null> {
  if (requestId === undefined) return null;
  const req = await ctx.db.get("pendingRequests", requestId);
  if (
    req === null ||
    req.status !== "pending" ||
    req.gameId !== gameId ||
    req.type !== kind
  ) {
    throw new ConvexError(REQUEST_HANDLED_MESSAGE);
  }
  return req;
}

export const _prepare = internalQuery({
  args: {
    gameId: v.id("games"),
    kind: turnKindValidator,
    requestId: v.optional(v.id("pendingRequests")),
  },
  handler: async (ctx, { gameId, kind, requestId }) => {
    const { game } = await authorize(ctx, gameId, kind);
    await requirePendingRequest(ctx, gameId, kind, requestId);
    if (game.status !== "in_progress") {
      throw new ConvexError(NOT_IN_PROGRESS_MESSAGE);
    }
    let best: number | null = null;
    if (kind === "hint") {
      const closest = await ctx.db
        .query("gameGuesses")
        .withIndex("by_game_distance", (q) => q.eq("gameId", gameId))
        .order("asc")
        .first();
      best = closest?.distance ?? null;
    }
    return { contextoGameId: game.contextoGameId, best };
  },
});

export const _apply = internalMutation({
  args: {
    gameId: v.id("games"),
    turn: v.union(
      v.object({
        kind: v.literal("guess"),
        lemma: v.string(),
        distance: v.number(),
      }),
      v.object({
        kind: v.literal("hint"),
        lemma: v.string(),
        distance: v.number(),
      }),
      v.object({ kind: v.literal("giveup"), answerLemma: v.string() }),
    ),
    requestId: v.optional(v.id("pendingRequests")),
  },
  handler: async (ctx, { gameId, turn, requestId }): Promise<ApplyResult> => {
    const { userId, game } = await authorize(ctx, gameId, turn.kind);
    const request = await requirePendingRequest(
      ctx,
      gameId,
      turn.kind,
      requestId,
    );
    const outcome =
      turn.kind === "giveup"
        ? await applyGiveup(ctx, game, turn.answerLemma, userId)
        : await applyScoredLemma(ctx, game, {
            // An approved hint belongs to the member who asked for it.
            userId: request?.requesterUserId ?? userId,
            lemma: turn.lemma,
            distance: turn.distance,
            source: turn.kind,
          });
    if (turn.kind === "hint" && outcome.status === "recorded") {
      await track(ctx, userId, {
        name: "hint_given",
        properties: { game_id: gameId, source: request ? "request" : "host" },
      });
    }
    if (request !== null && outcome.status === "recorded") {
      await ctx.db.patch("pendingRequests", request._id, {
        status: "approved",
      });
      await track(ctx, userId, {
        name: "request_approved",
        properties: {
          request_id: request._id,
          game_id: gameId,
          request_type: request.type,
        },
      });
    }
    return outcome;
  },
});

async function applyScoredLemma(
  ctx: MutationCtx,
  game: Doc<"games">,
  event: {
    userId: Id<"users">;
    lemma: string;
    distance: number;
    source: "guess" | "hint";
  },
): Promise<ApplyResult> {
  const existingGuess = await ctx.db
    .query("gameGuesses")
    .withIndex("by_game_lemma", (q) =>
      q.eq("gameId", game._id).eq("lemma", event.lemma),
    )
    .unique();
  const decision = decideGuess({ game, existingGuess, now: Date.now() }, event);
  if (decision.kind === "reject") {
    if (decision.reason === "not_in_progress") {
      throw new ConvexError(NOT_IN_PROGRESS_MESSAGE);
    }
    await track(ctx, event.userId, {
      name: "guess_recorded",
      properties: {
        game_id: game._id,
        lemma: event.lemma,
        distance: event.distance,
        duplicate: true,
        source: event.source,
      },
    });
    return { status: "duplicate", won: false, unlockedAchievementIds: [] };
  }

  await ctx.db.insert("gameGuesses", decision.insertGuess);
  if (decision.gamePatch !== null) {
    await ctx.db.patch("games", game._id, decision.gamePatch);
  }
  await upsertRoomActivity(ctx, game.roomId, decision.lastActivityAt);
  await upsertHistory(
    ctx,
    decision.upsertHistoryForUserId,
    game.contextoGameId,
  );
  const unlockedAchievementIds = await recordAcceptedGuessForAchievements(ctx, {
    gameId: game._id,
    contextoGameId: game.contextoGameId,
    userId: event.userId,
    distance: event.distance,
    source: event.source,
    won: decision.won,
    now: decision.lastActivityAt,
  });
  if (decision.won) {
    await recordGuestGameCompletion(ctx, game._id);
  }
  await track(ctx, event.userId, {
    name: "guess_recorded",
    properties: {
      game_id: game._id,
      lemma: event.lemma,
      distance: event.distance,
      duplicate: false,
      source: event.source,
    },
  });
  if (decision.won) {
    await scheduleGameOutcome(
      ctx,
      game,
      event.userId,
      "game_won",
      decision.lastActivityAt,
    );
  }
  return { status: "recorded", won: decision.won, unlockedAchievementIds };
}

async function applyGiveup(
  ctx: MutationCtx,
  game: Doc<"games">,
  answerLemma: string,
  userId: Id<"users">,
): Promise<ApplyResult> {
  const decision = decideGiveup({ game, now: Date.now() }, { answerLemma });
  if (decision.kind === "reject") {
    throw new ConvexError(NOT_IN_PROGRESS_MESSAGE);
  }
  await ctx.db.patch("games", game._id, decision.gamePatch);
  await upsertRoomActivity(ctx, game.roomId, decision.lastActivityAt);
  await recordGuestGameCompletion(ctx, game._id);
  await scheduleGameOutcome(
    ctx,
    game,
    userId,
    "game_given_up",
    decision.lastActivityAt,
  );
  return { status: "recorded", won: false, unlockedAchievementIds: [] };
}

async function scheduleGameOutcome(
  ctx: MutationCtx,
  game: Doc<"games">,
  userId: Id<"users">,
  event: "game_won" | "game_given_up",
  endedAt: number,
) {
  if (!analyticsEnabled()) return;
  // Counted here, not in the action, so later joins and leaves don't skew it.
  // Capped like playAgain's Room size limit; 101 means "over 100".
  const members = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) => q.eq("roomId", game.roomId))
    .take(101);
  try {
    await ctx.scheduler.runAfter(0, internal.turns._trackGameOutcome, {
      gameId: game._id,
      userId,
      event,
      durationMs: Math.max(0, endedAt - game.startedAt),
      memberCount: members.filter((member) => member.active !== false).length,
    });
  } catch (error) {
    console.warn("Game outcome analytics could not be scheduled", error);
  }
}

export const _outcomeCounts = internalQuery({
  args: { gameId: v.id("games"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { gameId, paginationOpts }) => {
    const page = await ctx.db
      .query("gameGuesses")
      .withIndex("by_game_created", (q) => q.eq("gameId", gameId))
      .paginate(paginationOpts);
    return {
      guessCount: page.page.filter((guess) => guess.source === "guess").length,
      hintCount: page.page.filter((guess) => guess.source === "hint").length,
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const _trackGameOutcome = internalAction({
  args: {
    gameId: v.id("games"),
    userId: v.id("users"),
    event: v.union(v.literal("game_won"), v.literal("game_given_up")),
    durationMs: v.number(),
    memberCount: v.number(),
  },
  handler: async (ctx, { gameId, userId, event, durationMs, memberCount }) => {
    let guessCount = 0;
    let hintCount = 0;
    let cursor: string | null = null;
    while (true) {
      const page: {
        guessCount: number;
        hintCount: number;
        isDone: boolean;
        continueCursor: string;
      } = await ctx.runQuery(internal.turns._outcomeCounts, {
        gameId,
        paginationOpts: { cursor, numItems: 1000 },
      });
      guessCount += page.guessCount;
      hintCount += page.hintCount;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    await track(ctx, userId, {
      name: event,
      properties: {
        game_id: gameId,
        guess_count: guessCount,
        hint_count: hintCount,
        member_count: memberCount,
        duration_ms: durationMs,
      },
    });
  },
});

type TurnArgs =
  | { gameId: Id<"games">; turn: { kind: "guess"; word: string } }
  | {
      gameId: Id<"games">;
      turn: { kind: "hint" | "giveup" };
      requestId?: Id<"pendingRequests">;
    };

// Performs turn `turn` on Game `gameId` for the calling user, optionally
// resolving Pending request `requestId`.
export async function performTurn(
  ctx: ActionCtx,
  args: {
    gameId: Id<"games">;
    turn: { kind: "guess"; word: string };
  },
): Promise<GuessResult>;
export async function performTurn(
  ctx: ActionCtx,
  args: {
    gameId: Id<"games">;
    turn: { kind: "hint" };
    requestId?: Id<"pendingRequests">;
  },
): Promise<ScoredLemma>;
export async function performTurn(
  ctx: ActionCtx,
  args: {
    gameId: Id<"games">;
    turn: { kind: "giveup" };
    requestId?: Id<"pendingRequests">;
  },
): Promise<{ lemma: string }>;
export async function performTurn(
  ctx: ActionCtx,
  args: TurnArgs,
): Promise<GuessResult | ScoredLemma | { lemma: string }> {
  const { gameId, turn } = args;
  const requestId = "requestId" in args ? args.requestId : undefined;
  const pre: { contextoGameId: number; best: number | null } =
    await ctx.runQuery(internal.turns._prepare, {
      gameId,
      kind: turn.kind,
      requestId,
    });
  const oracle = puzzleWordOracle(ctx, pre.contextoGameId);
  switch (turn.kind) {
    case "guess":
      return await performGuess(ctx, gameId, oracle, turn.word);
    case "hint":
      return await performHint(ctx, gameId, oracle, pre.best, requestId);
    case "giveup": {
      const answer = await oracle.answer();
      await ctx.runMutation(internal.turns._apply, {
        gameId,
        turn: { kind: "giveup", answerLemma: answer.lemma },
        requestId,
      });
      return answer;
    }
  }
}

type PuzzleWordOracle = ReturnType<typeof puzzleWordOracle>;

async function performGuess(
  ctx: ActionCtx,
  gameId: Id<"games">,
  oracle: PuzzleWordOracle,
  word: string,
): Promise<GuessResult> {
  const input = word.trim().toLowerCase();
  if (input.length === 0) throw new ConvexError("Empty word");
  const scored = await oracle.distance(input);
  if (!scored.ok) {
    return { message: scored.error, won: false, unlockedAchievementIds: [] };
  }
  const { lemma, distance } = scored;
  const result: ApplyResult = await ctx.runMutation(internal.turns._apply, {
    gameId,
    turn: { kind: "guess", lemma, distance },
  });
  if (result.status === "duplicate") {
    return {
      lemma,
      distance,
      won: false,
      alreadyGuessed: true,
      message: ALREADY_GUESSED_MESSAGE,
      unlockedAchievementIds: [],
    };
  }
  return {
    lemma,
    distance,
    won: result.won,
    unlockedAchievementIds: result.unlockedAchievementIds,
  };
}

// Asks for a tip halfway to the best distance. When the best guess is already
// at distance 1, walks outward from 2 until it finds an unguessed lemma.
async function performHint(
  ctx: ActionCtx,
  gameId: Id<"games">,
  oracle: PuzzleWordOracle,
  best: number | null,
  requestId: Id<"pendingRequests"> | undefined,
): Promise<ScoredLemma> {
  let target = initialHintTarget(best);
  const walking = best === 1;
  for (let i = 0; i < MAX_WALK_ITERATIONS; i++) {
    const tip = await oracle.tip(target);
    const result: ApplyResult = await ctx.runMutation(internal.turns._apply, {
      gameId,
      turn: { kind: "hint", lemma: tip.lemma, distance: tip.distance },
      requestId,
    });
    if (result.status === "recorded") return tip;
    if (!walking) throw new ConvexError("Hint lemma already guessed");
    target += 1;
  }
  throw new ConvexError("Could not find an unguessed hint");
}

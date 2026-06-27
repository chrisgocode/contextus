import type { Id } from "../_generated/dataModel";
import {
  type CounterRuleId,
  type EventRuleContext,
  evaluateCounterRules,
  matchingEventRules,
} from "./achievementRules";

export type AchievementId =
  | "youll_get_there"
  | "getting_warmer"
  | "hot_on_the_trail"
  | "bullseye"
  | "word_explorer"
  | "on_a_roll"
  | "sharp_mind"
  | "habit_formed"
  | "linguist"
  | "lucky_shot"
  | "it_happens"
  | "the_mellow_yellow"
  | "green_thumb"
  | "scorching_hot"
  | "mind_reader"
  | "unstoppable"
  | "lexicon_master"
  | "really"
  | "lukewarm"
  | "green_machine"
  | "no_backtracking"
  | "psychic"
  | "century_club"
  | "one_and_done"
  | "dictionary_incarnate"
  | "skill_issue"
  | "close_enough"
  | "flow_state"
  | "so_close"
  | "rabbit_hole"
  | "night_owl"
  | "early_bird"
  | "comeback_kid";

export type AchievementDefinition = {
  id: AchievementId;
  target: number;
  hidden: boolean;
  active: boolean;
};

export const achievementDefinitions: AchievementDefinition[] = [
  { id: "youll_get_there", target: 1, hidden: false, active: true },
  { id: "getting_warmer", target: 1, hidden: false, active: true },
  { id: "hot_on_the_trail", target: 1, hidden: false, active: true },
  { id: "bullseye", target: 1, hidden: false, active: true },
  { id: "word_explorer", target: 10, hidden: false, active: true },
  { id: "on_a_roll", target: 3, hidden: false, active: false },
  { id: "sharp_mind", target: 1, hidden: false, active: true },
  { id: "habit_formed", target: 7, hidden: false, active: false },
  { id: "linguist", target: 50, hidden: false, active: true },
  { id: "lucky_shot", target: 1, hidden: false, active: true },
  { id: "it_happens", target: 250, hidden: false, active: true },
  { id: "the_mellow_yellow", target: 100, hidden: false, active: true },
  { id: "green_thumb", target: 50, hidden: false, active: true },
  { id: "scorching_hot", target: 1, hidden: false, active: true },
  { id: "mind_reader", target: 1, hidden: false, active: true },
  { id: "unstoppable", target: 15, hidden: false, active: false },
  { id: "lexicon_master", target: 100, hidden: false, active: true },
  { id: "really", target: 1000, hidden: false, active: true },
  { id: "lukewarm", target: 500, hidden: false, active: true },
  { id: "green_machine", target: 250, hidden: false, active: true },
  { id: "no_backtracking", target: 1, hidden: false, active: true },
  { id: "psychic", target: 1, hidden: false, active: true },
  { id: "century_club", target: 30, hidden: false, active: false },
  { id: "one_and_done", target: 1, hidden: false, active: true },
  { id: "dictionary_incarnate", target: 250, hidden: false, active: true },
  { id: "skill_issue", target: 5000, hidden: false, active: true },
  { id: "close_enough", target: 2500, hidden: false, active: true },
  { id: "flow_state", target: 1000, hidden: false, active: true },
  { id: "so_close", target: 1, hidden: true, active: true },
  { id: "rabbit_hole", target: 50, hidden: true, active: true },
  { id: "night_owl", target: 1, hidden: true, active: false },
  { id: "early_bird", target: 1, hidden: true, active: false },
  { id: "comeback_kid", target: 1, hidden: true, active: true },
];

const definitionById = new Map(achievementDefinitions.map((d) => [d.id, d]));

type ColorBucket = "green" | "yellow" | "red";

export function classifyDistance(distance: number): ColorBucket {
  if (distance <= 300) return "green";
  if (distance <= 1500) return "yellow";
  return "red";
}

export type AchievementStats = {
  redGuesses: number;
  yellowGuesses: number;
  greenGuesses: number;
  uniqueSolves: number;
};

export type GamePlayerStats = {
  realGuessCount: number;
  bestDistance: number;
  lastDistance: number;
  noBacktrackingSoFar: boolean;
};

export type UserGameHistoryState = {
  firstAttemptAt?: number;
  firstAttemptDistance?: number;
  firstSolvedAt?: number;
};

export type AcceptedGuessEvent = {
  gameId: Id<"games">;
  contextoGameId: number;
  userId: Id<"users">;
  distance: number;
  source: "guess" | "hint";
  won: boolean;
  now: number;
};

export type AchievementRepository = {
  getOrCreateStats(userId: Id<"users">): Promise<AchievementStats>;
  saveStats(userId: Id<"users">, stats: AchievementStats): Promise<void>;
  updateProgress(
    userId: Id<"users">,
    achievementId: AchievementId,
    current: number,
    target: number,
    hidden: boolean,
    now: number,
  ): Promise<void>;
  unlock(
    userId: Id<"users">,
    achievementId: AchievementId,
    now: number,
  ): Promise<boolean>;
  recordRealGuess(event: AcceptedGuessEvent): Promise<{
    playerStats: GamePlayerStats;
    history: UserGameHistoryState;
    isFirstEverAttemptForPuzzle: boolean;
  }>;
  listActiveGuessers(gameId: Id<"games">): Promise<Id<"users">[]>;
  markSolvedOnce(
    userId: Id<"users">,
    gameId: Id<"games">,
    contextoGameId: number,
    now: number,
  ): Promise<boolean>;
  countTeamRealGuesses(gameId: Id<"games">): Promise<number>;
};

export function createAchievementService(deps: {
  repo: AchievementRepository;
  definitions?: AchievementDefinition[];
  classify?: (distance: number) => ColorBucket;
}) {
  const definitions = deps.definitions ?? achievementDefinitions;
  const definitionMap = new Map(definitions.map((d) => [d.id, d]));
  const classify = deps.classify ?? classifyDistance;

  async function updateProgress(
    userId: Id<"users">,
    achievementId: AchievementId,
    current: number,
    now: number,
  ) {
    const definition = definitionMap.get(achievementId);
    if (definition === undefined) return;
    await deps.repo.updateProgress(
      userId,
      achievementId,
      current,
      definition.target,
      definition.hidden,
      now,
    );
  }

  function isActiveAchievement(achievementId: AchievementId): boolean {
    return definitionMap.get(achievementId)?.active === true;
  }

  async function unlock(
    userId: Id<"users">,
    achievementId: AchievementId,
    now: number,
  ) {
    const definition = definitionMap.get(achievementId);
    if (definition === undefined || !definition.active) return false;
    return await deps.repo.unlock(userId, achievementId, now);
  }

  async function recordAcceptedGuess(event: AcceptedGuessEvent) {
    const newlyUnlockedAchievementIds: AchievementId[] = [];
    const unlockForUser = async (
      userId: Id<"users">,
      achievementId: AchievementId,
      now: number,
    ) => {
      const unlocked = await unlock(userId, achievementId, now);
      if (unlocked && userId === event.userId) {
        newlyUnlockedAchievementIds.push(achievementId);
      }
    };

    if (event.source !== "guess") return newlyUnlockedAchievementIds;

    const { playerStats, history, isFirstEverAttemptForPuzzle } =
      await deps.repo.recordRealGuess(event);
    await applyColorAchievements(
      event.userId,
      event.distance,
      event.now,
      unlockForUser,
    );
    await applyCounterRules(
      event.userId,
      "gameRealGuesses",
      playerStats.realGuessCount,
      event.now,
      unlockForUser,
    );

    let teamGuessCount: number | null = null;
    if (event.won) {
      const activeGuessers = await deps.repo.listActiveGuessers(event.gameId);
      teamGuessCount = await deps.repo.countTeamRealGuesses(event.gameId);
      for (const participantUserId of activeGuessers) {
        const isNewSolve = await deps.repo.markSolvedOnce(
          participantUserId,
          event.gameId,
          event.contextoGameId,
          event.now,
        );
        if (isNewSolve) {
          await applySolveTotals(participantUserId, event.now, unlockForUser);
        }
      }
    }
    await applyEventRules(
      event.userId,
      {
        distance: event.distance,
        hasSolvedPuzzleBefore: history.firstSolvedAt !== undefined,
        isFirstEverAttemptForPuzzle,
        playerStats,
        teamGuessCount,
        won: event.won,
      },
      event.now,
      unlockForUser,
    );
    return newlyUnlockedAchievementIds;
  }

  async function applyColorAchievements(
    userId: Id<"users">,
    distance: number,
    now: number,
    unlockForUser: (
      userId: Id<"users">,
      achievementId: AchievementId,
      now: number,
    ) => Promise<void>,
  ) {
    const stats = await deps.repo.getOrCreateStats(userId);
    const bucket = classify(distance);
    if (bucket === "red") {
      stats.redGuesses += 1;
      await applyCounterRules(
        userId,
        "redGuesses",
        stats.redGuesses,
        now,
        unlockForUser,
      );
    } else if (bucket === "yellow") {
      stats.yellowGuesses += 1;
      await applyCounterRules(
        userId,
        "yellowGuesses",
        stats.yellowGuesses,
        now,
        unlockForUser,
      );
    } else {
      stats.greenGuesses += 1;
      await applyCounterRules(
        userId,
        "greenGuesses",
        stats.greenGuesses,
        now,
        unlockForUser,
      );
    }
    await deps.repo.saveStats(userId, stats);
  }

  async function applySolveTotals(
    userId: Id<"users">,
    now: number,
    unlockForUser: (
      userId: Id<"users">,
      achievementId: AchievementId,
      now: number,
    ) => Promise<void>,
  ) {
    const stats = await deps.repo.getOrCreateStats(userId);
    stats.uniqueSolves += 1;
    await deps.repo.saveStats(userId, stats);
    await applyCounterRules(
      userId,
      "uniqueSolves",
      stats.uniqueSolves,
      now,
      unlockForUser,
    );
  }

  async function applyCounterRules(
    userId: Id<"users">,
    counterId: CounterRuleId,
    value: number,
    now: number,
    unlockForUser: (
      userId: Id<"users">,
      achievementId: AchievementId,
      now: number,
    ) => Promise<void>,
  ) {
    for (const rule of evaluateCounterRules(counterId, value)) {
      if (!isActiveAchievement(rule.achievementId)) continue;
      await updateProgress(userId, rule.achievementId, value, now);
      if (rule.shouldUnlock) {
        await unlockForUser(userId, rule.achievementId, now);
      }
    }
  }

  async function applyEventRules(
    userId: Id<"users">,
    context: EventRuleContext,
    now: number,
    unlockForUser: (
      userId: Id<"users">,
      achievementId: AchievementId,
      now: number,
    ) => Promise<void>,
  ) {
    for (const rule of matchingEventRules(context)) {
      if (!isActiveAchievement(rule.achievementId)) continue;
      await updateProgress(userId, rule.achievementId, rule.progress, now);
      await unlockForUser(userId, rule.achievementId, now);
    }
  }

  return { recordAcceptedGuess };
}

export function getAchievementDefinition(achievementId: AchievementId) {
  return definitionById.get(achievementId) ?? null;
}

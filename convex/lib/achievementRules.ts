import type { AchievementId, GamePlayerStats } from "./achievements";

export type CounterRuleId =
	| "redGuesses"
	| "yellowGuesses"
	| "greenGuesses"
	| "uniqueSolves"
	| "gameRealGuesses";

export type CounterAchievementRule = {
	counterId: CounterRuleId;
	achievementId: AchievementId;
	threshold: number;
};

export const counterAchievementRules = [
	{ counterId: "redGuesses", achievementId: "youll_get_there", threshold: 1 },
	{ counterId: "redGuesses", achievementId: "it_happens", threshold: 250 },
	{ counterId: "redGuesses", achievementId: "really", threshold: 1000 },
	{ counterId: "redGuesses", achievementId: "skill_issue", threshold: 5000 },
	{
		counterId: "yellowGuesses",
		achievementId: "getting_warmer",
		threshold: 1,
	},
	{
		counterId: "yellowGuesses",
		achievementId: "the_mellow_yellow",
		threshold: 100,
	},
	{ counterId: "yellowGuesses", achievementId: "lukewarm", threshold: 500 },
	{
		counterId: "yellowGuesses",
		achievementId: "close_enough",
		threshold: 2500,
	},
	{
		counterId: "greenGuesses",
		achievementId: "hot_on_the_trail",
		threshold: 1,
	},
	{ counterId: "greenGuesses", achievementId: "green_thumb", threshold: 50 },
	{
		counterId: "greenGuesses",
		achievementId: "green_machine",
		threshold: 250,
	},
	{ counterId: "greenGuesses", achievementId: "flow_state", threshold: 1000 },
	{ counterId: "uniqueSolves", achievementId: "bullseye", threshold: 1 },
	{ counterId: "uniqueSolves", achievementId: "word_explorer", threshold: 10 },
	{ counterId: "uniqueSolves", achievementId: "linguist", threshold: 50 },
	{
		counterId: "uniqueSolves",
		achievementId: "lexicon_master",
		threshold: 100,
	},
	{
		counterId: "uniqueSolves",
		achievementId: "dictionary_incarnate",
		threshold: 250,
	},
	{ counterId: "gameRealGuesses", achievementId: "rabbit_hole", threshold: 50 },
] satisfies CounterAchievementRule[];

export type EventRuleContext = {
	distance: number;
	hasSolvedPuzzleBefore: boolean;
	isFirstEverAttemptForPuzzle: boolean;
	playerStats: GamePlayerStats;
	teamGuessCount: number | null;
	won: boolean;
};

export type EventPredicateId =
	| "firstEverAttemptAndGreen"
	| "firstEverAttemptAndTop10"
	| "firstEverAttemptAndSecondClosest"
	| "firstEverAttemptAndWon"
	| "winnerTeamGuessesUnder50"
	| "winnerTeamGuessesUnder25"
	| "winnerTeamGuessesUnder5"
	| "wonAfterMoreThan100OwnGuesses"
	| "wonWithNoBacktracking";

export const eventPredicates = {
	firstEverAttemptAndGreen: (ctx: EventRuleContext) =>
		ctx.isFirstEverAttemptForPuzzle && ctx.distance <= 300,
	firstEverAttemptAndTop10: (ctx: EventRuleContext) =>
		ctx.isFirstEverAttemptForPuzzle && ctx.distance <= 10,
	firstEverAttemptAndSecondClosest: (ctx: EventRuleContext) =>
		ctx.isFirstEverAttemptForPuzzle && ctx.distance === 1,
	firstEverAttemptAndWon: (ctx: EventRuleContext) =>
		ctx.won &&
		!ctx.hasSolvedPuzzleBefore &&
		ctx.isFirstEverAttemptForPuzzle &&
		ctx.playerStats.realGuessCount === 1,
	winnerTeamGuessesUnder50: (ctx: EventRuleContext) =>
		ctx.won && ctx.teamGuessCount !== null && ctx.teamGuessCount < 50,
	winnerTeamGuessesUnder25: (ctx: EventRuleContext) =>
		ctx.won && ctx.teamGuessCount !== null && ctx.teamGuessCount < 25,
	winnerTeamGuessesUnder5: (ctx: EventRuleContext) =>
		ctx.won && ctx.teamGuessCount !== null && ctx.teamGuessCount < 5,
	wonAfterMoreThan100OwnGuesses: (ctx: EventRuleContext) =>
		ctx.won && ctx.playerStats.realGuessCount > 100,
	wonWithNoBacktracking: (ctx: EventRuleContext) =>
		ctx.won &&
		ctx.playerStats.realGuessCount >= 2 &&
		ctx.playerStats.noBacktrackingSoFar,
} satisfies Record<EventPredicateId, (ctx: EventRuleContext) => boolean>;

export type EventAchievementRule = {
	achievementId: AchievementId;
	predicateId: EventPredicateId;
	progress: number;
};

export const eventAchievementRules = [
	{
		achievementId: "lucky_shot",
		predicateId: "firstEverAttemptAndGreen",
		progress: 1,
	},
	{
		achievementId: "scorching_hot",
		predicateId: "firstEverAttemptAndTop10",
		progress: 1,
	},
	{
		achievementId: "so_close",
		predicateId: "firstEverAttemptAndSecondClosest",
		progress: 1,
	},
	{
		achievementId: "one_and_done",
		predicateId: "firstEverAttemptAndWon",
		progress: 1,
	},
	{
		achievementId: "sharp_mind",
		predicateId: "winnerTeamGuessesUnder50",
		progress: 1,
	},
	{
		achievementId: "mind_reader",
		predicateId: "winnerTeamGuessesUnder25",
		progress: 1,
	},
	{
		achievementId: "psychic",
		predicateId: "winnerTeamGuessesUnder5",
		progress: 1,
	},
	{
		achievementId: "comeback_kid",
		predicateId: "wonAfterMoreThan100OwnGuesses",
		progress: 1,
	},
	{
		achievementId: "no_backtracking",
		predicateId: "wonWithNoBacktracking",
		progress: 1,
	},
] satisfies EventAchievementRule[];

export function counterRulesFor(
	counterId: CounterRuleId,
): CounterAchievementRule[] {
	return counterAchievementRules.filter((rule) => rule.counterId === counterId);
}

export type CounterRuleEvaluation = CounterAchievementRule & {
	shouldUnlock: boolean;
};

export function evaluateCounterRules(
	counterId: CounterRuleId,
	value: number,
): CounterRuleEvaluation[] {
	return counterRulesFor(counterId).map((rule) => ({
		...rule,
		shouldUnlock: value >= rule.threshold,
	}));
}

export function matchingEventRules(
	context: EventRuleContext,
): EventAchievementRule[] {
	return eventAchievementRules.filter((rule) =>
		eventPredicates[rule.predicateId](context),
	);
}

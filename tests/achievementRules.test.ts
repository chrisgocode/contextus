import { expect, test } from "vitest";
import {
	evaluateCounterRules,
	matchingEventRules,
	type EventRuleContext,
} from "../convex/lib/achievementRules";

const baseContext: EventRuleContext = {
	distance: 2000,
	hasSolvedPuzzleBefore: false,
	isFirstEverAttemptForPuzzle: false,
	playerStats: {
		realGuessCount: 1,
		bestDistance: 2000,
		lastDistance: 2000,
		noBacktrackingSoFar: true,
	},
	teamGuessCount: null,
	won: false,
};

test("counter rules evaluate every achievement in a family", () => {
	const rules = evaluateCounterRules("redGuesses", 250);

	expect(rules.map((rule) => rule.achievementId)).toEqual([
		"youll_get_there",
		"it_happens",
		"really",
		"skill_issue",
	]);
	expect(rules.map((rule) => rule.shouldUnlock)).toEqual([
		true,
		true,
		false,
		false,
	]);
});

test("counter rules unlock at threshold boundaries", () => {
	const below = evaluateCounterRules("uniqueSolves", 9);
	const atThreshold = evaluateCounterRules("uniqueSolves", 10);

	expect(
		below.find((rule) => rule.achievementId === "word_explorer")
			?.shouldUnlock,
	).toBe(false);
	expect(
		atThreshold.find((rule) => rule.achievementId === "word_explorer")
			?.shouldUnlock,
	).toBe(true);
});

test("first-attempt event predicates match only true one-shot rules", () => {
	const rules = matchingEventRules({
		...baseContext,
		distance: 1,
		isFirstEverAttemptForPuzzle: true,
	});

	expect(rules.map((rule) => rule.achievementId)).toEqual([
		"lucky_shot",
		"scorching_hot",
		"so_close",
	]);
});

test("winning event predicates match winner-only one-shot rules", () => {
	const rules = matchingEventRules({
		...baseContext,
		distance: 0,
		playerStats: {
			realGuessCount: 3,
			bestDistance: 0,
			lastDistance: 0,
			noBacktrackingSoFar: true,
		},
		teamGuessCount: 3,
		won: true,
	});

	expect(rules.map((rule) => rule.achievementId)).toEqual([
		"sharp_mind",
		"mind_reader",
		"psychic",
		"no_backtracking",
	]);
});

test("event predicates do not match when conditions are false", () => {
	const rules = matchingEventRules({
		...baseContext,
		distance: 1,
		hasSolvedPuzzleBefore: true,
		isFirstEverAttemptForPuzzle: false,
		playerStats: {
			realGuessCount: 1,
			bestDistance: 1,
			lastDistance: 1,
			noBacktrackingSoFar: true,
		},
		teamGuessCount: null,
		won: true,
	});

	expect(rules).toEqual([]);
});

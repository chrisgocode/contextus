import type { StaticImageData } from "next/image";
import bronzeTrophy from "@/assets/bronze-trophy.svg";
import diamondTrophy from "@/assets/diamond-trophy.svg";
import goldTrophy from "@/assets/gold-trophy.svg";
import hiddenAchievement from "@/assets/hidden-achievement.svg";
import obsidianTrophy from "@/assets/obsidian-trophy.svg";
import silverTrophy from "@/assets/silver-trophy.svg";

export type AchievementCategory =
	| "bronze"
	| "silver"
	| "gold"
	| "diamond"
	| "hidden";

export type Achievement = {
	id: string;
	category: AchievementCategory;
	name: string;
	description: string;
};

export const achievements = [
	{
		id: "youll_get_there",
		category: "bronze",
		name: "You'll Get There",
		description: "Make your first red guess.",
	},
	{
		id: "getting_warmer",
		category: "bronze",
		name: "Getting Warmer",
		description: "Make your first yellow guess.",
	},
	{
		id: "hot_on_the_trail",
		category: "bronze",
		name: "Hot on the Trail",
		description: "Make your first green guess.",
	},
	{
		id: "bullseye",
		category: "bronze",
		name: "Bullseye",
		description: "Solve your first puzzle.",
	},
	{
		id: "word_explorer",
		category: "bronze",
		name: "Word Explorer",
		description: "Solve 10 puzzles.",
	},
	{
		id: "on_a_roll",
		category: "bronze",
		name: "On a Roll",
		description: "Maintain a 3-day streak.",
	},
	{
		id: "sharp_mind",
		category: "silver",
		name: "Sharp Mind",
		description: "Solve a puzzle in under 50 guesses.",
	},
	{
		id: "habit_formed",
		category: "silver",
		name: "Habit Formed",
		description: "Maintain a 7-day streak.",
	},
	{
		id: "linguist",
		category: "silver",
		name: "Linguist",
		description: "Solve 50 puzzles.",
	},
	{
		id: "lucky_shot",
		category: "silver",
		name: "Lucky Shot",
		description: "Your first guess lands in the green.",
	},
	{
		id: "it_happens",
		category: "silver",
		name: "It Happens",
		description: "Guess in the red 250 times.",
	},
	{
		id: "the_mellow_yellow",
		category: "silver",
		name: "The Mellow Yellow",
		description: "Guess in the yellow 100 times.",
	},
	{
		id: "green_thumb",
		category: "silver",
		name: "Green Thumb",
		description: "Guess in the green 50 times.",
	},
	{
		id: "scorching_hot",
		category: "silver",
		name: "Scorching Hot",
		description: "Guess a word within the closest 10 on your first try.",
	},
	{
		id: "mind_reader",
		category: "gold",
		name: "Mind Reader",
		description: "Solve a puzzle in under 25 guesses.",
	},
	{
		id: "unstoppable",
		category: "gold",
		name: "Unstoppable",
		description: "Maintain a 15-day streak.",
	},
	{
		id: "lexicon_master",
		category: "gold",
		name: "Lexicon Master",
		description: "Solve 100 puzzles.",
	},
	{
		id: "really",
		category: "gold",
		name: "Really?",
		description: "Guess in the red 1000 times.",
	},
	{
		id: "lukewarm",
		category: "gold",
		name: "Lukewarm",
		description: "Guess in the yellow 500 times.",
	},
	{
		id: "green_machine",
		category: "gold",
		name: "Green Machine",
		description: "Make 250 green guesses.",
	},
	{
		id: "no_backtracking",
		category: "gold",
		name: "No Backtracking",
		description: "Every guess was better than the last",
	},
	{
		id: "psychic",
		category: "diamond",
		name: "Psychic",
		description: "Solve a puzzle in under 5 guesses.",
	},
	{
		id: "century_club",
		category: "diamond",
		name: "Century Club",
		description: "Reach a 30-day streak.",
	},
	{
		id: "one_and_done",
		category: "diamond",
		name: "One and Done",
		description: "Solve a puzzle on your first guess.",
	},
	{
		id: "dictionary_incarnate",
		category: "diamond",
		name: "Dictionary Incarnate",
		description: "Solve 500 puzzles.",
	},
	{
		id: "skill_issue",
		category: "diamond",
		name: "Skill Issue",
		description: "Guess in the red 5000 times.",
	},
	{
		id: "lukewarm",
		category: "diamond",
		name: "Close Enough",
		description: "Guess in the yellow 2500 times.",
	},
	{
		id: "flow_state",
		category: "diamond",
		name: "Flow State",
		description: "Make 1000 green guesses.",
	},
	{
		id: "so_close",
		category: "hidden",
		name: "So Close...",
		description: "Guess the second closest word on your first try.",
	},
	{
		id: "rabbit_hole",
		category: "hidden",
		name: "Rabbit Hole",
		description: "Make  50 guesses in a single puzzle.",
	},
	{
		id: "night_owl",
		category: "hidden",
		name: "Night Owl",
		description: "Solve a puzzle between midnight and 4 AM.",
	},
	{
		id: "early_bird",
		category: "hidden",
		name: "Early Bird",
		description: "Solve a puzzle within 10 minutes of its release.",
	},
	{
		id: "comeback_kid",
		category: "hidden",
		name: "Comeback Kid",
		description: "Solve a puzzle after making more than 100 guesses.",
	},
] satisfies Achievement[];

export const achievementGroups: Array<{
	category: AchievementCategory;
	label: string;
	image: StaticImageData;
	unlockedImage?: StaticImageData;
	badgeClassName: string;
}> = [
	{
		category: "bronze",
		label: "Bronze",
		image: bronzeTrophy,
		badgeClassName:
			"border-orange-900/40 bg-orange-900/80 text-orange-50 dark:border-orange-300/30 dark:bg-orange-300/20 dark:text-orange-100",
	},
	{
		category: "silver",
		label: "Silver",
		image: silverTrophy,
		badgeClassName:
			"border-slate-700/40 bg-slate-700/80 text-slate-50 dark:border-slate-300/30 dark:bg-slate-300/20 dark:text-slate-100",
	},
	{
		category: "gold",
		label: "Gold",
		image: goldTrophy,
		badgeClassName:
			"border-yellow-700/40 bg-yellow-700/80 text-yellow-50 dark:border-yellow-300/30 dark:bg-yellow-300/20 dark:text-yellow-100",
	},
	{
		category: "diamond",
		label: "Diamond",
		image: diamondTrophy,
		badgeClassName:
			"border-cyan-800/40 bg-cyan-800/80 text-cyan-50 dark:border-cyan-300/30 dark:bg-cyan-300/20 dark:text-cyan-100",
	},
	{
		category: "hidden",
		label: "Hidden",
		image: hiddenAchievement,
		unlockedImage: obsidianTrophy,
		badgeClassName:
			"border-violet-900/40 bg-violet-900/80 text-violet-50 dark:border-violet-300/30 dark:bg-violet-300/20 dark:text-violet-100",
	},
];

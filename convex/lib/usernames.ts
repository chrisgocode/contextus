import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { OBJECTS, PREDICATES } from "./words";

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 20;
const USERNAME_PATTERN = /^[A-Za-z0-9]+$/;
const RANDOM_ATTEMPTS = 128;

type UserMutationCtx = Pick<MutationCtx, "db">;

export type NormalizedUsername = {
	username: string;
	displayUsername: string;
};

function titleCase(word: string): string {
	return word.slice(0, 1).toUpperCase() + word.slice(1);
}

function randomItem(words: readonly string[]): string {
	const word = words[Math.floor(Math.random() * words.length)];
	return word;
}

function randomTwoDigits(): string {
	return Math.floor(Math.random() * 100)
		.toString()
		.padStart(2, "0");
}

function randomCandidate(): NormalizedUsername | null {
	const predicate = randomItem(PREDICATES);
	const object = randomItem(OBJECTS);
	const displayUsername = `${titleCase(predicate)}${titleCase(
		object,
	)}${randomTwoDigits()}`;
	if (displayUsername.length > MAX_USERNAME_LENGTH) return null;
	return {
		username: displayUsername.toLowerCase(),
		displayUsername,
	};
}

export function normalizeUsernameInput(input: string): NormalizedUsername {
	const displayUsername = input.trim();
	if (
		displayUsername.length < MIN_USERNAME_LENGTH ||
		displayUsername.length > MAX_USERNAME_LENGTH
	) {
		throw new ConvexError(
			`Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters.`,
		);
	}
	if (!USERNAME_PATTERN.test(displayUsername)) {
		throw new ConvexError("Username can only contain letters and numbers.");
	}
	return {
		username: displayUsername.toLowerCase(),
		displayUsername,
	};
}

export async function assertUsernameAvailable(
	ctx: UserMutationCtx,
	username: string,
	currentUserId: Id<"users">,
): Promise<void> {
	const matches = await ctx.db
		.query("users")
		.withIndex("by_username", (q) => q.eq("username", username))
		.take(2);
	if (matches.some((user) => user._id !== currentUserId)) {
		throw new ConvexError("Username is already taken.");
	}
}

export async function generateUniqueUsername(
	ctx: UserMutationCtx,
	userId: Id<"users">,
): Promise<NormalizedUsername> {
	for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt++) {
		const candidate = randomCandidate();
		if (candidate === null) continue;
		const matches = await ctx.db
			.query("users")
			.withIndex("by_username", (q) => q.eq("username", candidate.username))
			.take(1);
		if (matches.length === 0 || matches[0]?._id === userId) return candidate;
	}
	throw new ConvexError("Could not generate a unique username.");
}

export async function ensureUserHasUsername(
	ctx: UserMutationCtx,
	userId: Id<"users">,
): Promise<NormalizedUsername | null> {
	const user = await ctx.db.get(userId);
	if (user === null) return null;
	if (user.username && user.displayUsername) {
		return {
			username: user.username,
			displayUsername: user.displayUsername,
		};
	}
	const generated = await generateUniqueUsername(ctx, userId);
	await ctx.db.patch(userId, generated);
	return generated;
}

"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

const COLORS = {
	green: "rgb(76 175 121)",
	yellow: "rgb(232 184 64)",
	red: "rgb(220 70 110)",
} as const;

export function EndGameBanner({
	status,
	answerLemma,
	gameId,
}: {
	status: "won" | "given_up";
	answerLemma: string | null | undefined;
	gameId: Id<"games">;
}) {
	const data = useQuery(api.guesses.listForGame, { gameId });
	const sorted = data?.sorted ?? [];
	const hintCount = sorted.filter((g) => g.source === "hint").length;
	const guessCount = sorted.length - hintCount;
	const buckets = {
		green: sorted.filter((g) => g.distance <= 300).length,
		yellow: sorted.filter((g) => g.distance > 300 && g.distance <= 1500).length,
		red: sorted.filter((g) => g.distance > 1500).length,
	};

	if (status === "given_up") {
		return (
			<section className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-6 text-center flex flex-col items-center gap-3">
				<h2 className="text-2xl font-bold">Game given up</h2>
				<p className="text-lg">
					The answer was{" "}
					<span className="font-mono font-bold">{answerLemma ?? "?"}</span>
				</p>
			</section>
		);
	}

	return (
		<section className="rounded-lg border-2 border-amber-500/60 bg-neutral-900 p-6 text-center flex flex-col items-center gap-4">
			<h2 className="text-2xl font-bold">Congrats!</h2>
			<p className="text-lg">
				{hintCount > 0 ? (
					<>
						You got it in <strong>{guessCount}</strong> guesses and{" "}
						<strong>{hintCount}</strong> hints.
					</>
				) : (
					<>
						You got it in <strong>{guessCount}</strong> guesses.
					</>
				)}
			</p>
			{sorted.length > 0 && (
				<div className="flex flex-col gap-1.5 items-start">
					<BucketRow color={COLORS.green} count={buckets.green} />
					<BucketRow color={COLORS.yellow} count={buckets.yellow} />
					<BucketRow color={COLORS.red} count={buckets.red} />
				</div>
			)}
			<p className="text-sm text-muted-foreground">
				The answer was{" "}
				<span className="font-mono font-bold">{answerLemma ?? "?"}</span>
			</p>
		</section>
	);
}

function BucketRow({ color, count }: { color: string; count: number }) {
	if (count === 0) return null;
	const blocks = Math.max(1, Math.ceil(count / 5));
	return (
		<div className="flex items-center gap-2">
			<div className="flex gap-0.5">
				{Array.from({ length: blocks }).map((_, i) => (
					<div
						key={i}
						className="h-5 w-5 rounded-sm"
						style={{ background: color }}
					/>
				))}
			</div>
			<span className="font-mono text-sm tabular-nums">{count}</span>
		</div>
	);
}

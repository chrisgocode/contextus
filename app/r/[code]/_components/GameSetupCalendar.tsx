"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
	contextoGameIdForDate,
	launchDate,
	todayLocalMidnight,
} from "@/lib/contexto";

export function GameSetupCalendar({
	roomId,
	isHost,
}: {
	roomId: Id<"rooms">;
	isHost: boolean;
}) {
	const [date, setDate] = useState<Date | undefined>(todayLocalMidnight());
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const start = useMutation(api.games.start);
	const history = useQuery(api.games.listMyHistory, {});
	const playedSet = new Set(history ?? []);

	if (!isHost) {
		return (
			<section className="rounded-lg border p-6 text-center text-muted-foreground">
				Waiting for the host to start a game.
			</section>
		);
	}

	const today = todayLocalMidnight();
	const min = launchDate();
	const gameId = date ? contextoGameIdForDate(date) : null;
	const isPlayed = (d: Date) => playedSet.has(contextoGameIdForDate(d));

	return (
		<section className="rounded-lg border p-6 flex flex-col items-center gap-4">
			<h2 className="text-lg font-semibold">Pick a Contexto puzzle</h2>
			<Calendar
				mode="single"
				selected={date}
				onSelect={setDate}
				disabled={(d) => d < min || d > today}
				defaultMonth={date}
				modifiers={{ played: isPlayed }}
				modifiersClassNames={{
					played:
						"after:pointer-events-none after:absolute after:bottom-0 after:left-1/2 after:z-[9999] after:-translate-x-1/2 after:size-1 after:rounded-full after:bg-amber-500 after:content-['']",
				}}
				classNames={{
					today:
						"rounded-full bg-muted text-foreground data-[selected=true]:bg-transparent",
				}}
			/>
			{gameId !== null && (
				<p className="text-sm text-muted-foreground">
					Game #{gameId} — {`${date!.getFullYear()}-${String(date!.getMonth() + 1).padStart(2, "0")}-${String(date!.getDate()).padStart(2, "0")}`}
					{playedSet.has(gameId) && (
						<span className="ml-2 text-amber-600">(already played)</span>
					)}
				</p>
			)}
			<Button
				disabled={busy || gameId === null}
				onClick={async () => {
					if (gameId === null) return;
					setError(null);
					setBusy(true);
					try {
						await start({ roomId, contextoGameId: gameId });
					} catch (e) {
						setError(e instanceof Error ? e.message : "Failed to start");
					} finally {
						setBusy(false);
					}
				}}
			>
				{busy ? "Starting…" : "Start game"}
			</Button>
			{error && <p className="text-sm text-rose-400">{error}</p>}
		</section>
	);
}

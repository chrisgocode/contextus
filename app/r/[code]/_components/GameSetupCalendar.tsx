"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  contextoGameIdForDate,
  launchDate,
  todayUtcMidnight,
} from "@/lib/contexto";
import type { Id } from "@/convex/_generated/dataModel";

export function GameSetupCalendar({
  roomId,
  isHost,
}: {
  roomId: Id<"rooms">;
  isHost: boolean;
}) {
  const [date, setDate] = useState<Date | undefined>(todayUtcMidnight());
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

  const today = todayUtcMidnight();
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
          played: "after:content-['•'] after:text-amber-500 after:ml-0.5",
        }}
      />
      {gameId !== null && (
        <p className="text-sm text-muted-foreground">
          Game #{gameId} — {date!.toISOString().slice(0, 10)}
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

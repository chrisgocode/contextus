"use client";

import { useQuery } from "convex/react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GuessListSkeleton } from "./RoomSkeleton";

type Guess = NonNullable<
  ReturnType<typeof useQuery<typeof api.guesses.listForGame>>
>["sorted"][number];

export function GuessList({
  gameId,
  duplicate,
}: {
  gameId: Id<"games">;
  duplicate: string | null;
}) {
  // The duplicate isn't a listForGame argument: changing arguments reopens
  // the subscription and flashes the skeleton while it loads.
  const data = useQuery(api.guesses.listForGame, { gameId });
  const inList =
    duplicate === null
      ? undefined
      : data?.sorted.find((g) => g.lemma === duplicate);
  const outsideList = useQuery(
    api.guesses.findByLemma,
    duplicate !== null && data !== undefined && inList === undefined
      ? { gameId, lemma: duplicate }
      : "skip",
  );
  if (data === undefined) return <GuessListSkeleton />;
  const { sorted, latest } = data;
  const repeated = inList ?? outsideList ?? null;
  // Confirm the duplicate while findByLemma loads; the lemma is all we know.
  const repeatedLoading =
    duplicate !== null && inList === undefined && outsideList === undefined;
  if (sorted.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No guesses yet. Type one!</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {(repeated || repeatedLoading) && (
        <div role="status" aria-label="Already guessed">
          {repeated ? (
            <Row g={repeated} duplicate />
          ) : (
            <div className="rounded-md bg-neutral-900/60 px-3 py-2.5 font-semibold text-white">
              {duplicate}
              <span className="ml-2 text-sm font-normal">
                (already guessed)
              </span>
            </div>
          )}
        </div>
      )}
      {repeated && !sorted.some((g) => g._id === repeated._id) && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Earlier guess
          </p>
          <Row g={repeated} highlight />
        </div>
      )}
      {latest && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
            Latest
          </p>
          <Row g={latest} highlight />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          All guesses (closest first)
        </p>
        {sorted.map((g) => (
          <Row
            key={g._id}
            g={g}
            highlight={g._id === latest?._id || g._id === repeated?._id}
          />
        ))}
      </div>
    </div>
  );
}

export function barWidthPct(distance: number): number {
  // exponential decay: rank 0 = 100%, ~rank 500 = 37%, far ranks taper to ~3%
  return Math.max(3, 100 * Math.exp(-distance / 500));
}

export function barColor(distance: number): string {
  if (distance <= 300) return "rgb(76 175 121)"; // green
  if (distance <= 1500) return "rgb(232 144 84)"; // orange
  return "rgb(220 70 110)"; // pink/red
}

function Row({
  g,
  highlight,
  duplicate,
}: {
  g: Guess;
  highlight?: boolean;
  duplicate?: boolean;
}) {
  const rank = g.distance + 1;
  const width = barWidthPct(g.distance);
  const color = barColor(g.distance);
  return (
    <div
      className={`relative rounded-md overflow-hidden bg-neutral-900/60 ${
        highlight ? "ring-2 ring-foreground" : ""
      }`}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: `${width}%`, background: color }}
      />
      <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
        <span className="flex-1 font-semibold truncate">
          {g.lemma}
          {duplicate && (
            <span className="ml-2 text-sm font-normal">(already guessed)</span>
          )}
        </span>
        {!duplicate && g.source === "hint" && (
          <span className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
            hint
          </span>
        )}
        {!duplicate && (
          <Avatar className="h-5 w-5 ring-1 ring-black/30">
            {g.player.image && (
              <AvatarImage src={g.player.image} alt={g.player.name} />
            )}
            <AvatarFallback className="text-[10px]">
              {g.player.name.slice(0, 1).toUpperCase()}
            </AvatarFallback>
          </Avatar>
        )}
        <span className="font-mono text-sm tabular-nums opacity-90 min-w-[3ch] text-right">
          {rank}
        </span>
      </div>
    </div>
  );
}

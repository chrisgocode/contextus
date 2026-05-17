"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Id } from "@/convex/_generated/dataModel";

type Guess = NonNullable<
  ReturnType<typeof useQuery<typeof api.guesses.listForGame>>
>["sorted"][number];

export function GuessList({ gameId }: { gameId: Id<"games"> }) {
  const data = useQuery(api.guesses.listForGame, { gameId });
  if (data === undefined) return <p>Loading guesses…</p>;
  const { sorted, latest } = data;
  if (sorted.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">No guesses yet. Type one!</p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
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
          <Row key={g._id} g={g} highlight={g._id === latest?._id} />
        ))}
      </div>
    </div>
  );
}

function Row({ g, highlight }: { g: Guess; highlight?: boolean }) {
  const rank = g.distance + 1;
  const bg = `hsl(${Math.max(0, 120 - rank / 30)} 70% ${highlight ? "85%" : "92%"})`;
  return (
    <div
      className="flex items-center gap-3 rounded-md px-3 py-2"
      style={{ background: bg }}
    >
      <span className="font-mono text-xs w-16 tabular-nums text-slate-700">
        #{rank}
      </span>
      <span className="flex-1 font-medium">{g.lemma}</span>
      {g.source === "hint" && (
        <span className="rounded bg-blue-200 text-blue-900 px-1.5 py-0.5 text-xs">
          hint
        </span>
      )}
      <Avatar className="h-6 w-6">
        {g.userImage && <AvatarImage src={g.userImage} alt={g.userName ?? ""} />}
        <AvatarFallback>
          {(g.userName ?? "?").slice(0, 1).toUpperCase()}
        </AvatarFallback>
      </Avatar>
    </div>
  );
}

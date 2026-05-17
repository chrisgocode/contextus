"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import type { Id } from "@/convex/_generated/dataModel";

export function HintGiveupBar({
  gameId,
  isHost,
}: {
  gameId: Id<"games">;
  isHost: boolean;
}) {
  const requestHint = useMutation(api.hints.request);
  const requestGiveup = useMutation(api.giveup.request);
  const hostHint = useAction(api.hints.hostHint);
  const hostGiveup = useAction(api.giveup.hostGiveup);
  const pending = useQuery(api.requests.listPending, { gameId });
  const [busy, setBusy] = useState<"hint" | "giveup" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const myHintPending = pending?.some((p) => p.type === "hint") ?? false;
  const myGiveupPending = pending?.some((p) => p.type === "giveup") ?? false;

  async function run(kind: "hint" | "giveup") {
    setError(null);
    setBusy(kind);
    try {
      if (isHost) {
        if (kind === "hint") await hostHint({ gameId });
        else await hostGiveup({ gameId });
      } else {
        if (kind === "hint") await requestHint({ gameId });
        else await requestGiveup({ gameId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={busy !== null || (!isHost && myHintPending)}
          onClick={() => run("hint")}
        >
          {busy === "hint" ? "…" : isHost ? "Get hint" : "Request hint"}
        </Button>
        <Button
          variant="destructive"
          disabled={busy !== null || (!isHost && myGiveupPending)}
          onClick={() => run("giveup")}
        >
          {busy === "giveup" ? "…" : isHost ? "Give up" : "Request give up"}
        </Button>
      </div>
      {!isHost && myHintPending && (
        <p className="text-xs text-muted-foreground">
          Hint request pending host approval.
        </p>
      )}
      {!isHost && myGiveupPending && (
        <p className="text-xs text-muted-foreground">
          Give-up request pending host approval.
        </p>
      )}
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </div>
  );
}

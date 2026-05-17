"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Id } from "@/convex/_generated/dataModel";

export function GuessInput({ gameId }: { gameId: Id<"games"> }) {
  const submit = useAction(api.guesses.submit);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!word.trim()) return;
        setError(null);
        setBusy(true);
        try {
          await submit({ gameId, word });
          setWord("");
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed");
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2">
        <Input
          placeholder="Type a word…"
          value={word}
          onChange={(e) => setWord(e.target.value)}
          disabled={busy}
          autoFocus
        />
        <Button type="submit" disabled={busy || !word.trim()}>
          {busy ? "…" : "Guess"}
        </Button>
      </div>
      {error && <p className="text-sm text-rose-600">{error}</p>}
    </form>
  );
}

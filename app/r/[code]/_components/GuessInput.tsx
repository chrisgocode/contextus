"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Id } from "@/convex/_generated/dataModel";

function guessErrorMessage(err: unknown): string {
  if (err instanceof ConvexError && typeof err.data === "string") {
    return err.data;
  }
  if (err instanceof Error) return err.message;
  return "Failed to submit guess";
}

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
          const res = await submit({ gameId, word });
          if ("alreadyGuessed" in res && res.alreadyGuessed) {
            setError(res.message);
            return;
          }
          setWord("");
          if (res.won) toast.success(`You got it: ${res.lemma}!`);
        } catch (err) {
          setError(guessErrorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex gap-2">
        <Input
          placeholder="Type a word…"
          value={word}
          onChange={(e) => {
            setWord(e.target.value);
            setError(null);
          }}
          disabled={busy}
          aria-invalid={error !== null}
          aria-describedby={error ? "guess-error" : undefined}
          autoFocus
        />
        <Button type="submit" disabled={busy || !word.trim()}>
          {busy ? "…" : "Guess"}
        </Button>
      </div>
      {error && (
        <p id="guess-error" role="alert" className="text-md pt-2 font-bold text-rose-400">
          {error}
        </p>
      )}
    </form>
  );
}

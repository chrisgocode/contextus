"use client";

import { useAction } from "convex/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { expectedClientErrorMessage } from "@/lib/client-errors";
import { reportClientError } from "@/lib/report-error";

// Unsent guesses live in sessionStorage so a reload (e.g. from the new-version
// toast) doesn't throw away what the player was typing.
function draftKey(gameId: Id<"games">) {
  return `guess-draft:${gameId}`;
}

function saveDraft(gameId: Id<"games">, word: string) {
  try {
    if (word) sessionStorage.setItem(draftKey(gameId), word);
    else sessionStorage.removeItem(draftKey(gameId));
  } catch {
    // Storage unavailable (e.g. blocked); drafts just won't survive reloads.
  }
}

function loadDraft(gameId: Id<"games">) {
  try {
    return sessionStorage.getItem(draftKey(gameId)) ?? "";
  } catch {
    return "";
  }
}

export function GuessInput({
  gameId,
  onAchievementsUnlocked,
}: {
  gameId: Id<"games">;
  onAchievementsUnlocked: (ids: string[]) => void;
}) {
  const submit = useAction(api.guesses.submit);
  // Only mounted once the game has loaded on the client, so reading storage
  // here can't cause a hydration mismatch.
  const [word, setWord] = useState(() => loadDraft(gameId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function updateWord(next: string) {
    setWord(next);
    saveDraft(gameId, next);
  }

  return (
    <>
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!word.trim()) return;
          setError(null);
          setBusy(true);
          try {
            const res = await submit({ gameId, word });
            if (res.message) {
              setError(res.message);
              return;
            }
            updateWord("");
            if (res.unlockedAchievementIds.length > 0) {
              onAchievementsUnlocked(res.unlockedAchievementIds);
            }
            if (res.won) toast.success(`You got it: ${res.lemma}!`);
          } catch (err) {
            const message =
              expectedClientErrorMessage(err, "guess.submit") ??
              "Could not submit guess. Try again.";
            setError(message);
            reportClientError(err, {
              userMessage: message,
              context: "guess.submit",
              showToast: false,
            });
          } finally {
            setBusy(false);
            requestAnimationFrame(() => inputRef.current?.focus());
          }
        }}
      >
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            placeholder="Type a word…"
            value={word}
            onChange={(e) => {
              updateWord(e.target.value);
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
          <p
            id="guess-error"
            role="alert"
            className="text-md pt-2 font-bold text-rose-400"
          >
            {error}
          </p>
        )}
      </form>
    </>
  );
}

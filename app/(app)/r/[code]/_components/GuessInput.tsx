"use client";

import { ArrowUp02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useAction } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runMutation } from "@/lib/report-error";
import { lazyToast } from "@/lib/toast";

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

type GuessInputProps = {
  gameId: Id<"games">;
  onAchievementsUnlocked: (ids: string[]) => void;
  onDuplicate: (lemma: string | null) => void;
  children?: React.ReactNode;
};

type GuessState =
  | { phase: "editing" | "submitting"; word: string }
  | { phase: "rejected"; word: string; message: string }
  | { phase: "accepted" | "duplicate"; word: "" };

export function GuessInput(props: GuessInputProps) {
  return <GameGuessInput key={props.gameId} {...props} />;
}

function GameGuessInput({
  gameId,
  onAchievementsUnlocked,
  onDuplicate,
  children,
}: GuessInputProps) {
  const submit = useAction(api.guesses.submit);
  // Only mounted once the game has loaded on the client, so reading storage
  // here can't cause a hydration mismatch.
  const [state, setState] = useState<GuessState>(() => ({
    phase: "editing",
    word: loadDraft(gameId),
  }));
  const word = state.word;
  const busy = state.phase === "submitting";
  const error = state.phase === "rejected" ? state.message : null;
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (state.phase === "editing" || state.phase === "submitting") return;
    const frame = requestAnimationFrame(() => {
      if (mounted.current) inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [state.phase]);

  function updateWord(next: string) {
    setState({ phase: "editing", word: next });
    saveDraft(gameId, next);
  }

  return (
    <>
      <form
        className="flex flex-col gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (pending.current || !word.trim()) return;
          pending.current = true;
          onDuplicate(null);
          setState({ phase: "submitting", word });
          try {
            const result = await runMutation(() => submit({ gameId, word }), {
              context: "guess.submit",
              fallback: "Could not submit guess. Try again.",
              showToast: false,
            });
            // Durable unlocks belong to the Room queue outside this form. A
            // winning turn or a role change may already have unmounted it.
            if (
              result.ok &&
              !result.value.message &&
              !result.value.alreadyGuessed
            ) {
              if (result.value.unlockedAchievementIds.length > 0)
                onAchievementsUnlocked(result.value.unlockedAchievementIds);
              if (result.value.won)
                lazyToast((toast) =>
                  toast.success(`You got it: ${result.value.lemma}!`),
                );
            }
            // Draft, duplicate and focus effects belong only to this mounted
            // Game form; an old completion must not touch its replacement.
            if (!mounted.current) return;
            if (!result.ok) {
              setState({ phase: "rejected", word, message: result.message });
              return;
            }
            const res = result.value;
            if (res.alreadyGuessed && res.lemma) {
              onDuplicate(res.lemma);
              saveDraft(gameId, "");
              setState({ phase: "duplicate", word: "" });
              return;
            }
            if (res.message) {
              setState({ phase: "rejected", word, message: res.message });
              return;
            }
            saveDraft(gameId, "");
            setState({ phase: "accepted", word: "" });
          } finally {
            pending.current = false;
          }
        }}
      >
        <div className="flex items-stretch gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              className="h-11 pr-11 text-base md:text-sm"
              ref={inputRef}
              placeholder="Type a word…"
              value={word}
              onChange={(e) => {
                updateWord(e.target.value);
              }}
              disabled={busy}
              aria-invalid={error !== null}
              aria-describedby={error ? "guess-error" : undefined}
              autoFocus
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Guess"
              disabled={busy || !word.trim()}
              className="absolute top-1/2 right-1.5 -translate-y-1/2"
            >
              {busy ? (
                "…"
              ) : (
                <HugeiconsIcon
                  icon={ArrowUp02Icon}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              )}
            </Button>
          </div>
          {children}
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

"use client";

import { useAction } from "convex/react";
import { ConvexError } from "convex/values";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AchievementUnlockQueue,
  type AchievementUnlockQueueItem,
} from "@/app/_components/AchievementUnlockQueue";
import { getUnlockedAchievementMetadata } from "@/app/_components/achievement-metadata";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
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
  const [achievementUnlocks, setAchievementUnlocks] = useState<
    AchievementUnlockQueueItem[]
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const dismissAchievementUnlock = useCallback(() => {
    setAchievementUnlocks((items) => items.slice(1));
  }, []);

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
            if ("alreadyGuessed" in res && res.alreadyGuessed) {
              setError(res.message);
              return;
            }
            setWord("");
            if (res.unlockedAchievementIds.length > 0) {
              const unlockedAt = Date.now();
              const items = res.unlockedAchievementIds.flatMap((id, index) => {
                const metadata = getUnlockedAchievementMetadata(id);
                if (metadata === null) return [];
                return [
                  {
                    key: `${id}-${unlockedAt}-${index}`,
                    achievementName: metadata.achievement.name,
                    category: metadata.achievement.category,
                    categoryLabel: metadata.group.label,
                    trophy: metadata.trophy,
                    trophyAlt: `${metadata.group.label} trophy`,
                  },
                ];
              });
              if (items.length > 0) {
                setAchievementUnlocks((current) => [...current, ...items]);
              }
            }
            if (res.won) toast.success(`You got it: ${res.lemma}!`);
          } catch (err) {
            setError(guessErrorMessage(err));
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
          <p
            id="guess-error"
            role="alert"
            className="text-md pt-2 font-bold text-rose-400"
          >
            {error}
          </p>
        )}
      </form>
      <AchievementUnlockQueue
        items={achievementUnlocks}
        onItemDone={dismissAchievementUnlock}
      />
    </>
  );
}

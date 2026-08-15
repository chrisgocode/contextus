"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { reportClientError } from "@/lib/report-error";

const COLORS = {
  green: "rgb(76 175 121)",
  yellow: "rgb(232 184 64)",
  red: "rgb(220 70 110)",
} as const;

const ACCOUNT_MESSAGES = [
  "Nice run—create an account to keep your progress.",
  "Three more games down. Save your stats and achievements.",
  "Your guest streak is growing. Create an account to make it permanent.",
] as const;

export function EndGameBanner({
  status,
  answerLemma,
  gameId,
}: {
  status: "won" | "given_up";
  answerLemma: string | null | undefined;
  gameId: Id<"games">;
}) {
  const data = useQuery(api.guesses.listForGame, { gameId });
  const sorted = data?.sorted ?? [];
  const hintCount = sorted.filter((g) => g.source === "hint").length;
  const guessCount = sorted.length - hintCount;
  const buckets = {
    green: sorted.filter((g) => g.distance <= 300).length,
    yellow: sorted.filter((g) => g.distance > 300 && g.distance <= 1500).length,
    red: sorted.filter((g) => g.distance > 1500).length,
  };

  if (status === "given_up") {
    return (
      <>
        <section className="rounded-lg border-2 border-amber-500/60 bg-amber-500/10 p-6 text-center flex flex-col items-center gap-3">
          <h2 className="text-2xl font-bold">Game given up</h2>
          <p className="text-lg">
            The answer was{" "}
            <span className="font-mono font-bold">{answerLemma ?? "?"}</span>
          </p>
        </section>
        <GuestAccountPrompt />
      </>
    );
  }

  return (
    <>
      <section className="rounded-lg border-2 border-amber-500/60 bg-neutral-900 p-6 text-center flex flex-col items-center gap-4">
        <h2 className="text-2xl font-bold">Congrats!</h2>
        <p className="text-lg">
          {hintCount > 0 ? (
            <>
              You got it in <strong>{guessCount}</strong> guesses and{" "}
              <strong>{hintCount}</strong> hints.
            </>
          ) : (
            <>
              You got it in <strong>{guessCount}</strong> guesses.
            </>
          )}
        </p>
        {sorted.length > 0 && (
          <div className="flex flex-col gap-1.5 items-start">
            <BucketRow color={COLORS.green} count={buckets.green} />
            <BucketRow color={COLORS.yellow} count={buckets.yellow} />
            <BucketRow color={COLORS.red} count={buckets.red} />
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          The answer was{" "}
          <span className="font-mono font-bold">{answerLemma ?? "?"}</span>
        </p>
      </section>
      <GuestAccountPrompt />
    </>
  );
}

function GuestAccountPrompt() {
  const prompt = useQuery(api.users.getGuestAccountPrompt, {});
  const dismissPrompt = useMutation(api.users.dismissGuestAccountPrompt);
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);
  const dismiss = useCallback(async () => {
    clearTimer();
    dialogRef.current?.close();
    try {
      await dismissPrompt({});
    } catch (error) {
      reportClientError(error, {
        userMessage: "Could not dismiss this message. Try again.",
        context: "guestPrompt.dismiss",
      });
    }
  }, [clearTimer, dismissPrompt]);
  const scheduleDismiss = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => void dismiss(), 10_000);
  }, [clearTimer, dismiss]);

  useEffect(() => {
    if (prompt === null || prompt === undefined) return;
    if (dialogRef.current?.open !== true) dialogRef.current?.showModal();
    scheduleDismiss();
    return clearTimer;
  }, [clearTimer, prompt, scheduleDismiss]);

  if (prompt === null || prompt === undefined) return null;
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="guest-account-title"
      className="m-auto max-w-sm rounded-lg border bg-background p-6 text-foreground shadow-xl backdrop:bg-black/60"
      onCancel={(event) => {
        event.preventDefault();
        void dismiss();
      }}
      onMouseEnter={clearTimer}
      onMouseLeave={scheduleDismiss}
      onFocusCapture={clearTimer}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          scheduleDismiss();
      }}
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h2 id="guest-account-title" className="text-lg font-semibold">
            Save your progress
          </h2>
          <p className="text-sm text-muted-foreground">
            {ACCOUNT_MESSAGES[prompt.messageIndex]}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={async () => {
              await dismiss();
              const redirectTo = window.location.pathname;
              router.push(
                `/signin?redirectTo=${encodeURIComponent(redirectTo)}`,
              );
            }}
          >
            Create account
          </Button>
          <Button variant="outline" onClick={() => void dismiss()}>
            Not now
          </Button>
        </div>
      </div>
    </dialog>
  );
}

function BucketRow({ color, count }: { color: string; count: number }) {
  if (count === 0) return null;
  const blocks = Math.min(3, Math.max(1, Math.ceil(count / 5)));
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {Array.from({ length: blocks }).map((_, i) => (
          <div
            key={i}
            className="h-5 w-5 rounded-sm"
            style={{ background: color }}
          />
        ))}
      </div>
      <span className="font-mono text-sm tabular-nums">{count}</span>
    </div>
  );
}

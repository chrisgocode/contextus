"use client";

import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { expectedClientErrorMessage } from "@/lib/client-errors";
import { reportClientError } from "@/lib/report-error";
import { barColor, barWidthPct } from "./GuessList";

type Latest = FunctionReturnType<typeof api.requests.latestMine>;
type Request = NonNullable<Latest["hint"]>;
type Player = { name: string; image?: string | null };

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
// Letters a pending hint shows while it waits; the real word's length isn't
// known until the Host approves.
const SCRAMBLE_LENGTH = 8;
const SCRAMBLE_MS = 170;
const REVEAL_SCRAMBLE_MS = 140;
const REVEAL_LETTER_MS = 200;

// A non-Host's hint and give-up requests, shown above the guess list where
// their result will land: a pending hint as a placeholder row of shuffling
// letters, a pending give-up as a hidden answer row. When the Host approves a
// hint the letters settle into the word. An outcome shows only for the last
// request of its type this page watched while pending, so a reload doesn't
// replay old decisions and a newer request retires the one before it.
export function RequestRows({
  gameId,
  host,
  viewer,
}: {
  gameId: Id<"games">;
  host: Player;
  viewer: Player;
}) {
  const latest = useQuery(api.requests.latestMine, { gameId });
  const [watching, setWatching] = useState<{ hint?: string; giveup?: string }>(
    {},
  );
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const pendingHint =
    latest?.hint?.status === "pending" ? latest.hint._id : null;
  const pendingGiveup =
    latest?.giveup?.status === "pending" ? latest.giveup._id : null;
  if (
    (pendingHint !== null && pendingHint !== watching.hint) ||
    (pendingGiveup !== null && pendingGiveup !== watching.giveup)
  ) {
    setWatching({
      hint: pendingHint ?? watching.hint,
      giveup: pendingGiveup ?? watching.giveup,
    });
  }
  const now = useNow(pendingHint !== null || pendingGiveup !== null);

  const shown = (r: Request | null | undefined, type: "hint" | "giveup") =>
    r != null &&
    (r.status === "pending" ||
      (r._id === watching[type] && !dismissed.has(r._id)));
  const dismiss = (id: string) => setDismissed(new Set([...dismissed, id]));
  const hint = latest?.hint;
  const giveup = latest?.giveup;
  // An approved give-up ends the Game, and the end screen takes over.
  const showGiveup = shown(giveup, "giveup") && giveup?.status !== "approved";
  const showHint = shown(hint, "hint");

  // The live region stays mounted, even empty, so screen readers announce
  // rows as they appear.
  return (
    <div className="flex flex-col gap-3 empty:hidden" role="status">
      {showGiveup &&
        giveup &&
        (giveup.status === "pending" ? (
          <section>
            <RowLabel
              label="Answer · if host agrees"
              action={<TakeBack request={giveup} type="giveup" />}
            />
            <div className="relative overflow-hidden rounded-md border border-dashed border-destructive/60 bg-neutral-900/60">
              <div className="flex items-center gap-2 px-3 py-2.5 text-white">
                <span className="sr-only">Give-up requested</span>
                <span className="flex flex-1 items-center gap-1" aria-hidden>
                  {Array.from({ length: 7 }, (_, i) => (
                    <span
                      key={i}
                      className="inline-block h-4 w-3 bg-white/25 motion-safe:animate-pulse"
                      style={{ animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </span>
                <Elapsed since={giveup.createdAt} now={now} />
                <PlayerAvatar player={host} />
                <span className="min-w-[3ch] text-right font-mono text-sm">
                  1
                </span>
              </div>
            </div>
          </section>
        ) : (
          <Declined
            label="Give-up declined"
            onDismiss={() => dismiss(giveup._id)}
          />
        ))}
      {showHint &&
        hint &&
        (hint.status === "pending" ? (
          <section>
            <RowLabel
              label="Incoming hint"
              action={<TakeBack request={hint} type="hint" />}
            />
            <div className="relative overflow-hidden rounded-md border border-dashed border-white/30 bg-neutral-900/60">
              <div className="absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-emerald-400/25 to-transparent motion-safe:animate-request-shimmer motion-reduce:hidden" />
              <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
                <span className="flex-1 truncate font-semibold tracking-wide text-white/45">
                  <span className="sr-only">Hint requested</span>
                  <Scramble />
                </span>
                <Elapsed since={hint.createdAt} now={now} />
                <HintTag />
                <PlayerAvatar player={host} />
                <span className="min-w-[3ch] text-right font-mono text-sm text-white/60">
                  ?
                </span>
              </div>
            </div>
          </section>
        ) : hint.status === "approved" && hint.hint !== undefined ? (
          <section>
            <RowLabel
              label="Hint approved"
              action={<DismissButton onClick={() => dismiss(hint._id)} />}
            />
            <RevealRow
              lemma={hint.hint.lemma}
              distance={hint.hint.distance}
              player={viewer}
            />
          </section>
        ) : (
          <Declined label="Hint declined" onDismiss={() => dismiss(hint._id)} />
        ))}
    </div>
  );
}

function RowLabel({
  label,
  action,
}: {
  label: string;
  action: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {action}
    </div>
  );
}

function TakeBack({
  request,
  type,
}: {
  request: Request;
  type: "hint" | "giveup";
}) {
  const cancel = useMutation(api.requests.cancel);
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await cancel({ requestId: request._id });
        } catch (err) {
          const context = `request.cancel.${type}`;
          reportClientError(err, {
            userMessage:
              expectedClientErrorMessage(err, context) ??
              "Could not take back the request.",
            context,
          });
        } finally {
          setBusy(false);
        }
      }}
    >
      Take back
    </Button>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick}>
      Dismiss
    </Button>
  );
}

function Declined({
  label,
  onDismiss,
}: {
  label: string;
  onDismiss: () => void;
}) {
  return (
    <section>
      <RowLabel label={label} action={<DismissButton onClick={onDismiss} />} />
      <div className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
        Ask again any time.
      </div>
    </section>
  );
}

// Matches the Guess row the hint becomes, which is credited to the requester.
function RevealRow({
  lemma,
  distance,
  player,
}: {
  lemma: string;
  distance: number;
  player: Player;
}) {
  const reduced = usePrefersReducedMotion();
  const [settled, setSettled] = useState(0);
  const locked = reduced ? lemma.length : settled;
  const done = locked >= lemma.length;
  const tick = useTick(REVEAL_SCRAMBLE_MS, !done);
  useEffect(() => {
    if (done) return;
    const id = setTimeout(() => setSettled((n) => n + 1), REVEAL_LETTER_MS);
    return () => clearTimeout(id);
  }, [done, settled]);
  const unsettled = Array.from(lemma.slice(locked), (_, i) =>
    scrambleLetter(tick, locked + i),
  ).join("");

  return (
    <div
      className={`relative overflow-hidden rounded-md bg-neutral-900/60 ${
        done ? "ring-2 ring-emerald-400" : "ring-1 ring-white/30"
      }`}
    >
      <div
        className="absolute inset-y-0 left-0 motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-out"
        style={{
          width: done ? `${barWidthPct(distance)}%` : "0%",
          background: barColor(distance),
        }}
      />
      <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
        <span className="flex-1 truncate font-semibold tracking-wide">
          {done ? (
            lemma
          ) : (
            <>
              <span className="sr-only">{lemma}</span>
              <span aria-hidden>
                {lemma.slice(0, locked)}
                <span className="text-white/45">{unsettled}</span>
              </span>
            </>
          )}
        </span>
        <HintTag />
        <PlayerAvatar player={player} />
        <span className="min-w-[3ch] text-right font-mono text-sm tabular-nums">
          {done ? distance + 1 : "?"}
        </span>
      </div>
    </div>
  );
}

function Scramble() {
  const tick = useTick(SCRAMBLE_MS, true);
  return (
    <span aria-hidden>
      {Array.from({ length: SCRAMBLE_LENGTH }, (_, i) =>
        scrambleLetter(tick, i),
      ).join("")}
    </span>
  );
}

// Each position steps through the alphabet at its own rate, so the letters
// don't move in lockstep.
function scrambleLetter(tick: number, i: number) {
  return LETTERS[(tick * (i * 7 + 3) + i * 11) % LETTERS.length];
}

function HintTag() {
  return (
    <span className="rounded bg-black/30 px-1.5 py-0.5 text-xs">hint</span>
  );
}

function PlayerAvatar({ player }: { player: Player }) {
  return (
    <Avatar className="h-5 w-5 ring-1 ring-black/30">
      {player.image && <AvatarImage src={player.image} alt={player.name} />}
      <AvatarFallback className="text-[10px]">
        {player.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function Elapsed({ since, now }: { since: number; now: number }) {
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="text-xs tabular-nums text-white/60" aria-hidden>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function useTick(ms: number, active: boolean) {
  const reduced = usePrefersReducedMotion();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active || reduced) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms, active, reduced]);
  return tick;
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function usePrefersReducedMotion() {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const query = window.matchMedia(REDUCED_MOTION);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () =>
      typeof window.matchMedia === "function" &&
      window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}

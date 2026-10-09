"use client";

import {
  useEffect,
  useEffectEvent,
  useState,
  useSyncExternalStore,
} from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { barColor, barWidthPct } from "./GuessList";

// The scramble a requested hint shows while it waits, and the reveal that
// settles it into the word. Shared by the requester's and the Host's rows so
// both see the same animation.

export type Player = { name: string; image?: string | null };

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
// The real word's length isn't known until the Host approves.
const SCRAMBLE_LENGTH = 8;
const SCRAMBLE_MS = 170;
const REVEAL_SCRAMBLE_MS = 140;
const REVEAL_LETTER_MS = 200;

// Matches the Guess row the hint becomes, which is credited to the requester.
export function RevealRow({
  lemma,
  distance,
  player,
  onSettled,
}: {
  lemma: string;
  distance: number;
  player: Player;
  onSettled?: () => void;
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
  const settle = useEffectEvent(() => onSettled?.());
  useEffect(() => {
    if (done) settle();
  }, [done]);
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

export function Scramble() {
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

export function HintTag() {
  return (
    <span className="rounded bg-black/30 px-1.5 py-0.5 text-xs">hint</span>
  );
}

export function PlayerAvatar({
  player,
  className = "h-5 w-5",
}: {
  player: Player;
  className?: string;
}) {
  return (
    <Avatar className={`${className} ring-1 ring-black/30`}>
      {player.image && <AvatarImage src={player.image} alt={player.name} />}
      <AvatarFallback className="text-[10px]">
        {player.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

// Time until the request expires; requests made before they expired show
// time waited instead.
export function TimeLeft({
  request,
  now,
}: {
  request: { createdAt: number; expiresAt?: number };
  now: number;
}) {
  const ms =
    request.expiresAt === undefined
      ? now - request.createdAt
      : request.expiresAt - now;
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return (
    <span className="text-xs tabular-nums text-white/60" aria-hidden>
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  // The clock only ticks while active, so catch up as soon as it turns on
  // rather than showing a stale reading until the first tick.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setNow(Date.now());
  }
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

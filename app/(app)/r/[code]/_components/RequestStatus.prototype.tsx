"use client";

// PROTOTYPE — throwaway. Three takes on what a non-host player sees after
// asking the host for a hint or to give up. Request state is mocked from the
// `?req=` search param (idle | hint | giveup | both | approved | denied) so
// every case can be eyeballed without a second browser acting as host.

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export const REQUEST_PROTOTYPE_VARIANTS = [
  { key: "A", name: "Ticket" },
  { key: "B", name: "Dock" },
  { key: "C", name: "Ghost row" },
];
export const REQUEST_PROTOTYPE_STATES = [
  "idle",
  "hint",
  "giveup",
  "both",
  "approved",
  "denied",
];

type Host = { name: string; image?: string | null; online: boolean };
type Req = "idle" | "hint" | "giveup" | "both" | "approved" | "denied";
type Slot = "bar" | "list" | "dock";

const MOCK_HINT = { lemma: "fruitcake", rank: 2 };

function useMockReq() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const req = (params.get("req") ?? "idle") as Req;
  const setReq = (value: Req) => {
    const next = new URLSearchParams(params);
    next.set("req", value);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };
  const hintPending = req === "hint" || req === "both";
  const giveupPending = req === "giveup" || req === "both";
  const cancel = (kind: "hint" | "giveup") => {
    if (req === "both") setReq(kind === "hint" ? "giveup" : "hint");
    else setReq("idle");
  };
  const request = (kind: "hint" | "giveup") => {
    if (kind === "hint") setReq(giveupPending ? "both" : "hint");
    else setReq(hintPending ? "both" : "giveup");
  };
  return { req, setReq, hintPending, giveupPending, cancel, request };
}

function useElapsed() {
  const [start] = useState(() => Date.now() - 42_000);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.floor((now - start) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function HostAvatar({ host, className }: { host: Host; className?: string }) {
  return (
    <Avatar className={className ?? "h-5 w-5"}>
      {host.image && <AvatarImage src={host.image} alt={host.name} />}
      <AvatarFallback className="text-[10px]">
        {host.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

const KEYFRAMES = `
@keyframes proto-march { to { background-position: 16px 0, -16px 100%, 0 -16px, 100% 16px; } }
@keyframes proto-shimmer { from { transform: translateX(-100%); } to { transform: translateX(250%); } }
@keyframes proto-breathe { 0%,100% { opacity: .35 } 50% { opacity: 1 } }
@media (prefers-reduced-motion: reduce) {
  .proto-anim { animation: none !important; }
}
`;

export function RequestPrototype({
  variant,
  slot,
  host,
}: {
  variant: string;
  slot: Slot;
  host: Host;
}) {
  const content =
    variant === "B" ? (
      <DockVariant slot={slot} host={host} />
    ) : variant === "C" ? (
      <GhostVariant slot={slot} host={host} />
    ) : (
      <TicketVariant slot={slot} host={host} />
    );
  return (
    <>
      {slot === "bar" && <style>{KEYFRAMES}</style>}
      {content}
    </>
  );
}

/* ───────────────────────── A · Ticket ─────────────────────────
   The pressed button turns into a live ticket in place: what you asked
   for, who decides, how long it has been, and a way to take it back. The
   ticket resolves in place with the outcome. */

function TicketVariant({ slot, host }: { slot: Slot; host: Host }) {
  const m = useMockReq();
  const elapsed = useElapsed();
  if (slot !== "bar") return null;

  const tickets: ("hint" | "giveup")[] = [];
  if (m.hintPending) tickets.push("hint");
  if (m.giveupPending) tickets.push("giveup");

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex gap-2">
        {!m.hintPending && (
          <Button variant="outline" onClick={() => m.request("hint")}>
            Request hint
          </Button>
        )}
        {!m.giveupPending && (
          <Button variant="destructive" onClick={() => m.request("giveup")}>
            Request give up
          </Button>
        )}
      </div>
      {tickets.map((kind) => (
        <div
          key={kind}
          role="status"
          className="proto-anim relative flex w-full items-center gap-3 px-3 py-2.5 sm:w-80"
          style={{
            backgroundImage: `linear-gradient(90deg, currentColor 50%, transparent 50%), linear-gradient(90deg, currentColor 50%, transparent 50%), linear-gradient(0deg, currentColor 50%, transparent 50%), linear-gradient(0deg, currentColor 50%, transparent 50%)`,
            backgroundRepeat: "repeat-x, repeat-x, repeat-y, repeat-y",
            backgroundSize: "16px 1px, 16px 1px, 1px 16px, 1px 16px",
            backgroundPosition: "0 0, 0 100%, 0 0, 100% 0",
            animation: "proto-march 1.2s linear infinite",
            color:
              kind === "hint"
                ? "var(--color-muted-foreground)"
                : "var(--color-destructive)",
          }}
        >
          <HostAvatar host={host} className="h-7 w-7" />
          <div className="flex min-w-0 flex-1 flex-col text-foreground">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {kind === "hint" ? "Hint requested" : "Give-up requested"} ·{" "}
              <span className="tabular-nums">{elapsed}</span>
            </span>
            <span className="truncate text-sm">
              Waiting on {host.name}
              {!host.online && (
                <span className="text-muted-foreground"> (away)</span>
              )}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => m.cancel(kind)}>
            Cancel
          </Button>
        </div>
      ))}
      {m.req === "approved" && (
        <div
          role="status"
          className="flex w-full items-center gap-3 border border-emerald-500/60 bg-emerald-500/10 px-3 py-2.5 sm:w-80"
        >
          <HostAvatar host={host} className="h-7 w-7" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] uppercase tracking-widest text-emerald-300">
              Hint approved
            </span>
            <span className="truncate text-sm">
              <span className="font-semibold">{MOCK_HINT.lemma}</span> landed at
              #{MOCK_HINT.rank}
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => m.setReq("idle")}>
            OK
          </Button>
        </div>
      )}
      {m.req === "denied" && (
        <div
          role="status"
          className="flex w-full items-center gap-3 border px-3 py-2.5 sm:w-80"
        >
          <HostAvatar host={host} className="h-7 w-7 opacity-60" />
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Hint declined
            </span>
            <span className="truncate text-sm">
              {host.name} wants you to keep guessing.
            </span>
          </div>
          <Button size="sm" variant="ghost" onClick={() => m.setReq("idle")}>
            OK
          </Button>
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── B · Dock ─────────────────────────
   Requests leave the header alone (buttons just read "Hint requested") and
   live in a dock pinned to the bottom of the screen, so the wait stays
   visible while you scroll the guess list on a phone. */

function DockVariant({ slot, host }: { slot: Slot; host: Host }) {
  const m = useMockReq();
  const elapsed = useElapsed();

  if (slot === "bar") {
    return (
      <div className="flex gap-2">
        <Button
          variant="outline"
          aria-disabled={m.hintPending}
          className={m.hintPending ? "border-dashed text-muted-foreground" : ""}
          onClick={() => !m.hintPending && m.request("hint")}
        >
          {m.hintPending ? "✓ Hint requested" : "Request hint"}
        </Button>
        <Button
          variant="destructive"
          aria-disabled={m.giveupPending}
          className={m.giveupPending ? "border-dashed border-destructive/50" : ""}
          onClick={() => !m.giveupPending && m.request("giveup")}
        >
          {m.giveupPending ? "✓ Give up requested" : "Request give up"}
        </Button>
      </div>
    );
  }
  if (slot !== "dock" || m.req === "idle") return null;

  const what =
    m.req === "both"
      ? "a hint and to give up"
      : m.req === "giveup"
        ? "to give up"
        : "a hint";
  const pending = m.hintPending || m.giveupPending;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-3">
        <div className="relative">
          <HostAvatar host={host} className="h-9 w-9" />
          {pending && (
            <span
              className="proto-anim absolute -inset-1 rounded-full border-2 border-primary"
              style={{ animation: "proto-breathe 1.6s ease-in-out infinite" }}
            />
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {pending ? (
            <>
              <span className="truncate text-sm">Waiting on {host.name}</span>
              <span className="truncate text-xs text-muted-foreground">
                Asked for {what} ·{" "}
                <span className="tabular-nums">{elapsed}</span>
                {!host.online && " · host is away"}
              </span>
            </>
          ) : m.req === "approved" ? (
            <>
              <span className="truncate text-sm">
                {host.name} sent a hint:{" "}
                <span className="font-semibold">{MOCK_HINT.lemma}</span>
              </span>
              <span className="text-xs text-emerald-300">
                Ranked #{MOCK_HINT.rank}, now in your list
              </span>
            </>
          ) : (
            <>
              <span className="truncate text-sm">
                {host.name} declined your hint
              </span>
              <span className="text-xs text-muted-foreground">
                You can ask again any time.
              </span>
            </>
          )}
        </div>
        {pending ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => m.setReq("idle")}
          >
            Cancel
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => m.setReq("idle")}>
            Dismiss
          </Button>
        )}
      </div>
    </div>
  );
}

/* Copy options for the pending hint row, picked with `?copy=`:
   verbs    — rotating gerunds, like Claude Code's spinner
   scramble — letters shuffle where the hint word will land
   typing   — chat-style "host is typing" dots
   plain    — static "Hint requested" */

const VERBS = [
  "Mulling it over",
  "Thumbing pages",
  "Deliberating",
  "Consulting notes",
  "Weighing it",
  "Rummaging",
  "Pondering",
  "Scheming",
];

function useTick(ms: number) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setTick((t) => t + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return tick;
}

function PendingCopy() {
  const copy = useSearchParams().get("copy") ?? "verbs";
  if (copy === "scramble") return <ScrambleCopy />;
  if (copy === "typing") return <TypingCopy />;
  if (copy === "plain")
    return <span className="flex-1 truncate text-white/70">Hint requested</span>;
  return <VerbCopy />;
}

function VerbCopy() {
  const tick = useTick(2400);
  return (
    <span className="flex-1 truncate text-white/70" aria-live="off">
      <span className="mr-1.5 inline-block text-emerald-300">✻</span>
      {VERBS[tick % VERBS.length]}…
    </span>
  );
}

function ScrambleCopy() {
  const tick = useTick(170);
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const word = Array.from({ length: 8 }, (_, i) =>
    letters[(tick * (i * 7 + 3) + i * 11) % 26],
  ).join("");
  return (
    <span className="flex-1 truncate font-semibold tracking-wide text-white/45">
      <span className="sr-only">Hint requested</span>
      <span aria-hidden="true">{word}</span>
    </span>
  );
}

// On approval the scramble settles left to right into the hint word, then
// the row fills in like a normal guess.
function RevealRow({ host }: { host: Host }) {
  const word = MOCK_HINT.lemma;
  const [locked, setLocked] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? word.length
      : 0,
  );
  const tick = useTick(140);
  useEffect(() => {
    if (locked >= word.length) return;
    const id = setTimeout(() => setLocked((n) => n + 1), 200);
    return () => clearTimeout(id);
  }, [locked, word.length]);
  const done = locked >= word.length;
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const shown = Array.from(word, (ch, i) =>
    i < locked ? ch : letters[(tick * (i * 7 + 3) + i * 11) % 26],
  ).join("");
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-neutral-900/60 transition-shadow duration-500 ${
        done ? "ring-2 ring-emerald-400" : "ring-1 ring-white/30"
      }`}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-1000 ease-out"
        style={{ width: done ? "99%" : "0%", background: "rgb(76 175 121)" }}
      />
      <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
        <span className="flex-1 truncate font-semibold tracking-wide">
          <span className="sr-only">{word}</span>
          <span aria-hidden="true">
            <span>{shown.slice(0, locked)}</span>
            <span className="text-white/45">{shown.slice(locked)}</span>
          </span>
        </span>
        <span className="rounded bg-black/30 px-1.5 py-0.5 text-xs">hint</span>
        <HostAvatar host={host} />
        <span className="min-w-[3ch] text-right font-mono text-sm">
          {done ? MOCK_HINT.rank : "?"}
        </span>
      </div>
    </div>
  );
}

function TypingCopy() {
  return (
    <span className="flex flex-1 items-center gap-2 text-white/70">
      <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="proto-anim size-1.5 rounded-full bg-white/80"
            style={{ animation: `proto-breathe 1.2s ${i * 0.2}s ease-in-out infinite` }}
          />
        ))}
      </span>
      <span className="truncate text-sm">host deciding</span>
    </span>
  );
}

/* ───────────────────────── C · Ghost row ─────────────────────────
   The request shows up where its result will land. A pending hint is a
   placeholder row at the top of the guess list that fills in when the host
   approves; a pending give-up is a redacted answer row. */

function GhostVariant({ slot, host }: { slot: Slot; host: Host }) {
  const m = useMockReq();
  const elapsed = useElapsed();

  if (slot === "bar") {
    return (
      <div className="flex gap-2">
        <Button
          variant="outline"
          disabled={m.hintPending}
          onClick={() => m.request("hint")}
        >
          Request hint
        </Button>
        <Button
          variant="destructive"
          disabled={m.giveupPending}
          onClick={() => m.request("giveup")}
        >
          Request give up
        </Button>
      </div>
    );
  }
  if (slot !== "list") return null;
  if (m.req === "idle") return null;

  return (
    <div className="flex flex-col gap-3">
      {m.giveupPending && (
        <div>
          <p className="mb-1 flex justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Answer · if {host.name} agrees</span>
            <button
              type="button"
              className="normal-case tracking-normal underline-offset-2 hover:underline"
              onClick={() => m.cancel("giveup")}
            >
              Take back
            </button>
          </p>
          <div className="relative overflow-hidden rounded-md border border-dashed border-destructive/60 bg-neutral-900/60">
            <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
              <span className="flex flex-1 items-center gap-1" aria-label="Answer hidden">
                {Array.from({ length: 7 }).map((_, i) => (
                  <span
                    key={i}
                    className="proto-anim inline-block h-4 w-3 bg-white/25"
                    style={{
                      animation: `proto-breathe 1.4s ${i * 0.12}s ease-in-out infinite`,
                    }}
                  />
                ))}
              </span>
              <span className="text-xs tabular-nums text-white/70">
                {elapsed}
              </span>
              <HostAvatar host={host} />
              <span className="min-w-[3ch] text-right font-mono text-sm">1</span>
            </div>
          </div>
        </div>
      )}
      {(m.hintPending || m.req === "approved" || m.req === "denied") && (
        <div>
          <p className="mb-1 flex justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>
              {m.req === "approved"
                ? `Hint from ${host.name}`
                : m.req === "denied"
                  ? `${host.name} declined`
                  : "Incoming hint"}
            </span>
            {m.hintPending ? (
              <button
                type="button"
                className="normal-case tracking-normal underline-offset-2 hover:underline"
                onClick={() => m.cancel("hint")}
              >
                Take back
              </button>
            ) : (
              <button
                type="button"
                className="normal-case tracking-normal underline-offset-2 hover:underline"
                onClick={() => m.setReq("idle")}
              >
                Dismiss
              </button>
            )}
          </p>
          {m.req === "approved" ? (
            <RevealRow host={host} />
          ) : m.req === "denied" ? (
            <div className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground line-through decoration-muted-foreground/50">
              hint request
            </div>
          ) : (
            <div className="relative overflow-hidden rounded-md border border-dashed border-white/30 bg-neutral-900/60">
              <div
                className="proto-anim absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-emerald-400/25 to-transparent"
                style={{ animation: "proto-shimmer 1.8s linear infinite" }}
              />
              <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
                <PendingCopy />
                <span className="text-xs tabular-nums text-white/60">
                  {elapsed}
                </span>
                <span className="rounded bg-black/30 px-1.5 py-0.5 text-xs">
                  hint
                </span>
                <HostAvatar host={host} />
                <span className="min-w-[3ch] text-right font-mono text-sm text-white/60">
                  ?
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

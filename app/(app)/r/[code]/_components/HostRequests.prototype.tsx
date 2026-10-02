"use client";

// PROTOTYPE — throwaway. Three takes on how the Host sees and answers hint
// and give-up requests without scrolling to the sidebar. Requests are mocked
// from `?req=` (none | hint | mixed | many); Approve and Deny only update
// local state.

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export const HOST_PROTOTYPE_VARIANTS = [
  { key: "A", name: "Inbox rows" },
  { key: "B", name: "Sheet" },
  { key: "C", name: "On the buttons" },
];
export const HOST_PROTOTYPE_STATES = ["none", "hint", "mixed", "many"];

type Player = { name: string; image?: string | null };
type MockRequest = {
  id: string;
  type: "hint" | "giveup";
  requester: Player;
  since: number;
};
type Slot = "bar" | "list" | "dock";

const MOCK_HINT = { lemma: "fruitcake", distance: 1 };
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

const FAKE_PLAYERS: Player[] = [
  { name: "Noor" },
  { name: "Sam" },
  { name: "Vic" },
];

function seed(req: string, players: Player[]): MockRequest[] {
  const p = [...players, ...FAKE_PLAYERS];
  const now = Date.now();
  const make = (i: number, type: "hint" | "giveup", ago: number) => ({
    id: `${req}-${i}`,
    type,
    requester: p[i % p.length],
    since: now - ago * 1000,
  });
  if (req === "hint") return [make(0, "hint", 8)];
  if (req === "mixed") return [make(0, "hint", 42), make(1, "giveup", 12)];
  if (req === "many")
    return [make(0, "hint", 95), make(1, "hint", 40), make(2, "giveup", 6)];
  return [];
}

function useMockRequests(players: Player[]) {
  const req = useSearchParams().get("req") ?? "hint";
  const [state, setState] = useState(() => ({
    req,
    list: seed(req, players),
    busy: null as string | null,
  }));
  if (state.req !== req) {
    setState({ req, list: seed(req, players), busy: null });
  }
  const resolve = (id: string, approve: boolean) => {
    if (!approve) {
      setState((s) => ({ ...s, list: s.list.filter((r) => r.id !== id) }));
      return;
    }
    setState((s) => ({ ...s, busy: id }));
    const reveal = state.list.find((r) => r.id === id)?.type === "hint";
    setTimeout(
      () =>
        setState((s) => ({
          ...s,
          busy: null,
          list: s.list.filter((r) => r.id !== id),
        })),
      reveal ? 900 + MOCK_HINT.lemma.length * 200 + 2600 : 900,
    );
  };
  return { list: state.list, busy: state.busy, resolve };
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function ago(since: number, now: number) {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PlayerAvatar({
  player,
  className,
}: {
  player: Player;
  className?: string;
}) {
  return (
    <Avatar className={className ?? "h-5 w-5"}>
      {player.image && <AvatarImage src={player.image} alt={player.name} />}
      <AvatarFallback className="text-[10px]">
        {player.name.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

const asks = (r: MockRequest) =>
  r.type === "hint" ? "wants a hint" : "wants to give up";

export function HostRequestPrototype({
  variant,
  slot,
  players,
}: {
  variant: string;
  slot: Slot;
  players: Player[];
}) {
  const mock = useMockRequests(players);
  if (variant === "B") return <SheetVariant slot={slot} {...mock} />;
  if (variant === "C") return <ButtonsVariant slot={slot} {...mock} />;
  return <InboxVariant slot={slot} {...mock} />;
}

type VariantProps = {
  slot: Slot;
  list: MockRequest[];
  busy: string | null;
  resolve: (id: string, approve: boolean) => void;
};

/* ───────────────────────── A · Inbox rows ─────────────────────────
   Requests sit at the top of the guess list, the same place the requester
   sees theirs, with Approve and Deny on the row. */

function InboxVariant({ slot, list, busy, resolve }: VariantProps) {
  const now = useNow();
  if (slot !== "list" || list.length === 0) return null;
  return (
    <section className="flex flex-col gap-1">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        Requests · {list.length}
      </p>
      <ul className="flex flex-col gap-2">
        {list.map((r) =>
          busy === r.id && r.type === "hint" ? (
            <li key={r.id}>
              <HostReveal requester={r.requester} />
            </li>
          ) : (
            <li
              key={r.id}
              className={`flex items-center gap-3 rounded-md border border-dashed bg-neutral-900/60 px-3 py-2 text-white ${
                r.type === "giveup"
                  ? "border-destructive/60"
                  : "border-emerald-400/50"
              }`}
            >
              <PlayerAvatar player={r.requester} className="h-7 w-7" />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-semibold">
                    {r.requester.name}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-white/50">
                    {ago(r.since, now)}
                  </span>
                </span>
                <span className="truncate text-xs text-white/60">
                  {asks(r)}
                </span>
              </div>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === r.id}
                onClick={() => resolve(r.id, false)}
              >
                Deny
              </Button>
              <Button
                size="sm"
                variant={r.type === "giveup" ? "destructive" : "default"}
                disabled={busy === r.id}
                onClick={() => resolve(r.id, true)}
              >
                {busy === r.id
                  ? "…"
                  : r.type === "hint"
                    ? "Give hint"
                    : "Give up"}
              </Button>
            </li>
          ),
        )}
      </ul>
    </section>
  );
}

/* ───────────────────────── B · Sheet ─────────────────────────
   The oldest request rises from the bottom of the screen with big buttons,
   the rest stack behind it. "Later" tucks the stack into a pill. */

function SheetVariant({ slot, list, busy, resolve }: VariantProps) {
  const now = useNow();
  const [tucked, setTucked] = useState(false);
  if (slot !== "dock" || list.length === 0) return null;
  const [first, ...rest] = list;

  if (tucked) {
    return (
      <button
        type="button"
        onClick={() => setTucked(false)}
        className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-50 flex items-center gap-2 rounded-full border border-primary bg-primary py-1.5 pl-1.5 pr-3 text-sm text-primary-foreground shadow-lg"
      >
        <PlayerAvatar player={first.requester} className="h-6 w-6" />
        {list.length} request{list.length === 1 ? "" : "s"}
      </button>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
      <div className="relative mx-auto max-w-md">
        {rest.slice(0, 2).map((r, i) => (
          <div
            key={r.id}
            aria-hidden
            className="absolute inset-x-0 top-0 h-full border bg-card"
            style={{
              transform: `translateY(-${(i + 1) * 8}px) scaleX(${1 - (i + 1) * 0.04})`,
              opacity: 0.7 - i * 0.25,
              zIndex: -1 - i,
            }}
          />
        ))}
        <div className="relative flex flex-col gap-3 border bg-card p-4 shadow-2xl">
          <div className="flex items-center gap-3">
            <PlayerAvatar player={first.requester} className="h-9 w-9" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm">
                <span className="font-semibold">{first.requester.name}</span>{" "}
                {asks(first)}
              </span>
              <span className="text-xs text-muted-foreground">
                <span className="tabular-nums">{ago(first.since, now)}</span>
                {rest.length > 0 && ` · ${rest.length} more waiting`}
              </span>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setTucked(true)}>
              Later
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              size="lg"
              variant="outline"
              disabled={busy === first.id}
              onClick={() => resolve(first.id, false)}
            >
              Deny
            </Button>
            <Button
              size="lg"
              variant={first.type === "giveup" ? "destructive" : "default"}
              disabled={busy === first.id}
              onClick={() => resolve(first.id, true)}
            >
              {busy === first.id
                ? "…"
                : first.type === "hint"
                  ? "Give hint"
                  : "Give up"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── C · On the buttons ─────────────────────────
   Requests attach to the Host's own Get hint and Give up buttons: the
   button names who asked, so pressing it answers them. "Not now" denies. */

function ButtonsVariant({ slot, list, busy, resolve }: VariantProps) {
  if (slot !== "bar") return null;
  const hints = list.filter((r) => r.type === "hint");
  const giveups = list.filter((r) => r.type === "giveup");
  const names = (rs: MockRequest[]) =>
    rs.length === 1
      ? rs[0].requester.name
      : `${rs[0].requester.name} +${rs.length - 1}`;

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex gap-2">
        <Button
          variant={hints.length > 0 ? "default" : "outline"}
          disabled={busy !== null}
          onClick={() => hints[0] && resolve(hints[0].id, true)}
          className="relative"
        >
          {hints.length > 0 && (
            <span className="flex -space-x-1.5">
              {hints.slice(0, 3).map((r) => (
                <PlayerAvatar
                  key={r.id}
                  player={r.requester}
                  className="h-5 w-5 ring-2 ring-primary"
                />
              ))}
            </span>
          )}
          {busy !== null && hints.some((r) => r.id === busy)
            ? "…"
            : hints.length > 0
              ? "Give hint"
              : "Get hint"}
        </Button>
        <Button
          variant="destructive"
          disabled={busy !== null}
          onClick={() => giveups[0] && resolve(giveups[0].id, true)}
          className={giveups.length > 0 ? "ring-1 ring-destructive" : ""}
        >
          {giveups.length > 0 && (
            <PlayerAvatar
              player={giveups[0].requester}
              className="h-5 w-5 ring-2 ring-destructive/40"
            />
          )}
          Give up
        </Button>
      </div>
      {list.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          {hints.length > 0 && (
            <span>
              {names(hints)} asked for a hint
              <button
                type="button"
                onClick={() => resolve(hints[0].id, false)}
                className="ml-1 underline underline-offset-2 hover:text-foreground"
              >
                Not now
              </button>
            </span>
          )}
          {hints.length > 0 && giveups.length > 0 && <span>·</span>}
          {giveups.length > 0 && (
            <span>
              {names(giveups)} wants to give up
              <button
                type="button"
                onClick={() => resolve(giveups[0].id, false)}
                className="ml-1 underline underline-offset-2 hover:text-foreground"
              >
                Not now
              </button>
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// The approved hint settles out of the scramble in the requester's row, the
// same reveal the requester sees. The hint is credited to them.
function HostReveal({ requester }: { requester: Player }) {
  const { lemma, distance } = MOCK_HINT;
  const [phase, setPhase] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 140);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    // Sending first, then one letter every 200ms.
    const id = setTimeout(
      () => setPhase((p) => p + 1),
      phase === 0 ? 900 : 200,
    );
    if (phase > lemma.length) clearTimeout(id);
    return () => clearTimeout(id);
  }, [phase, lemma.length]);
  const locked = Math.max(0, phase - 1);
  const done = locked >= lemma.length;
  const rest = Array.from(lemma.slice(locked), (_, i) => {
    const k = locked + i;
    return LETTERS[(tick * (k * 7 + 3) + k * 11) % 26];
  }).join("");
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-neutral-900/60 ${
        done ? "ring-2 ring-emerald-400" : "ring-1 ring-white/30"
      }`}
    >
      <div
        className="absolute inset-y-0 left-0 transition-[width] duration-1000 ease-out"
        style={{ width: done ? "99%" : "0%", background: "rgb(76 175 121)" }}
      />
      <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
        <span className="flex-1 truncate font-semibold tracking-wide">
          {phase === 0 ? (
            <span className="text-white/45">sending to {requester.name}…</span>
          ) : (
            <>
              {lemma.slice(0, locked)}
              <span className="text-white/45">{rest}</span>
            </>
          )}
        </span>
        <span className="rounded bg-black/30 px-1.5 py-0.5 text-xs">hint</span>
        <PlayerAvatar player={requester} />
        <span className="min-w-[3ch] text-right font-mono text-sm tabular-nums">
          {done ? distance + 1 : "?"}
        </span>
      </div>
    </div>
  );
}

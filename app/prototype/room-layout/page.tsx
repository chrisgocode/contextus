"use client";

// PROTOTYPE — throwaway. Three room-screen layouts for a Host mid-game with two
// pending requests, switchable via `?variant=A|B|C` (← → keys too). Mock data
// only, no Convex, so it runs without a deployment. `?sheet=1` opens B's sheet,
// `?menu=1` opens the overflow menu, `?inbox=1` expands A's request tray.
// `?role=guest` shows the requester's side (shuffling hint row, pulsing
// give-up row); `?giving=1` starts the Host's hint reveal on load. ✓ / ✕ on a
// request really run the shimmer → scramble → reveal from #194 / #197.
// Question: how do we stop the room screen feeling cramped with buttons?

import {
  ArrowUp02Icon,
  BulbIcon,
  Cancel01Icon,
  Copy01Icon,
  Flag01Icon,
  MoreHorizontalIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import {
  HintTag,
  RevealRow,
  Scramble,
} from "@/app/(app)/r/[code]/_components/RequestReveal";
import { AppearancePicker } from "@/components/AppearancePicker";
import { PrototypeSwitcher } from "@/components/PrototypeSwitcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

// ---------- mock data ----------

const ROOM = "GPYLAL";
const GAME = 1475;
const MEMBERS = [
  { name: "chris", host: true, online: true },
  { name: "VerboseVisitor", host: false, online: true },
  { name: "QuietQuokka", host: false, online: true },
  { name: "SleepySloth", host: false, online: false },
];
type Req = { id: number; name: string; type: "hint" | "giveup"; left: string };
const REQUESTS: Req[] = [
  { id: 1, name: "VerboseVisitor", type: "hint", left: "0:42" },
  { id: 2, name: "QuietQuokka", type: "giveup", left: "0:31" },
];
const HINT = { lemma: "harbor", distance: 118 };
const FINDING_MS = 1800;
const GIVEN_HINT_MS = 4000;
const GUESSES = [
  ["ocean", 41, "chris"],
  ["water", 87, "VerboseVisitor"],
  ["river", 233, "QuietQuokka"],
  ["boat", 640, "chris"],
  ["island", 812, "VerboseVisitor"],
  ["sand", 1203, "QuietQuokka"],
  ["cloud", 1920, "chris"],
  ["tree", 2563, "VerboseVisitor"],
  ["paper", 3100, "chris"],
  ["engine", 4410, "QuietQuokka"],
  ["guitar", 5832, "VerboseVisitor"],
  ["spoon", 7012, "chris"],
] as const;
const LATEST = GUESSES[8];

function barWidthPct(distance: number) {
  return Math.max(3, 100 * Math.exp(-distance / 500));
}
function barColor(distance: number) {
  if (distance <= 300) return "rgb(76 175 121)";
  if (distance <= 1500) return "rgb(232 144 84)";
  return "rgb(220 70 110)";
}

// ---------- shared bits (rows only; layouts are per-variant) ----------

function Initial({
  name,
  className = "h-5 w-5",
}: {
  name: string;
  className?: string;
}) {
  return (
    <Avatar className={`${className} ring-1 ring-black/30`}>
      <AvatarFallback className="text-[10px]">
        {name[0].toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );
}

function GuessRow({
  g,
  highlight,
  compact,
}: {
  g: (typeof GUESSES)[number];
  highlight?: boolean;
  compact?: boolean;
}) {
  const [lemma, distance, player] = g;
  return (
    <div
      className={`relative overflow-hidden rounded-md bg-neutral-900/60 ${
        highlight ? "ring-2 ring-foreground" : ""
      }`}
    >
      <div
        className="absolute inset-y-0 left-0"
        style={{
          width: `${barWidthPct(distance)}%`,
          background: barColor(distance),
        }}
      />
      <div
        className={`relative flex items-center gap-2 px-3 text-white ${
          compact ? "py-1.5" : "py-2.5"
        }`}
      >
        <span className="flex-1 truncate font-semibold">{lemma}</span>
        <Initial name={player} />
        <span className="min-w-[4ch] text-right font-mono text-sm tabular-nums opacity-90">
          {distance + 1}
        </span>
      </div>
    </div>
  );
}

function Icon({
  icon,
  className = "size-4",
}: {
  icon: typeof Copy01Icon;
  className?: string;
}) {
  return (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={2}
      aria-hidden="true"
      className={className}
    />
  );
}

function useFlag(name: string) {
  const params = useSearchParams();
  return useState(params.get(name) === "1");
}

// Room actions that aren't part of playing: one menu instead of four buttons.
function RoomMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Room menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
      >
        <Icon icon={MoreHorizontalIcon} className="size-5" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 w-56 rounded-lg border bg-popover p-1 text-sm shadow-xl">
          <MenuItem>
            <Icon icon={Copy01Icon} /> Copy invite link
          </MenuItem>
          <div className="flex items-center justify-between px-2 py-1.5">
            <span>Appearance</span>
            <AppearancePicker />
          </div>
          <div className="my-1 h-px bg-border" />
          <MenuItem>Leave room</MenuItem>
          <MenuItem danger>End room for everyone</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  danger,
}: {
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent ${
        danger ? "text-rose-400" : ""
      }`}
    >
      {children}
    </button>
  );
}

function MembersAside() {
  return (
    <aside className="hidden lg:block">
      <section className="border p-4">
        <h2 className="mb-3 font-semibold">Members</h2>
        <ul className="flex flex-col gap-2">
          {MEMBERS.map((m) => (
            <li
              key={m.name}
              className={`flex items-center gap-2 px-2 py-1 ${m.online ? "" : "opacity-50"}`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  m.online ? "bg-emerald-400" : "border border-muted-foreground"
                }`}
              />
              <Initial name={m.name} className="h-6 w-6" />
              <span className="flex-1 truncate text-sm">{m.name}</span>
              {m.host && (
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-200">
                  host
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

function AvatarStack() {
  const online = MEMBERS.filter((m) => m.online);
  return (
    <span className="flex items-center" aria-label={`${online.length} online`}>
      {online.map((m) => (
        <span key={m.name} className="-ml-1.5 first:ml-0">
          <Initial name={m.name} className="h-6 w-6 ring-2 ring-background" />
        </span>
      ))}
    </span>
  );
}

// ---------- request state + the animated rows from #194 / #197 ----------
// Shared by every variant: the layouts differ in where the controls live, but
// the rows that shuffle and reveal stay the same above the guess list.

type Giving = { request: Req; found: boolean };

function useRoomState() {
  const params = useSearchParams();
  const guest = params.get("role") === "guest";
  const [pending, setPending] = useState<Req[]>(REQUESTS);
  const [giving, setGiving] = useState<Giving[]>(() =>
    params.get("giving") === "1"
      ? [{ request: REQUESTS[0], found: false }]
      : [],
  );
  // The guest's own requests, as RequestRows shows them.
  const [mine, setMine] = useState<{ hint: boolean; giveup: boolean }>({
    hint: guest,
    giveup: guest,
  });

  useEffect(() => {
    const finding = giving.filter((g) => !g.found);
    if (finding.length === 0) return;
    const id = setTimeout(
      () => setGiving((gs) => gs.map((g) => ({ ...g, found: true }))),
      FINDING_MS,
    );
    return () => clearTimeout(id);
  }, [giving]);

  return {
    guest,
    pending: guest ? [] : pending,
    giving,
    mine,
    setMine,
    approve(r: Req) {
      setPending((ps) => ps.filter((p) => p.id !== r.id));
      if (r.type === "hint")
        setGiving((gs) => [...gs, { request: r, found: false }]);
    },
    deny(r: Req) {
      setPending((ps) => ps.filter((p) => p.id !== r.id));
    },
    forget(r: Req) {
      setGiving((gs) => gs.filter((g) => g.request.id !== r.id));
    },
  };
}
type RoomState = ReturnType<typeof useRoomState>;

function LiveRows({ state }: { state: RoomState }) {
  const { giving, guest, mine } = state;
  if (giving.length === 0 && !(guest && (mine.hint || mine.giveup)))
    return null;
  return (
    <div className="flex flex-col gap-2">
      {guest && mine.giveup && (
        <section>
          <LiveLabel
            label="Answer · if host agrees"
            onTakeBack={() => state.setMine({ ...mine, giveup: false })}
          />
          <div className="relative overflow-hidden rounded-md border border-dashed border-destructive/60 bg-neutral-900/60">
            <div className="flex items-center gap-2 px-3 py-2.5 text-white">
              <span className="flex flex-1 items-center gap-1" aria-hidden>
                {Array.from({ length: 7 }, (_, i) => (
                  <span
                    key={i}
                    className="inline-block h-4 w-3 bg-white/25 motion-safe:animate-pulse"
                    style={{ animationDelay: `${i * 120}ms` }}
                  />
                ))}
              </span>
              <span className="text-xs tabular-nums text-white/60">0:31</span>
              <Initial name="chris" />
              <span className="min-w-[3ch] text-right font-mono text-sm">
                1
              </span>
            </div>
          </div>
        </section>
      )}
      {guest && mine.hint && (
        <section>
          <LiveLabel
            label="Incoming hint"
            onTakeBack={() => state.setMine({ ...mine, hint: false })}
          />
          <div className="relative overflow-hidden rounded-md border border-dashed border-white/30 bg-neutral-900/60">
            <div className="absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-emerald-400/25 to-transparent motion-safe:animate-request-shimmer motion-reduce:hidden" />
            <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
              <span className="flex-1 truncate font-semibold tracking-wide text-white/45">
                <Scramble />
              </span>
              <span className="text-xs tabular-nums text-white/60">0:42</span>
              <HintTag />
              <Initial name="chris" />
              <span className="min-w-[3ch] text-right font-mono text-sm text-white/60">
                ?
              </span>
            </div>
          </div>
        </section>
      )}
      {giving.map(({ request, found }) =>
        found ? (
          <RevealRow
            key={request.id}
            lemma={HINT.lemma}
            distance={HINT.distance}
            player={{ name: request.name }}
            onSettled={() =>
              setTimeout(() => state.forget(request), GIVEN_HINT_MS)
            }
          />
        ) : (
          <div
            key={request.id}
            className="relative overflow-hidden rounded-md bg-neutral-900/60 ring-1 ring-white/30"
          >
            <div className="absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-emerald-400/25 to-transparent motion-safe:animate-request-shimmer motion-reduce:hidden" />
            <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
              <span className="flex-1 truncate font-semibold tracking-wide text-white/45">
                <Scramble />
              </span>
              <HintTag />
              <Initial name={request.name} />
              <span className="min-w-[3ch] text-right font-mono text-sm text-white/60">
                ?
              </span>
            </div>
          </div>
        ),
      )}
    </div>
  );
}

function LiveLabel({
  label,
  onTakeBack,
}: {
  label: string;
  onTakeBack: () => void;
}) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <Button variant="ghost" size="xs" onClick={onTakeBack}>
        Take back
      </Button>
    </div>
  );
}

// ---------- Variant A: thumb dock ----------
// Everything you *do* lives in a dock at the bottom of the screen (where the
// thumb and keyboard are). The top is just identity; the middle is the list.
// Requests collapse into a tray on the dock that expands on tap.

function VariantA() {
  const [menu, setMenu] = useFlag("menu");
  const [inbox, setInbox] = useFlag("inbox");
  const state = useRoomState();
  const { pending, guest } = state;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4 pb-44 sm:p-6 sm:pb-44">
      <header className="flex items-center gap-3">
        <button className="group min-w-0 text-left" aria-label="Copy room code">
          <span className="flex items-center gap-2">
            <h1 className="font-mono text-3xl font-bold tracking-widest">
              {ROOM}
            </h1>
            <Icon icon={Copy01Icon} className="size-4 text-muted-foreground" />
          </span>
          <span className="text-sm text-muted-foreground">Game #{GAME}</span>
        </button>
        <span className="flex-1" />
        <span className="lg:hidden">
          <AvatarStack />
        </span>
        <RoomMenu open={menu} onOpenChange={setMenu} />
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex min-w-0 flex-col gap-1">
          <LiveRows state={state} />
          {GUESSES.map((g) => (
            <GuessRow key={g[0]} g={g} highlight={g === LATEST} />
          ))}
        </div>
        <MembersAside />
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 p-3 lg:pr-[calc(280px+3rem)]">
          {pending.length === 0 ? null : inbox ? (
            <div className="flex flex-col gap-1.5">
              <button
                className="flex items-center justify-between text-xs uppercase tracking-wide text-muted-foreground"
                onClick={() => setInbox(false)}
              >
                <span>Requests · {pending.length}</span>
                <span>Hide ▾</span>
              </button>
              {pending.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-md bg-neutral-900/80 px-2.5 py-1.5 text-sm text-white"
                >
                  <Initial name={r.name} className="h-6 w-6" />
                  <span className="flex min-w-0 flex-1 flex-col leading-tight">
                    <b className="truncate">{r.name}</b>
                    <span className="text-xs text-white/60">
                      {r.type === "hint" ? "wants a hint" : "wants to give up"}{" "}
                      · {r.left}
                    </span>
                  </span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Deny"
                    onClick={() => state.deny(r)}
                  >
                    <Icon icon={Cancel01Icon} />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant={r.type === "giveup" ? "destructive" : "default"}
                    aria-label={r.type === "hint" ? "Give hint" : "Give up"}
                    onClick={() => state.approve(r)}
                  >
                    <Icon icon={Tick02Icon} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <button
              onClick={() => setInbox(true)}
              className="flex items-center gap-2 self-start rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
            >
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-white/25 px-1">
                {pending.length}
              </span>
              requests waiting ▴
            </button>
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={guest ? "Request hint" : "Get hint"}
              disabled={guest && state.mine.hint}
              onClick={() =>
                guest && state.setMine({ ...state.mine, hint: true })
              }
            >
              <Icon icon={BulbIcon} />
            </Button>
            <div className="relative flex-1">
              <input
                placeholder="Type a word…"
                className="h-11 w-full rounded-md border bg-neutral-900/60 pl-3 pr-11 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                aria-label="Guess"
                className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md bg-primary text-primary-foreground"
              >
                <Icon icon={ArrowUp02Icon} />
              </button>
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label={guest ? "Request give up" : "Give up"}
              className="text-rose-400"
              disabled={guest && state.mine.giveup}
              onClick={() =>
                guest && state.setMine({ ...state.mine, giveup: true })
              }
            >
              <Icon icon={Flag01Icon} />
            </Button>
          </div>
        </div>
      </div>
    </main>
  );
}

// ---------- Variant B: one Assist button + sheet ----------
// The screen shows only playing: input and list. Hints, give-ups, and the
// requests that ask for them all live behind one Assist button whose badge
// counts waiting requests.

function VariantB() {
  const [menu, setMenu] = useFlag("menu");
  const [sheet, setSheet] = useFlag("sheet");
  const state = useRoomState();
  const { pending, guest } = state;
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <header className="flex items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Room</p>
          <h1 className="font-mono text-3xl font-bold tracking-widest">
            {ROOM}
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm">
            <Icon icon={Copy01Icon} /> Invite
          </Button>
          <RoomMenu open={menu} onOpenChange={setMenu} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <input
                placeholder="Type a word…"
                className="h-12 w-full rounded-md border bg-neutral-900/60 pl-3 pr-12 text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <button
                aria-label="Guess"
                className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md bg-primary text-primary-foreground"
              >
                <Icon icon={ArrowUp02Icon} />
              </button>
            </div>
            <Button
              variant="outline"
              className="relative h-12 px-3"
              onClick={() => setSheet(true)}
              aria-label={`Assist, ${pending.length} requests`}
            >
              <Icon icon={BulbIcon} className="size-5" />
              <span className="hidden sm:inline">Assist</span>
              {pending.length > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
                  {pending.length}
                </span>
              )}
            </Button>
          </div>

          <div className="flex items-baseline justify-between text-xs uppercase tracking-wide text-muted-foreground">
            <span>Game #{GAME}</span>
            <span>{GUESSES.length} guesses</span>
          </div>
          <LiveRows state={state} />
          <div>
            <p className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
              Latest
            </p>
            <GuessRow g={LATEST} highlight />
          </div>
          <div className="flex flex-col gap-1">
            {GUESSES.map((g) => (
              <GuessRow key={g[0]} g={g} />
            ))}
          </div>
        </div>
        <MembersAside />
      </div>

      {sheet && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 sm:items-center">
          <button
            aria-label="Close"
            className="absolute inset-0"
            onClick={() => setSheet(false)}
          />
          <div className="relative w-full max-w-md rounded-t-2xl border bg-popover p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:rounded-2xl">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/40 sm:hidden" />
            {pending.length > 0 && (
              <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
                Waiting on you · {pending.length}
              </h2>
            )}
            <ul className="mb-4 flex flex-col divide-y rounded-lg border empty:hidden">
              {pending.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 p-3">
                  <div className="flex items-center gap-2">
                    <Initial name={r.name} className="h-7 w-7" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {r.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.type === "hint"
                          ? "wants a hint"
                          : "wants to give up"}{" "}
                        · {r.left} left
                      </span>
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" onClick={() => state.deny(r)}>
                      Deny
                    </Button>
                    <Button
                      variant={r.type === "giveup" ? "destructive" : "default"}
                      onClick={() => {
                        state.approve(r);
                        setSheet(false);
                      }}
                    >
                      {r.type === "hint" ? "Give hint" : "Give up"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
            <h2 className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              You
            </h2>
            <div className="flex flex-col gap-2">
              <button
                className="flex items-center gap-3 rounded-lg border p-3 text-left hover:bg-accent"
                onClick={() => {
                  if (guest) state.setMine({ ...state.mine, hint: true });
                  setSheet(false);
                }}
              >
                <Icon icon={BulbIcon} className="size-5" />
                <span>
                  <span className="block text-sm font-semibold">
                    {guest ? "Ask the host for a hint" : "Get a hint"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Reveals a closer word for everyone
                  </span>
                </span>
              </button>
              <button
                className="flex items-center gap-3 rounded-lg border border-destructive/40 p-3 text-left hover:bg-destructive/10"
                onClick={() => {
                  if (guest) state.setMine({ ...state.mine, giveup: true });
                  setSheet(false);
                }}
              >
                <Icon icon={Flag01Icon} className="size-5 text-rose-400" />
                <span>
                  <span className="block text-sm font-semibold text-rose-400">
                    {guest ? "Ask the host to give up" : "Give up"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Ends this game and shows the word
                  </span>
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ---------- Variant C: status rail + inline ghost rows ----------
// A single slim rail replaces the header. The input carries its own latest
// result. Requests become rows in the list itself, with tiny ✕ / ✓ controls,
// and hint / give up are quiet text actions under the input.

function VariantC() {
  const [menu, setMenu] = useFlag("menu");
  const state = useRoomState();
  const { pending, guest } = state;
  return (
    <main className="mx-auto flex max-w-6xl flex-col">
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-12 max-w-6xl items-center gap-3 px-4 text-sm">
          <button
            className="flex items-center gap-1.5 font-bold tracking-widest"
            aria-label="Copy room code"
          >
            {ROOM}
            <Icon
              icon={Copy01Icon}
              className="size-3.5 text-muted-foreground"
            />
          </button>
          <span className="text-muted-foreground">#{GAME}</span>
          <span className="flex-1" />
          <AvatarStack />
          <RoomMenu open={menu} onOpenChange={setMenu} />
        </div>
      </div>

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_280px]">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <input
              placeholder="Type a word and press Enter"
              className="h-12 w-full border-b-2 border-foreground/30 bg-transparent px-1 text-xl outline-none focus-visible:border-primary"
            />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                last: <b className="text-foreground">{LATEST[0]}</b>{" "}
                <span
                  className="font-mono"
                  style={{ color: barColor(LATEST[1]) }}
                >
                  {LATEST[1] + 1}
                </span>
              </span>
              <span className="flex shrink-0 gap-3 whitespace-nowrap text-muted-foreground">
                <button
                  className="underline-offset-4 hover:underline disabled:opacity-40"
                  disabled={guest && state.mine.hint}
                  onClick={() =>
                    guest && state.setMine({ ...state.mine, hint: true })
                  }
                >
                  hint
                </button>
                <button
                  className="text-rose-400/80 underline-offset-4 hover:underline disabled:opacity-40"
                  disabled={guest && state.mine.giveup}
                  onClick={() =>
                    guest && state.setMine({ ...state.mine, giveup: true })
                  }
                >
                  give up
                </button>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <LiveRows state={state} />
            {pending.map((r) => (
              <div
                key={r.id}
                className={`flex items-center gap-2 rounded-md border border-dashed px-3 py-1.5 text-sm ${
                  r.type === "giveup"
                    ? "border-destructive/60"
                    : "border-emerald-400/50"
                }`}
              >
                <span className="font-semibold">
                  {r.type === "hint" ? "?" : "⚑"}
                </span>
                <span className="flex min-w-0 flex-1 flex-col leading-tight">
                  <span className="truncate">{r.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.type === "hint" ? "wants a hint" : "wants to give up"} ·{" "}
                    {r.left}
                  </span>
                </span>
                <button
                  aria-label="Deny"
                  onClick={() => state.deny(r)}
                  className="flex size-7 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                >
                  <Icon icon={Cancel01Icon} />
                </button>
                <button
                  aria-label={r.type === "hint" ? "Give hint" : "Give up"}
                  onClick={() => state.approve(r)}
                  className={`flex size-7 items-center justify-center rounded ${
                    r.type === "hint"
                      ? "bg-emerald-600 text-white"
                      : "bg-destructive text-white"
                  }`}
                >
                  <Icon icon={Tick02Icon} />
                </button>
              </div>
            ))}
            {GUESSES.map((g) => (
              <GuessRow key={g[0]} g={g} highlight={g === LATEST} compact />
            ))}
          </div>
        </div>
        <MembersAside />
      </div>
    </main>
  );
}

// ---------- switch ----------

const VARIANTS = [
  { key: "A", name: "Thumb dock" },
  { key: "B", name: "Assist sheet" },
  { key: "C", name: "Status rail" },
];

function Switch() {
  const variant = useSearchParams().get("variant") ?? "A";
  return (
    <>
      {variant === "A" && <VariantA />}
      {variant === "B" && <VariantB />}
      {variant === "C" && <VariantC />}
      <PrototypeSwitcher variants={VARIANTS} />
    </>
  );
}

export default function RoomLayoutPrototype() {
  return (
    <Suspense>
      <Switch />
    </Suspense>
  );
}

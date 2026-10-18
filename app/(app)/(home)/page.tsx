"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type KeyboardEvent,
  type Ref,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  FriendRow,
  FriendsPanel,
  STATUS_LABELS,
  StatusDot,
} from "@/app/_components/FriendsPanel";
import { AppearancePicker } from "@/components/AppearancePicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_INVITES_AT_ONCE } from "@/convex/lib/inviteLimits";
import { roomPath } from "@/lib/room-code";
import { runMutation } from "@/lib/report-error";
import { cn } from "@/lib/utils";
import { preloadCalendar } from "../r/[code]/_components/calendar-loader";
import { markRoomCreated } from "../r/[code]/_components/created-room";
import { GuestLimitPrompt } from "../r/[code]/_components/GuestLimitPrompt";
import { RoomSkeleton } from "../r/[code]/_components/RoomSkeleton";
import {
  type EntryFailure,
  useCreateRoom,
} from "../r/[code]/_components/room-entry";

export default function Home() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [openingRoom, setOpeningRoom] = useState<OpeningRoom>(false);
  const currentUser = useQuery(
    api.users.getUser,
    isAuthenticated ? {} : "skip",
  );
  const isRegistered = isAuthenticated && currentUser?.isAnonymous === false;
  // Signed-out visitors and guests need a way back to their account.
  const canSignIn =
    !isLoading && (!isAuthenticated || currentUser?.isAnonymous === true);

  const header = (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-bold">Contextus</h1>
      <div className="flex items-center gap-2">
        <AppearancePicker />
        {isAuthenticated && <FriendsPanel />}
        {isRegistered ? (
          <Button
            variant="outline"
            onClick={() => {
              if (currentUser?.username)
                router.push(`/user/${currentUser.username}`);
            }}
            disabled={!currentUser?.username}
          >
            Profile
          </Button>
        ) : canSignIn ? (
          <Button asChild variant="outline">
            <Link href="/signin">Sign in</Link>
          </Button>
        ) : null}
      </div>
    </header>
  );
  const loadingOverlay =
    openingRoom &&
    createPortal(
      <div
        role="status"
        aria-label="Opening room"
        className="fixed inset-0 z-50 overflow-auto bg-background"
      >
        <RoomSkeleton waiting={openingRoom === "waiting"} />
      </div>,
      document.body,
    );

  // Create and Join render before auth resolves so they are in the SSR HTML.
  // Auth-dependent sections come after them, so their late appearance
  // doesn't shift the cards.
  return (
    <>
      {loadingOverlay}
      <div inert={Boolean(openingRoom)} className="contents">
        {header}
        <HomeIntro />
        <CreateRoom
          isRegistered={isRegistered}
          onOpeningChange={setOpeningRoom}
        />
        <JoinRoom onOpeningChange={setOpeningRoom} />
        {isAuthenticated && <MyRooms />}
        {isRegistered && <RecentGroups />}
        {isRegistered && <FriendSuggestions />}
      </div>
    </>
  );
}

function HomeIntro() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-semibold">Play Contexto with friends</h2>
      <p className="max-w-xl text-muted-foreground">
        Play Contexto with friends in real time. Create a room, share its code,
        and work together to find the hidden word. Everyone sees the same
        guesses and how close each word is to the answer.
      </p>
      <p className="text-sm text-muted-foreground">
        Free to play in your browser. No account needed to start. New to the
        game?{" "}
        <Link className="underline underline-offset-4" href="/how-to-play">
          Learn how to play
        </Link>
        .
      </p>
      <Link className="text-sm underline underline-offset-4" href="/privacy">
        Privacy notice
      </Link>
    </section>
  );
}

type OpeningRoom = false | "waiting" | "unknown";

function CreateRoom({
  isRegistered,
  onOpeningChange,
}: {
  isRegistered: boolean;
  onOpeningChange: (opening: OpeningRoom) => void;
}) {
  const router = useRouter();
  const createRoom = useCreateRoom();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<EntryFailure | null>(null);
  const [picking, setPicking] = useState(false);
  const playWithFriends = useRef<HTMLButtonElement>(null);
  const roster = useRef<HTMLDivElement>(null);
  const switched = useRef(false);

  // Focus follows the switch, so keyboard users land in what replaced the
  // button they pressed.
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    (picking ? roster : playWithFriends).current?.focus();
  }, [picking]);

  function switchTo(next: boolean) {
    setFailure(null);
    setPicking(next);
    switched.current = true;
  }

  async function start(invite?: Id<"users">[]) {
    setFailure(null);
    setBusy(true);
    onOpeningChange("waiting");
    // The new room opens on the game setup calendar.
    preloadCalendar();
    const result = await createRoom(invite);
    if (result.kind === "created") {
      markRoomCreated(result.code);
      router.push(`/r/${result.code}`);
    } else {
      onOpeningChange(false);
      setFailure(result);
    }
    setBusy(false);
  }

  return (
    <section className="rounded-lg border p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Start a new room</h2>
      <p className="text-sm text-muted-foreground">
        You will be the host. Share the room code with friends to play together.
      </p>
      {picking ? (
        <FriendRoster
          ref={roster}
          busy={busy}
          onStart={start}
          onCancel={() => switchTo(false)}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          {/* A failure is shown inline. */}
          <Button disabled={busy} onClick={() => start()}>
            {busy ? "Creating…" : "Create room"}
          </Button>
          {isRegistered && (
            <Button
              ref={playWithFriends}
              variant="outline"
              disabled={busy}
              onClick={() => switchTo(true)}
            >
              Play with friends
            </Button>
          )}
        </div>
      )}
      {failure?.kind === "guestLimit" ? (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <GuestLimitPrompt redirectTo="/" buttonVariant="outline" />
        </div>
      ) : failure?.kind === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {failure.message}
        </p>
      ) : null}
    </section>
  );
}

type RosterFriend = NonNullable<
  FunctionReturnType<typeof api.friends.overview>
>["friends"][number];

function createLabel(names: string[]) {
  if (names.length === 0) return "Pick friends to invite";
  if (names.length === 1) return `Create room with ${names[0]}`;
  if (names.length === 2) return `Create room with ${names[0]} and ${names[1]}`;
  return `Create room with ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

// Play with friends, in place of the Create room buttons: one searchable list
// that stays the same height however many Friends there are.
function FriendRoster({
  ref,
  busy,
  onStart,
  onCancel,
}: {
  ref: Ref<HTMLDivElement>;
  busy: boolean;
  onStart: (invite: Id<"users">[]) => Promise<void>;
  onCancel: () => void;
}) {
  const overview = useQuery(api.friends.overview, {});
  const [picked, setPicked] = useState<ReadonlySet<Id<"users">>>(new Set());
  const [query, setQuery] = useState("");
  const [onlyPicked, setOnlyPicked] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const friends = overview?.friends ?? [];
  // Friends removed since they were picked aren't invited.
  const invited = friends.filter((friend) => picked.has(friend.id));
  const atLimit = invited.length >= MAX_INVITES_AT_ONCE;
  const showingPicked = onlyPicked && invited.length > 0;
  const shown = friends.filter(
    (friend) =>
      matchesFriend(friend, query) && (!showingPicked || picked.has(friend.id)),
  );
  const groups = [
    {
      title: "Online",
      friends: shown.filter((friend) => friend.status.kind !== "offline"),
    },
    {
      title: "Offline",
      friends: shown.filter((friend) => friend.status.kind === "offline"),
    },
  ].filter((group) => group.friends.length > 0);

  function toggle(id: Id<"users">) {
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-label="Play with friends"
      aria-busy={overview === undefined}
      className="flex flex-col gap-3 outline-none"
    >
      {overview === undefined ? null : friends.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Add Friends from the Friends panel to invite them here.
        </p>
      ) : (
        <>
          <div className="border" onKeyDown={moveBetweenFriends}>
            <div className="flex h-11 items-center border-b sm:h-9">
              <Input
                ref={search}
                type="search"
                aria-label="Find a friend"
                placeholder="Find a friend"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-full border-0 bg-transparent focus-visible:ring-0 dark:bg-transparent [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query !== "" && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery("");
                    search.current?.focus();
                  }}
                  className="grid size-8 shrink-0 place-items-center text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  ×
                </button>
              )}
              {invited.length > 0 && (
                <button
                  type="button"
                  aria-pressed={showingPicked}
                  onClick={() => setOnlyPicked(!showingPicked)}
                  className="mr-2 shrink-0 px-1.5 py-0.5 text-xs text-muted-foreground tabular-nums outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/15 aria-pressed:text-foreground"
                >
                  {invited.length} picked
                </button>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto pb-1">
              {groups.length === 0 && (
                <p className="px-3 py-2 text-sm text-muted-foreground">
                  No friend matches “{query.trim()}”.
                </p>
              )}
              {groups.map((group) => (
                <section key={group.title} aria-label={group.title}>
                  <h3 className="sticky top-0 z-10 flex h-6 items-center justify-between bg-card px-3 text-[11px] tracking-wide text-muted-foreground uppercase">
                    <span>{group.title}</span>
                    <span className="tabular-nums">{group.friends.length}</span>
                  </h3>
                  {group.friends.map((friend) => (
                    <RosterRow
                      key={friend.id}
                      friend={friend}
                      picked={picked.has(friend.id)}
                      disabled={busy || (atLimit && !picked.has(friend.id))}
                      onToggle={() => toggle(friend.id)}
                    />
                  ))}
                </section>
              ))}
            </div>
          </div>
          {atLimit && (
            <p className="text-sm text-muted-foreground">
              You can invite up to {MAX_INVITES_AT_ONCE} friends at once.
            </p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        {friends.length > 0 && (
          <Button
            className="h-11 w-full max-w-full sm:h-8 sm:w-auto"
            disabled={busy || invited.length === 0}
            onClick={() => onStart(invited.map((friend) => friend.id))}
          >
            <span className="truncate">
              {busy
                ? "Creating…"
                : createLabel(invited.map((friend) => friend.name))}
            </span>
          </Button>
        )}
        <Button
          variant="ghost"
          className="h-11 w-full sm:h-8 sm:w-auto"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function matchesFriend(friend: RosterFriend, query: string) {
  const needle = query.trim().toLowerCase();
  return (
    friend.name.toLowerCase().includes(needle) ||
    (friend.username ?? "").includes(needle)
  );
}

function moveBetweenFriends(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const rows = [
    ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
      "[data-friend]:not(:disabled)",
    ),
  ];
  if (rows.length === 0) return;
  e.preventDefault();
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  const step = e.key === "ArrowDown" ? 1 : -1;
  const next =
    at === -1
      ? step === 1
        ? 0
        : rows.length - 1
      : Math.min(Math.max(at + step, 0), rows.length - 1);
  rows[next].focus();
}

function RosterRow({
  friend,
  picked,
  disabled,
  onToggle,
}: {
  friend: RosterFriend;
  picked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const offline = friend.status.kind === "offline";
  return (
    <button
      type="button"
      data-friend
      aria-pressed={picked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "flex h-11 w-full scroll-my-6 items-center gap-2.5 px-3 text-left text-sm outline-none hover:bg-input/30 focus-visible:bg-input/50 disabled:opacity-40 sm:h-8",
        picked && "bg-primary/10",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "grid size-4 shrink-0 place-items-center border text-[10px] leading-none",
          picked
            ? "border-primary bg-primary text-primary-foreground"
            : "border-input",
        )}
      >
        {picked && "✓"}
      </span>
      <span aria-hidden="true" className="relative shrink-0">
        <Avatar size="sm">
          {friend.image && <AvatarImage src={friend.image} alt="" />}
          <AvatarFallback>
            {friend.name.slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <StatusDot
          offline={offline}
          className="absolute -right-0.5 -bottom-0.5 size-2.5 ring-2 ring-card"
        />
      </span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          offline && !picked && "text-muted-foreground",
        )}
      >
        {friend.name}
      </span>{" "}
      <span
        className={cn(
          "shrink-0 text-xs text-muted-foreground",
          friend.status.kind !== "inRoom" && "sr-only",
        )}
      >
        {STATUS_LABELS[friend.status.kind]}
      </span>
    </button>
  );
}

// Joining is only navigation: the room page joins signed-in users and offers
// guests "Join as guest", so this form doesn't need auth state. The GET
// action to /join makes it work before hydration too.
function JoinRoom({
  onOpeningChange,
}: {
  onOpeningChange: (opening: OpeningRoom) => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  return (
    <section className="rounded-lg border p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Join a room</h2>
      <form
        action="/join"
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          onOpeningChange("unknown");
          router.push(roomPath(code));
        }}
      >
        <Input
          name="room"
          placeholder="ABCDEF"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          // Native validation, not a disabled button: the server renders an
          // empty code, and a disabled button would block the pre-hydration
          // submit.
          required
          pattern=".*\S.*"
          autoCapitalize="characters"
          className="uppercase"
        />
        <Button type="submit">Join</Button>
      </form>
    </section>
  );
}

function MyRooms() {
  const rooms = useQuery(api.rooms.listMine, {});
  if (rooms === undefined) return null;
  if (rooms.length === 0) return null;
  return (
    <section className="rounded-lg border p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Your active rooms</h2>
      <ul className="flex flex-col gap-3">
        {rooms.map((r) => (
          <li
            key={r._id}
            className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="border-l-2 border-primary/70 pl-3 font-mono text-base tracking-widest">
              {r.code}
            </span>
            <Button asChild className="h-11 w-full sm:w-auto sm:min-w-36">
              <a href={`/r/${r.code}`}>Join</a>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecentGroups() {
  const router = useRouter();
  const groups = useQuery(api.rooms.listRecentGroups, {});
  const playAgain = useMutation(api.rooms.playAgain);
  const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (groups === undefined || groups.length === 0) return null;

  return (
    <section className="rounded-lg border p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">Play again</h2>
        <p className="text-sm text-muted-foreground">
          Start another session with people you have played with before.
        </p>
      </div>
      <ul className="flex flex-col divide-y border-y">
        {groups.map((group) => {
          const visibleMembers = group.members.slice(0, 3);
          const remaining = group.members.length - visibleMembers.length;
          return (
            <li
              key={group.roomId}
              className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <AvatarGroup className="shrink-0">
                  {visibleMembers.map((member) => (
                    <Avatar key={member.userId} size="lg">
                      {member.player.image && (
                        <AvatarImage src={member.player.image} alt="" />
                      )}
                      <AvatarFallback>
                        {member.player.name.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  ))}
                  {remaining > 0 && (
                    <AvatarGroupCount>+{remaining}</AvatarGroupCount>
                  )}
                </AvatarGroup>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {group.members
                      .map((member) => member.player.name)
                      .join(" + ")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Last played{" "}
                    {new Date(group.lastActivityAt).toLocaleDateString(
                      undefined,
                      {
                        month: "short",
                        day: "numeric",
                      },
                    )}
                  </p>
                </div>
              </div>
              <Button
                className="h-11 w-full sm:w-auto sm:min-w-36"
                disabled={busyRoomId !== null}
                onClick={async () => {
                  setError(null);
                  setBusyRoomId(group.roomId);
                  const result = await runMutation(
                    () => playAgain({ roomId: group.roomId }),
                    {
                      context: "room.playAgain",
                      fallback: "Could not start this room. Try again.",
                    },
                  );
                  if (result.ok) router.push(`/r/${result.value.code}`);
                  else setError(result.message);
                  setBusyRoomId(null);
                }}
              >
                {busyRoomId === group.roomId ? "Starting…" : "Play Contextus"}
              </Button>
            </li>
          );
        })}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

// Sending a request drops someone from the suggestions, so a button only
// ever shows Add friend.
function FriendSuggestions() {
  const suggestions = useQuery(api.friends.suggestions, {});
  const sendRequest = useMutation(api.friends.sendRequest);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  if (suggestions === undefined || suggestions.length === 0) return null;

  return (
    <section className="rounded-lg border p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold">People you played with</h2>
        <p className="text-sm text-muted-foreground">
          Add them as friends to play together again.
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {suggestions.map((player) => (
          <FriendRow key={player.id} player={player}>
            <Button
              size="sm"
              variant="outline"
              disabled={busyUserId !== null}
              onClick={async () => {
                setBusyUserId(player.id);
                await runMutation(
                  () => sendRequest({ userId: player.id, via: "suggestion" }),
                  {
                    context: "friends.sendRequest",
                    fallback: "Could not send a friend request. Try again.",
                  },
                );
                setBusyUserId(null);
              }}
            >
              Add friend
            </Button>
          </FriendRow>
        ))}
      </ul>
    </section>
  );
}

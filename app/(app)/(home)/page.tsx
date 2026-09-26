"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { getErrorData } from "@/lib/client-errors";
import { roomPath } from "@/lib/room-code";
import { reportClientError } from "@/lib/report-error";
import { RoomSkeleton } from "../r/[code]/_components/RoomSkeleton";

export default function Home() {
  const { isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const [openingRoom, setOpeningRoom] = useState(false);
  const currentUser = useQuery(
    api.users.getUser,
    isAuthenticated ? {} : "skip",
  );
  const isRegistered = isAuthenticated && currentUser?.isAnonymous === false;

  const header = (
    <header className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Contextus</h1>
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
      ) : null}
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
        <RoomSkeleton />
      </div>,
      document.body,
    );

  // Create and Join render before auth resolves so they are in the SSR HTML.
  // Auth-dependent sections come after them, so their late appearance
  // doesn't shift the cards.
  return (
    <>
      {loadingOverlay}
      <div inert={openingRoom} className="contents">
        {header}
        <HomeIntro />
        <CreateRoom onOpeningChange={setOpeningRoom} />
        <JoinRoom onOpeningChange={setOpeningRoom} />
        {isAuthenticated && <MyRooms />}
        {isRegistered && <RecentGroups />}
      </div>
    </>
  );
}

/**
 * Returns a function that resolves with `isAuthenticated` once Convex auth
 * has finished loading, so actions clicked early take the right path.
 */
function useSettledAuth() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const settled = useRef<boolean | null>(null);
  const waiters = useRef<((isAuthenticated: boolean) => void)[]>([]);
  useEffect(() => {
    settled.current = isLoading ? null : isAuthenticated;
    if (isLoading) return;
    for (const resolve of waiters.current.splice(0)) resolve(isAuthenticated);
  }, [isLoading, isAuthenticated]);
  return useCallback(
    () =>
      settled.current !== null
        ? Promise.resolve(settled.current)
        : new Promise<boolean>((resolve) => waiters.current.push(resolve)),
    [],
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
    </section>
  );
}

function CreateRoom({
  onOpeningChange,
}: {
  onOpeningChange: (opening: boolean) => void;
}) {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const settledAuth = useSettledAuth();
  const create = useMutation(api.rooms.create);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="rounded-lg border p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Start a new room</h2>
      <p className="text-sm text-muted-foreground">
        You will be the host. Share the room code with friends to play together.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setError(null);
          setBusy(true);
          onOpeningChange(true);
          try {
            if (!(await settledAuth())) await signIn("anonymous");
            const { code } = await create({});
            router.push(`/r/${code}`);
          } catch (err) {
            onOpeningChange(false);
            const isRoomLimit =
              getErrorData(err) === "Guest room limit reached";
            const message = isRoomLimit
              ? "Guest room limit reached"
              : "Could not create room. Try again.";
            setError(message);
            if (!isRoomLimit) {
              reportClientError(err, {
                userMessage: message,
                context: "room.create",
              });
            }
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating…" : "Create room"}
      </Button>
      {error === "Guest room limit reached" ? (
        <div className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>Create an account to host or join more active rooms.</p>
          <Button variant="outline" onClick={() => router.push("/signin")}>
            Create account
          </Button>
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : null}
    </section>
  );
}

// Joining is only navigation: the room page joins signed-in users and offers
// guests "Join as guest", so this form doesn't need auth state. The GET
// action to /join makes it work before hydration too.
function JoinRoom({
  onOpeningChange,
}: {
  onOpeningChange: (opening: boolean) => void;
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
          onOpeningChange(true);
          router.push(roomPath(code));
        }}
      >
        <Input
          name="code"
          placeholder="ABCDEF"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          autoCapitalize="characters"
          className="uppercase"
        />
        <Button type="submit" disabled={code.trim().length === 0}>
          Join
        </Button>
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
                  try {
                    const { code } = await playAgain({ roomId: group.roomId });
                    router.push(`/r/${code}`);
                  } catch (caught) {
                    const message = "Could not start this room. Try again.";
                    setError(message);
                    reportClientError(caught, {
                      userMessage: message,
                      context: "room.playAgain",
                    });
                  } finally {
                    setBusyRoomId(null);
                  }
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

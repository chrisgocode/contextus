"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useRouter, useSearchParams } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";
import {
  AchievementUnlockQueue,
  type AchievementUnlockQueueItem,
} from "@/app/_components/AchievementUnlockQueue";
import { getUnlockedAchievementMetadata } from "@/app/_components/achievement-metadata";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppearancePicker } from "@/components/AppearancePicker";
import { PrototypeSwitcher } from "@/components/PrototypeSwitcher";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { reportClientError } from "@/lib/report-error";
import { EndGameBanner } from "./_components/EndGameBanner";
import { preloadCalendar } from "./_components/calendar-loader";
import { clearCreatedRoom, isCreatedRoom } from "./_components/created-room";
import { GameSetupCalendar } from "./_components/GameSetupCalendar";
import { GuessInput } from "./_components/GuessInput";
import { GuessList } from "./_components/GuessList";
import { HintGiveupBar } from "./_components/HintGiveupBar";
import { HostRequestScrollHint } from "./_components/HostRequestScrollHint";
import { PendingRequestsSidebar } from "./_components/PendingRequestsSidebar";
import {
  REQUEST_PROTOTYPE_STATES,
  REQUEST_PROTOTYPE_VARIANTS,
  RequestPrototype,
} from "./_components/RequestStatus.prototype";
import { GuessListSkeleton, RoomSkeleton } from "./_components/RoomSkeleton";
import { useElementInViewport } from "./_components/useElementInViewport";
import { usePresenceSet } from "./_components/usePresenceSet";
import { useRoomEntry } from "./_components/room-entry";

export default function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const upper = code.toUpperCase();
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { data, isMember, joinError, joinAsGuest, leave } = useRoomEntry(upper);
  const endRoom = useMutation(api.rooms.endRoom);
  const [copied, setCopied] = useState(false);
  // The room as it looked when the viewer clicked Leave. Once the leave
  // mutation lands, the queries describe a non-member, so the page keeps
  // showing this until the home route replaces it.
  const [leavingView, setLeavingView] = useState<Omit<
    RoomLoadedProps,
    "onLeave" | "onEnd" | "copied" | "onCopy"
  > | null>(null);

  // Start fetching the calendar chunk now rather than once the room and game
  // queries say it's needed, so it isn't a second round trip for hosts.
  // (Creating a room from home starts it even earlier.)
  useEffect(() => preloadCalendar(), []);

  // Consumed on mount, so a visit abandoned before the game query resolves
  // can't leave the marker set for a later visit to the same room.
  const [createdCode, setCreatedCode] = useState(() =>
    isCreatedRoom(upper) ? upper : null,
  );
  const created = createdCode === upper;
  const activeGameResult = useQuery(
    api.games.getActive,
    data !== undefined && data !== null && isMember
      ? { roomId: data.room._id }
      : "skip",
  );
  // A room this client just created has no game yet, so skip straight to the
  // setup calendar rather than flashing the guess list skeleton.
  if (created && activeGameResult !== undefined) setCreatedCode(null);
  const activeGame =
    activeGameResult === undefined && created ? null : activeGameResult;
  const lastFinished = useQuery(
    api.games.listFinished,
    data !== undefined && data !== null && isMember && activeGame === null
      ? { roomId: data.room._id }
      : "skip",
  );

  useEffect(() => clearCreatedRoom(upper), [upper]);

  useEffect(() => {
    if (data && data.room.status === "ended") {
      router.replace("/");
    }
  }, [data, router]);

  const roomLoadedHandlers = {
    onLeave: () => {
      if (data == null || leavingView !== null) return;
      setLeavingView({ data, activeGame, lastFinished });
      router.push("/");
      leave().catch((err) => {
        setLeavingView(null);
        reportClientError(err, {
          userMessage: "Could not leave room.",
          context: "room.leave",
        });
      });
    },
    onEnd: async () => {
      if (data == null) return;
      try {
        await endRoom({ roomId: data.room._id });
        router.push("/");
      } catch (err) {
        reportClientError(err, {
          userMessage: "Could not end room.",
          context: "room.end",
        });
      }
    },
    copied,
    onCopy: () => {
      if (data == null) return;
      navigator.clipboard
        .writeText(data.room.code)
        .then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        })
        .catch((err) => {
          reportClientError(err, {
            userMessage: "Copy failed.",
            context: "room.clipboard",
          });
        });
    },
  };

  if (leavingView !== null)
    return <RoomLoaded {...leavingView} {...roomLoadedHandlers} />;
  if (isLoading) return <RoomSkeleton waiting={created} />;
  if (data === undefined) return <RoomSkeleton waiting={created} />;
  if (data === null)
    return (
      <Centered>
        <p>Room not found.</p>
        <Button onClick={() => router.push("/")}>Home</Button>
      </Centered>
    );
  if (!isAuthenticated) {
    return (
      <GuestJoinPrompt
        code={data.room.code}
        onGuest={joinAsGuest}
        onSignIn={() =>
          router.push(`/signin?redirectTo=${encodeURIComponent(`/r/${upper}`)}`)
        }
      />
    );
  }
  if (data.viewerUserId === null) {
    return (
      <Centered>
        <p>Session expired. Signing you out…</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
      </Centered>
    );
  }
  if (!isMember && joinError === "Guest room limit reached") {
    return (
      <Centered>
        <p>Create an account to host or join more active rooms.</p>
        <Button
          onClick={() =>
            router.push(
              `/signin?redirectTo=${encodeURIComponent(`/r/${upper}`)}`,
            )
          }
        >
          Create account
        </Button>
        <Button variant="outline" onClick={() => router.push("/")}>
          Cancel
        </Button>
      </Centered>
    );
  }
  if (!isMember && joinError !== null) {
    return (
      <Centered>
        <p>{joinError}</p>
        <Button onClick={() => window.location.reload()}>Retry</Button>
        <Button variant="outline" onClick={() => router.push("/")}>
          Home
        </Button>
      </Centered>
    );
  }
  if (!isMember) return <RoomSkeleton waiting={created} />;

  return (
    <RoomLoaded
      data={data}
      activeGame={activeGame}
      lastFinished={lastFinished}
      {...roomLoadedHandlers}
    />
  );
}

function GuestJoinPrompt({
  code,
  onGuest,
  onSignIn,
}: {
  code: string;
  onGuest: () => Promise<void>;
  onSignIn: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">Room</p>
        <h1 className="font-mono text-4xl font-bold tracking-widest">{code}</h1>
        <p className="text-muted-foreground">
          Join as a guest to play now, or sign in if you want to host later.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onGuest();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Joining…" : "Join as guest"}
        </Button>
        <Button variant="outline" onClick={onSignIn}>
          Sign in
        </Button>
      </div>
    </main>
  );
}

type RoomLoadedProps = {
  data: NonNullable<ReturnType<typeof useQuery<typeof api.rooms.getByCode>>>;
  activeGame: ReturnType<typeof useQuery<typeof api.games.getActive>>;
  lastFinished: ReturnType<typeof useQuery<typeof api.games.listFinished>>;
  onLeave: () => void;
  onEnd: () => void;
  copied: boolean;
  onCopy: () => void;
};

function RoomLoaded({
  data,
  activeGame,
  lastFinished,
  onLeave,
  onEnd,
  copied,
  onCopy,
}: RoomLoadedProps) {
  const { room, members, isViewerHost, viewerUserId } = data;
  const recent =
    lastFinished && lastFinished.length > 0 ? lastFinished[0] : null;
  const onlineSet = usePresenceSet(room._id, viewerUserId ?? "anon");
  const pendingRequests = useQuery(
    api.requests.listPending,
    activeGame && isViewerHost ? { gameId: activeGame._id } : "skip",
  );
  const [requestsElement, setRequestsElement] = useState<HTMLDivElement | null>(
    null,
  );
  const returnScrollYRef = useRef<number | null>(null);
  const requestsVisible = useElementInViewport(requestsElement, 0.1);
  const pendingRequestCount = pendingRequests?.length ?? 0;
  const [achievementUnlocks, setAchievementUnlocks] = useState<
    AchievementUnlockQueueItem[]
  >([]);
  const [duplicateGuess, setDuplicateGuess] = useState<{
    gameId: string;
    lemma: string;
  } | null>(null);
  // PROTOTYPE: request-status variants, see RequestStatus.prototype.tsx.
  const protoVariant = useSearchParams().get("variant");
  const hostMember = members.find((m) => m.isHost);
  const protoHost = {
    name: hostMember?.player.name ?? "Host",
    image: hostMember?.player.image,
    online: hostMember ? onlineSet.has(hostMember.userId) : false,
  };
  const dismissAchievementUnlock = useCallback(() => {
    setAchievementUnlocks((items) => items.slice(1));
  }, []);

  function onAchievementsUnlocked(ids: string[]) {
    const unlockedAt = Date.now();
    const items = ids.flatMap((id, index) => {
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
    setAchievementUnlocks((current) => [...current, ...items]);
  }

  function scrollToRequests() {
    returnScrollYRef.current = window.scrollY;
    requestsElement?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  function scrollBackAfterApproval() {
    const top = returnScrollYRef.current;
    if (top === null) return;
    returnScrollYRef.current = null;
    requestAnimationFrame(() => {
      window.scrollTo({ top, behavior: "smooth" });
    });
  }

  return (
    <main className="mx-auto max-w-6xl p-6 flex flex-col gap-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-3 sm:items-center sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">Room</p>
          <h1 className="truncate font-mono text-3xl font-bold tracking-widest">
            {room.code}
          </h1>
        </div>
        {/* Phones get an icon-only Copy so the room code and the appearance
            picker both fit on one row beside the host controls. */}
        <div className="flex flex-nowrap items-center justify-end gap-1 sm:gap-2">
          <Button
            variant="outline"
            onClick={onCopy}
            className="w-8 shrink-0 px-0 sm:w-auto sm:min-w-28 sm:px-2.5"
          >
            <HugeiconsIcon
              icon={copied ? Tick02Icon : Copy01Icon}
              strokeWidth={2}
              aria-hidden="true"
              className="size-4 sm:hidden"
            />
            <span className="sr-only sm:not-sr-only">
              {copied ? "Copied!" : "Copy code"}
            </span>
          </Button>
          <Button
            variant="outline"
            onClick={onLeave}
            className="shrink-0 px-2 sm:px-2.5"
          >
            Leave
          </Button>
          {isViewerHost && (
            <Button
              variant="destructive"
              onClick={onEnd}
              className="shrink-0 px-2 sm:px-2.5"
            >
              <span className="sm:hidden">End</span>
              <span className="hidden sm:inline">End room</span>
            </Button>
          )}
          <AppearancePicker />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-6 min-w-0">
          {activeGame === undefined ? (
            <GuessListSkeleton />
          ) : activeGame === null ? (
            <>
              {recent &&
                (recent.status === "won" || recent.status === "given_up") && (
                  <EndGameBanner
                    status={recent.status}
                    answerLemma={recent.answerLemma}
                    gameId={recent._id}
                  />
                )}
              <GameSetupCalendar roomId={room._id} isHost={isViewerHost} />
            </>
          ) : (
            <>
              <div className="flex items-baseline justify-between gap-4 flex-wrap">
                <p className="text-sm text-muted-foreground">
                  Game #{activeGame.contextoGameId}
                </p>
                {protoVariant ? (
                  <RequestPrototype
                    variant={protoVariant}
                    slot="bar"
                    host={protoHost}
                  />
                ) : (
                  <HintGiveupBar
                    gameId={activeGame._id}
                    isHost={isViewerHost}
                  />
                )}
              </div>
              <GuessInput
                gameId={activeGame._id}
                onAchievementsUnlocked={onAchievementsUnlocked}
                onDuplicate={(lemma) =>
                  setDuplicateGuess(
                    lemma ? { gameId: activeGame._id, lemma } : null,
                  )
                }
              />
              {protoVariant && (
                <RequestPrototype
                  variant={protoVariant}
                  slot="list"
                  host={protoHost}
                />
              )}
              <GuessList
                gameId={activeGame._id}
                duplicate={
                  duplicateGuess?.gameId === activeGame._id
                    ? duplicateGuess.lemma
                    : null
                }
              />
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="border p-4">
            <h2 className="font-semibold mb-3">Members</h2>
            <ul className="flex flex-col gap-2">
              {members.map((m) => {
                const online =
                  m.userId === viewerUserId || onlineSet.has(m.userId);
                return (
                  <li
                    key={m.userId}
                    className={`flex items-center gap-2 rounded-md px-2 py-1 ${
                      online ? "" : "opacity-50"
                    }`}
                  >
                    {/* Filled vs. hollow, so status doesn't rely on colour. */}
                    <span
                      role="img"
                      aria-label={online ? "Online" : "Offline"}
                      title={online ? "Online" : "Offline"}
                      className={`h-2 w-2 rounded-full ${
                        online
                          ? "bg-emerald-400"
                          : "border border-muted-foreground"
                      }`}
                    />
                    <Avatar className="h-6 w-6">
                      {m.player.image && (
                        <AvatarImage src={m.player.image} alt={m.player.name} />
                      )}
                      <AvatarFallback>
                        {m.player.name.slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm flex-1 truncate">
                      {m.player.name}
                    </span>
                    {m.isHost && (
                      <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xs text-amber-200">
                        host
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {activeGame && isViewerHost && (
            <div ref={setRequestsElement}>
              <PendingRequestsSidebar
                pending={pendingRequests}
                onApproveSuccess={scrollBackAfterApproval}
              />
            </div>
          )}
        </aside>
      </div>

      {activeGame &&
        isViewerHost &&
        pendingRequestCount > 0 &&
        !requestsVisible && (
          <HostRequestScrollHint
            count={pendingRequestCount}
            onClick={scrollToRequests}
          />
        )}
      {protoVariant && activeGame && (
        <>
          <RequestPrototype
            variant={protoVariant}
            slot="dock"
            host={protoHost}
          />
          <PrototypeSwitcher
            variants={REQUEST_PROTOTYPE_VARIANTS}
            states={REQUEST_PROTOTYPE_STATES}
          />
        </>
      )}
      <AchievementUnlockQueue
        items={achievementUnlocks}
        onItemDone={dismissAchievementUnlock}
      />
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="flex flex-col items-center gap-2 text-center">
        {children}
      </div>
    </main>
  );
}

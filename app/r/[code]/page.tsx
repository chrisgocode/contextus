"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { usePresenceSet } from "./_components/usePresenceSet";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GameSetupCalendar } from "./_components/GameSetupCalendar";
import { GuessInput } from "./_components/GuessInput";
import { GuessList } from "./_components/GuessList";
import { EndGameBanner } from "./_components/EndGameBanner";
import { HintGiveupBar } from "./_components/HintGiveupBar";
import { PendingRequestsSidebar } from "./_components/PendingRequestsSidebar";
import { GuessListSkeleton, RoomSkeleton } from "./_components/RoomSkeleton";
import { reportClientError } from "@/lib/report-error";

export default function RoomPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = use(params);
  const upper = code.toUpperCase();
  const router = useRouter();
  const { isLoading, isAuthenticated } = useConvexAuth();
  const data = useQuery(
    api.rooms.getByCode,
    isAuthenticated ? { code: upper } : "skip",
  );
  const leave = useMutation(api.rooms.leave);
  const endRoom = useMutation(api.rooms.endRoom);
  const join = useMutation(api.rooms.join);
  const [copied, setCopied] = useState(false);
  const [joining, setJoining] = useState(false);

  const isMember =
    data && data.viewerUserId
      ? data.members.some((m) => m.userId === data.viewerUserId)
      : false;

  const activeGame = useQuery(
    api.games.getActive,
    data !== undefined && data !== null && isMember
      ? { roomId: data.room._id }
      : "skip",
  );
  const lastFinished = useQuery(
    api.games.listFinished,
    data !== undefined && data !== null && isMember && activeGame === null
      ? { roomId: data.room._id }
      : "skip",
  );

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/signin");
  }, [isLoading, isAuthenticated, router]);

  useEffect(() => {
    if (data && data.room.status === "ended") {
      router.replace("/");
    }
  }, [data, router]);

  useEffect(() => {
    if (data && data.room.status === "active" && !isMember && !joining) {
      setJoining(true);
      join({ code: upper })
        .catch((err) => {
          reportClientError(err, {
            userMessage: "Could not join room.",
            context: "room.autojoin",
          });
        })
        .finally(() => setJoining(false));
    }
  }, [data, isMember, joining, join, upper]);

  if (isLoading) return <RoomSkeleton />;
  if (!isAuthenticated) return <RoomSkeleton />;
  if (data === undefined) return <RoomSkeleton />;
  if (data === null)
    return (
      <Centered>
        <p>Room not found.</p>
        <Button onClick={() => router.push("/")}>Home</Button>
      </Centered>
    );
  if (!isMember) return <RoomSkeleton />;

  return (
    <RoomLoaded
      data={data}
      activeGame={activeGame}
      lastFinished={lastFinished}
      onLeave={async () => {
        await leave({ roomId: data.room._id });
        router.push("/");
      }}
      onEnd={async () => {
        await endRoom({ roomId: data.room._id });
        router.push("/");
      }}
      copied={copied}
      onCopy={() => {
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
      }}
    />
  );
}

type RoomLoadedProps = {
  data: NonNullable<
    ReturnType<typeof useQuery<typeof api.rooms.getByCode>>
  >;
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

  return (
    <main className="mx-auto max-w-6xl p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">Room</p>
          <h1 className="font-mono text-3xl font-bold tracking-widest">
            {room.code}
          </h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" onClick={onCopy}>
            {copied ? "Copied!" : "Copy code"}
          </Button>
          <Button variant="outline" onClick={onLeave}>
            Leave
          </Button>
          {isViewerHost && (
            <Button variant="destructive" onClick={onEnd}>
              End room
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <div className="flex flex-col gap-6 min-w-0">
          {activeGame === undefined ? (
            <GuessListSkeleton />
          ) : activeGame === null ? (
            <>
              {recent &&
                (recent.status === "won" ||
                  recent.status === "given_up") && (
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
                <HintGiveupBar
                  gameId={activeGame._id}
                  isHost={isViewerHost}
                />
              </div>
              <GuessInput gameId={activeGame._id} />
              <GuessList gameId={activeGame._id} />
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <section className="rounded-lg border p-4">
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
                    <span
                      className={`h-2 w-2 rounded-full ${
                        online ? "bg-emerald-400" : "bg-muted-foreground/40"
                      }`}
                    />
                    <Avatar className="h-6 w-6">
                      {m.image && (
                        <AvatarImage src={m.image} alt={m.name ?? ""} />
                      )}
                      <AvatarFallback>
                        {(m.name ?? "?").slice(0, 1).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm flex-1 truncate">
                      {m.name ?? "Anonymous"}
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
            <PendingRequestsSidebar gameId={activeGame._id} />
          )}
        </aside>
      </div>
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

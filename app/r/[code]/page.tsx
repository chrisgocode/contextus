"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GameSetupCalendar } from "./_components/GameSetupCalendar";
import { GuessInput } from "./_components/GuessInput";
import { GuessList } from "./_components/GuessList";
import { EndGameBanner } from "./_components/EndGameBanner";
import { HintGiveupBar } from "./_components/HintGiveupBar";
import { PendingRequestsSidebar } from "./_components/PendingRequestsSidebar";

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
  const [copied, setCopied] = useState(false);

  const activeGame = useQuery(
    api.games.getActive,
    data !== undefined && data !== null
      ? { roomId: data.room._id }
      : "skip",
  );
  const lastFinished = useQuery(
    api.games.listFinished,
    data !== undefined && data !== null && activeGame === null
      ? { roomId: data.room._id }
      : "skip",
  );

  if (isLoading) return <Centered>Loading…</Centered>;
  if (!isAuthenticated) {
    router.replace("/signin");
    return null;
  }
  if (data === undefined) return <Centered>Loading room…</Centered>;
  if (data === null)
    return (
      <Centered>
        <p>Room not found.</p>
        <Button onClick={() => router.push("/")}>Home</Button>
      </Centered>
    );

  const { room, members, isViewerHost } = data;
  const recent =
    lastFinished && lastFinished.length > 0 ? lastFinished[0] : null;

  return (
    <main className="mx-auto max-w-3xl p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm text-muted-foreground">Room</p>
          <h1 className="font-mono text-3xl font-bold tracking-widest">
            {room.code}
          </h1>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(room.code);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied!" : "Copy code"}
          </Button>
          <Button
            variant="outline"
            onClick={async () => {
              await leave({ roomId: room._id });
              router.push("/");
            }}
          >
            Leave
          </Button>
          {isViewerHost && (
            <Button
              variant="destructive"
              onClick={async () => {
                await endRoom({ roomId: room._id });
                router.push("/");
              }}
            >
              End room
            </Button>
          )}
        </div>
      </header>

      <section className="rounded-lg border p-4">
        <h2 className="font-semibold mb-3">Members</h2>
        <ul className="flex flex-wrap gap-3">
          {members.map((m) => (
            <li
              key={m.userId}
              className="flex items-center gap-2 rounded-full border px-3 py-1.5"
            >
              <Avatar className="h-6 w-6">
                {m.image && <AvatarImage src={m.image} alt={m.name ?? ""} />}
                <AvatarFallback>
                  {(m.name ?? "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm">{m.name ?? "Anonymous"}</span>
              {m.isHost && (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">
                  host
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      {activeGame === undefined ? (
        <p className="text-center text-muted-foreground">Loading game…</p>
      ) : activeGame === null ? (
        <>
          {recent && (recent.status === "won" || recent.status === "given_up") && (
            <EndGameBanner
              status={recent.status}
              answerLemma={recent.answerLemma}
              winnerName={null}
              winnerImage={null}
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
            <HintGiveupBar gameId={activeGame._id} isHost={isViewerHost} />
          </div>
          <GuessInput gameId={activeGame._id} />
          {isViewerHost && <PendingRequestsSidebar gameId={activeGame._id} />}
          <GuessList gameId={activeGame._id} />
        </>
      )}
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

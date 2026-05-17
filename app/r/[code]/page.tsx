"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";

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

  const { room, members } = data;
  // viewer = whichever member matches authed identity; we don't have userId on client,
  // so derive isHost lazily: members[].isHost flagged the host. The viewer's row will
  // also be marked isHost if they are the host — we look it up via auth user id later.
  // For now: provide both buttons; host gating is enforced server-side.

  return (
    <main className="mx-auto max-w-3xl p-6 flex flex-col gap-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Room</p>
          <h1 className="font-mono text-3xl font-bold tracking-widest">
            {room.code}
          </h1>
        </div>
        <div className="flex gap-2">
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
          <Button
            variant="destructive"
            onClick={async () => {
              try {
                await endRoom({ roomId: room._id });
                router.push("/");
              } catch {
                /* host-only enforced server-side */
              }
            }}
          >
            End room (host)
          </Button>
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

      <section className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        Game UI coming in slice 3.
      </section>
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

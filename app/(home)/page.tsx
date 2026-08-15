"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import * as Sentry from "@sentry/nextjs";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { reportClientError } from "@/lib/report-error";

export default function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const currentUser = useQuery(api.users.getUser, isAuthenticated ? {} : "skip");
  const isRegistered = isAuthenticated && currentUser?.isAnonymous === false;

  const header = (
    <header className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Contextus</h1>
      {isRegistered ? (
        <Button
          variant="outline"
          onClick={() => {
            if (currentUser?.username) router.push(`/user/${currentUser.username}`);
          }}
          disabled={!currentUser?.username}
        >
          Profile
        </Button>
      ) : null}
    </header>
  );

  if (isLoading || (isAuthenticated && currentUser === undefined)) {
    return (
      <>
        {header}
        <HomeContentSkeleton />
      </>
    );
  }

  return (
    <>
      {header}
      <section className="flex flex-col gap-3">
        <p className="max-w-xl text-muted-foreground">
          Co-op Contexto with friends. Join a room code and guess together.
        </p>
        {!isRegistered && (
          <p className="text-sm text-muted-foreground">
            Guests can play in rooms. Sign in when you want to host.
          </p>
        )}
      </section>
      <JoinRoom isAuthenticated={isAuthenticated} />
      {isRegistered ? (
        <>
          <CreateRoom />
          <MyRooms />
        </>
      ) : (
        <section className="rounded-lg border p-6 flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Host a room</h2>
          <p className="text-sm text-muted-foreground">
            Create an account to start your own room.
          </p>
          <Button onClick={() => router.push("/signin")}>Sign in to host</Button>
        </section>
      )}
    </>
  );
}

function HomeContentSkeleton() {
  return (
    <>
      <div className="h-32 w-full rounded-lg border" />
      <div className="h-28 w-full rounded-lg border" />
    </>
  );
}

function CreateRoom() {
  const router = useRouter();
  const create = useMutation(api.rooms.create);
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-lg border p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Start a new room</h2>
      <p className="text-sm text-muted-foreground">
        You will be the host. Share the room code with friends to play together.
      </p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            const { code } = await create({});
            router.push(`/r/${code}`);
          } catch (err) {
            reportClientError(err, {
              userMessage: "Could not create room.",
              context: "room.create",
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Creating…" : "Create room"}
      </Button>
    </section>
  );
}

function JoinRoom({ isAuthenticated }: { isAuthenticated: boolean }) {
  const router = useRouter();
  const { signIn } = useAuthActions();
  const join = useMutation(api.rooms.join);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section className="rounded-lg border p-6 flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Join a room</h2>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          setError(null);
          setBusy(true);
          try {
            const normalized = code.toUpperCase().trim();
            if (!isAuthenticated) {
              await signIn("anonymous");
            }
            await join({ code: normalized });
            router.push(`/r/${normalized}`);
          } catch (err) {
            setError(err instanceof ConvexError ? err.message : "Failed");
            Sentry.captureException(err, {
              tags: { surface: "room.join" },
            });
          } finally {
            setBusy(false);
          }
        }}
      >
        <Input
          placeholder="ABCDEF"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          maxLength={6}
          autoCapitalize="characters"
          className="uppercase"
        />
        <Button type="submit" disabled={busy || code.length === 0}>
          {busy ? "Joining…" : isAuthenticated ? "Join" : "Join as guest"}
        </Button>
      </form>
      {error && <p className="text-sm text-rose-400">{error}</p>}
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
      <ul className="flex flex-col gap-2">
        {rooms.map((r) => (
          <li key={r._id}>
            <a
              href={`/r/${r.code}`}
              className="font-mono text-lg underline-offset-4 hover:underline"
            >
              {r.code}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

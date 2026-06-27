"use client";

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

  const header = (
    <header className="flex items-center justify-between">
      <h1 className="text-2xl font-bold">Contextus</h1>
      {isAuthenticated ? (
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

  if (!isAuthenticated) {
    return (
      <>
        {header}
        <Centered>
          <p className="max-w-md text-muted-foreground">
            Co-op Contexto with friends. Create a room, share the code, guess
            together.
          </p>
          <Button
            className="mt-2"
            size="lg"
            onClick={() => router.push("/signin")}
          >
            Sign in to play
          </Button>
        </Centered>
      </>
    );
  }

  return (
    <>
      {header}
      <CreateRoom />
      <JoinRoom />
      <MyRooms />
    </>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <section className="flex min-h-[calc(100vh-8rem)] items-center justify-center">
      <div className="flex flex-col items-center gap-2 text-center">
        {children}
      </div>
    </section>
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

function JoinRoom() {
  const router = useRouter();
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
            await join({ code });
            router.push(`/r/${code.toUpperCase().trim()}`);
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
          Join
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

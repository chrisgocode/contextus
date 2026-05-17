"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HomeSkeleton } from "./r/[code]/_components/RoomSkeleton";
import { reportClientError } from "@/lib/report-error";

export default function Home() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const router = useRouter();
  const { signOut } = useAuthActions();

  if (isLoading) return <HomeSkeleton />;
  if (!isAuthenticated) {
    return (
      <Centered>
        <p className="mb-4">You need to sign in to play.</p>
        <Button onClick={() => router.push("/signin")}>Sign in</Button>
      </Centered>
    );
  }

  return (
    <main className="mx-auto max-w-2xl p-8 flex flex-col gap-8">
      <header className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Contextus</h1>
        <Button
          variant="outline"
          onClick={() => void signOut().then(() => router.push("/signin"))}
        >
          Sign out
        </Button>
      </header>
      <CreateRoom />
      <JoinRoom />
      <MyRooms />
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

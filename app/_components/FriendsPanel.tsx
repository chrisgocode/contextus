"use client";

import { UserMultipleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runMutation } from "@/lib/report-error";

type Overview = NonNullable<FunctionReturnType<typeof api.friends.overview>>;
type FriendPlayer = Overview["friends"][number];

// Friends, and Friend requests both ways. Its button's badge counts the
// requests waiting on you.
export function FriendsPanel() {
  const overview = useQuery(api.friends.overview, {});
  const incoming = overview?.incoming.length ?? 0;
  const incomingLabel = `${incoming} friend request${incoming === 1 ? "" : "s"}`;

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button
          variant="outline"
          className="relative"
          aria-label={incoming > 0 ? `Friends, ${incomingLabel}` : "Friends"}
        >
          <HugeiconsIcon
            icon={UserMultipleIcon}
            strokeWidth={2}
            aria-hidden="true"
          />
          <span className="sr-only sm:not-sr-only">Friends</span>
          {incoming > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
            >
              {incoming}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-6 overflow-y-auto p-4">
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>Friends</SheetTitle>
          <SheetDescription>
            Add friends from their profile page.
          </SheetDescription>
        </SheetHeader>
        {overview === undefined ? null : overview === null ? (
          <GuestMessage />
        ) : (
          <FriendLists overview={overview} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function GuestMessage() {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-muted-foreground">
        Friends need an account. Sign in to add friends and see their requests.
      </p>
      <Button asChild className="w-fit">
        <Link href="/signin">Sign in</Link>
      </Button>
    </div>
  );
}

function FriendLists({ overview }: { overview: Overview }) {
  const answerRequest = useMutation(api.friends.answerRequest);
  const cancelRequest = useMutation(api.friends.cancelRequest);
  const [busyUserId, setBusyUserId] = useState<Id<"users"> | null>(null);

  async function act(userId: Id<"users">, run: () => Promise<unknown>) {
    setBusyUserId(userId);
    await run();
    setBusyUserId(null);
  }
  const answer = (userId: Id<"users">, answer: "accept" | "decline") =>
    act(userId, () =>
      runMutation(() => answerRequest({ userId, answer }), {
        context: "friends.answerRequest",
        fallback: "Could not answer this friend request. Try again.",
      }),
    );
  const cancel = (userId: Id<"users">) =>
    act(userId, () =>
      runMutation(() => cancelRequest({ userId }), {
        context: "friends.cancelRequest",
        fallback: "Could not cancel this friend request. Try again.",
      }),
    );

  return (
    <>
      {overview.incoming.length > 0 && (
        <FriendSection title="Requests">
          {overview.incoming.map((player) => (
            <FriendRow key={player.id} player={player}>
              <Button
                size="sm"
                disabled={busyUserId !== null}
                onClick={() => answer(player.id, "accept")}
              >
                Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyUserId !== null}
                onClick={() => answer(player.id, "decline")}
              >
                Decline
              </Button>
            </FriendRow>
          ))}
        </FriendSection>
      )}
      <FriendSection title="Friends">
        {overview.friends.length === 0 ? (
          <li className="text-sm text-muted-foreground">No friends yet.</li>
        ) : (
          overview.friends.map((player) => (
            <FriendRow key={player.id} player={player} />
          ))
        )}
      </FriendSection>
      {overview.outgoing.length > 0 && (
        <FriendSection title="Sent">
          {overview.outgoing.map((player) => (
            <FriendRow key={player.id} player={player}>
              <Button
                size="sm"
                variant="outline"
                disabled={busyUserId !== null}
                onClick={() => cancel(player.id)}
              >
                Cancel
              </Button>
            </FriendRow>
          ))}
        </FriendSection>
      )}
    </>
  );
}

function FriendSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <h2 className="text-xs font-normal tracking-wide text-muted-foreground uppercase">
        {title}
      </h2>
      <ul className="flex flex-col gap-3">{children}</ul>
    </section>
  );
}

function FriendRow({
  player,
  children,
}: {
  player: FriendPlayer;
  children?: ReactNode;
}) {
  const name = (
    <span className="truncate text-sm font-medium">{player.name}</span>
  );
  return (
    <li className="flex items-center gap-3">
      <Avatar>
        {player.image && <AvatarImage src={player.image} alt="" />}
        <AvatarFallback>{player.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1">
        {player.username ? (
          <Link
            href={`/user/${player.username}`}
            className="min-w-0 truncate underline-offset-4 hover:underline"
          >
            {name}
          </Link>
        ) : (
          name
        )}
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </li>
  );
}

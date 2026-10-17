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
import { roomPath } from "@/lib/room-code";
import { runMutation } from "@/lib/report-error";
import { cn } from "@/lib/utils";

type Overview = NonNullable<FunctionReturnType<typeof api.friends.overview>>;
type FriendStatus = Overview["friends"][number]["status"];
type FriendPlayer = Overview["incoming"][number] & { status?: FriendStatus };

const STATUS_LABELS: Record<FriendStatus["kind"], string> = {
  online: "Online",
  inRoom: "In a Room",
  offline: "Offline",
};

// Friends, and Friend requests both ways. Its button's badge counts the
// requests waiting on you.
export function FriendsPanel() {
  const overview = useQuery(api.friends.overview, {});
  const incoming = overview?.incoming.length ?? 0;
  const incomingCount = `${incoming}${overview?.moreIncoming ? "+" : ""}`;
  const incomingLabel = `${incomingCount} friend request${incomingCount === "1" ? "" : "s"}`;

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
              className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center px-1 justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
            >
              {incomingCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="gap-6 overflow-y-auto p-4 data-[side=right]:w-full">
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
      <YourPresence appearOffline={overview.appearOffline} />
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
            <FriendRow key={player.id} player={player}>
              {player.status.kind === "inRoom" && (
                <Button asChild size="sm">
                  <Link href={roomPath(player.status.code)}>Join</Link>
                </Button>
              )}
            </FriendRow>
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

const PRESENCE_CHOICES = [
  { appearOffline: false, label: "Online" },
  { appearOffline: true, label: "Appear offline" },
] as const;

// How the viewer shows up to their Friends, and the choice that sets it.
function YourPresence({ appearOffline }: { appearOffline: boolean }) {
  const me = useQuery(api.users.getUser, {});
  const setAppearOffline = useMutation(api.users.setAppearOffline);
  const [pending, setPending] = useState<boolean | null>(null);
  const shown = pending ?? appearOffline;

  async function choose(next: boolean) {
    setPending(next);
    await runMutation(() => setAppearOffline({ appearOffline: next }), {
      context: "users.setAppearOffline",
      fallback: "Could not change how Friends see you. Try again.",
    });
    setPending(null);
  }

  const name = me?.player.name ?? "You";
  return (
    <section
      aria-label="Your status"
      className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <div className="flex items-center gap-3">
        <div className="relative shrink-0">
          <Avatar>
            {me?.image && <AvatarImage src={me.image} alt="" />}
            <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <StatusDot
            offline={shown}
            className="absolute -right-0.5 -bottom-0.5 size-3 ring-2 ring-background"
          />
        </div>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span className="text-xs text-muted-foreground">
            {shown ? "Friends see you as offline." : "Friends see you online."}
          </span>
        </div>
      </div>
      <fieldset
        disabled={pending !== null}
        className="grid grid-cols-2 gap-1 rounded-md bg-background/60 p-1"
      >
        <legend className="sr-only">Show Friends that you are</legend>
        {PRESENCE_CHOICES.map((choice) => (
          <label
            key={choice.label}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-sm px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground has-checked:bg-secondary has-checked:text-foreground has-focus-visible:outline-2 has-focus-visible:outline-foreground has-disabled:cursor-wait"
          >
            <input
              type="radio"
              name="appear-offline"
              className="sr-only"
              checked={shown === choice.appearOffline}
              onChange={() => choose(choice.appearOffline)}
            />
            <StatusDot offline={choice.appearOffline} className="size-2" />
            {choice.label}
          </label>
        ))}
      </fieldset>
    </section>
  );
}

function StatusDot({
  offline,
  className,
}: {
  offline: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-full",
        offline
          ? "border border-muted-foreground bg-background"
          : "bg-emerald-400",
        className,
      )}
    />
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
  const { status } = player;
  const name = (
    <span className="truncate text-sm font-medium">{player.name}</span>
  );
  return (
    <li className="flex items-center gap-3">
      <Avatar>
        {player.image && <AvatarImage src={player.image} alt="" />}
        <AvatarFallback>{player.name.slice(0, 1).toUpperCase()}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-1 flex-col">
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
        {status && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <StatusDot offline={status.kind === "offline"} className="size-2" />
            {STATUS_LABELS[status.kind]}
          </span>
        )}
      </div>
      {children && <div className="flex shrink-0 gap-2">{children}</div>}
    </li>
  );
}

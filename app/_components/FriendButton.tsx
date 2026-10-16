"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runMutation } from "@/lib/report-error";

// Compact fits a list row, like a Room member; the default fills a profile card.
export function FriendButton({
  userId,
  compact = false,
}: {
  userId: Id<"users">;
  compact?: boolean;
}) {
  const relationship = useQuery(api.friends.relationship, { userId });
  const sendRequest = useMutation(api.friends.sendRequest);
  const answerRequest = useMutation(api.friends.answerRequest);
  const [busy, setBusy] = useState(false);

  if (relationship === undefined || relationship === null) return null;

  const look = compact
    ? ({ size: "xs", className: "shrink-0" } as const)
    : ({ className: "w-full" } as const);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  switch (relationship) {
    case "none":
      return (
        <Button
          {...look}
          disabled={busy}
          onClick={() =>
            run(() =>
              runMutation(() => sendRequest({ userId }), {
                context: "friends.sendRequest",
                fallback: "Could not send a friend request. Try again.",
              }),
            )
          }
        >
          Add friend
        </Button>
      );
    case "incoming":
      return (
        <Button
          {...look}
          disabled={busy}
          onClick={() =>
            run(() =>
              runMutation(() => answerRequest({ userId, answer: "accept" }), {
                context: "friends.answerRequest",
                fallback: "Could not accept this friend request. Try again.",
              }),
            )
          }
        >
          Accept request
        </Button>
      );
    case "requested":
      return (
        <Button {...look} variant="outline" disabled>
          Requested
        </Button>
      );
    case "friends":
      return (
        <Button {...look} variant="outline" disabled>
          Friends
        </Button>
      );
  }
}

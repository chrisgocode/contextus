"use client";

import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useSocialCommand } from "@/app/_components/use-social-command";

export function FriendButton({ userId }: { userId: Id<"users"> }) {
  const relationship = useQuery(api.friends.relationship, { userId });
  const sendRequest = useMutation(api.friends.sendRequest);
  const answerRequest = useMutation(api.friends.answerRequest);
  const { busy, run } = useSocialCommand(userId);

  if (relationship === undefined || relationship === null) return null;

  switch (relationship) {
    case "none":
      return (
        <Button
          className="w-full"
          disabled={busy}
          onClick={() =>
            run("add", () => sendRequest({ userId, via: "profile" }), {
              context: "friends.sendRequest",
              fallback: "Could not send a friend request. Try again.",
            })
          }
        >
          Add friend
        </Button>
      );
    case "incoming":
      return (
        <Button
          className="w-full"
          disabled={busy}
          onClick={() =>
            run("answer", () => answerRequest({ userId, answer: "accept" }), {
              context: "friends.answerRequest",
              fallback: "Could not accept this friend request. Try again.",
            })
          }
        >
          Accept request
        </Button>
      );
    case "requested":
      return (
        <Button className="w-full" variant="outline" disabled>
          Requested
        </Button>
      );
    case "friends":
      return (
        <Button className="w-full" variant="outline" disabled>
          Friends
        </Button>
      );
  }
}

"use client";

import {
  UserAdd01Icon,
  UserCheck01Icon,
  UserTime01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runMutation } from "@/lib/report-error";

// One small icon per member row: a button while there's something to do,
// a muted status icon once there isn't.
export function MemberFriendAction({
  userId,
  name,
}: {
  userId: Id<"users">;
  name: string;
}) {
  const relationship = useQuery(api.friends.relationship, { userId });
  const sendRequest = useMutation(api.friends.sendRequest);
  const answerRequest = useMutation(api.friends.answerRequest);
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    await fn();
    setBusy(false);
  }

  switch (relationship) {
    case undefined:
    case null:
      return null;
    case "none":
      return (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-foreground/85 hover:text-foreground pointer-coarse:-m-2 pointer-coarse:size-10"
          aria-label={`Add ${name} as a friend`}
          title="Add friend"
          disabled={busy}
          onClick={() =>
            run(() =>
              runMutation(() => sendRequest({ userId, via: "room" }), {
                context: "friends.sendRequest",
                fallback: "Could not send a friend request. Try again.",
              }),
            )
          }
        >
          <HugeiconsIcon
            icon={UserAdd01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </Button>
      );
    case "incoming":
      return (
        <Button
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-primary hover:text-primary pointer-coarse:-m-2 pointer-coarse:size-10"
          aria-label={`Accept ${name}'s friend request`}
          title="Accept friend request"
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
          <HugeiconsIcon
            icon={UserAdd01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </Button>
      );
    case "requested":
      return <StatusIcon icon={UserTime01Icon} label="Friend request sent" />;
    case "friends":
      return <StatusIcon icon={UserCheck01Icon} label="Friend" />;
  }
}

function StatusIcon({
  icon,
  label,
}: {
  icon: typeof UserAdd01Icon;
  label: string;
}) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex size-6 shrink-0 items-center justify-center text-muted-foreground/70 [&_svg]:size-3"
    >
      <HugeiconsIcon icon={icon} strokeWidth={2} aria-hidden="true" />
    </span>
  );
}

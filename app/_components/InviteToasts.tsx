"use client";

import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { lazyToast } from "@/lib/toast";
import { InviteAnswers, useInviteAnswer } from "./FriendsPanel";

type Invite = FunctionReturnType<typeof api.friends.openInvites>[number];

const toastId = (invite: Pick<Invite, "_id">) => `invite-${invite._id}`;

// A corner toast for each open Invite, on every page. Dismissing one only
// hides it; the Invite stays in the friends panel. Re-sending an Invite shows
// it again. The toast times out with the Invite, since the query won't rerun
// at the deadline if the scheduled expiry is late.
export function InviteToasts() {
  const { isAuthenticated } = useConvexAuth();
  const invites = useQuery(
    api.friends.openInvites,
    isAuthenticated ? {} : "skip",
  );
  const answer = useInviteAnswer();
  const shown = useRef(new Map<string, number>());

  useEffect(() => {
    if (invites === undefined) return;
    const open = new Set(invites.map(toastId));
    for (const id of shown.current.keys()) {
      if (open.has(id)) continue;
      shown.current.delete(id);
      lazyToast((toast) => toast.dismiss(id));
    }
    for (const invite of invites) {
      const id = toastId(invite);
      if (shown.current.get(id) === invite.expiresAt) continue;
      shown.current.set(id, invite.expiresAt);
      lazyToast((toast) =>
        toast.custom(
          () => (
            <InviteToast
              invite={invite}
              onAnswer={(response) => {
                toast.dismiss(id);
                void answer(invite, response);
              }}
              onDismiss={() => toast.dismiss(id)}
            />
          ),
          {
            id,
            duration: Math.max(invite.expiresAt - Date.now(), 0),
            position: "bottom-right",
          },
        ),
      );
    }
  }, [invites, answer]);

  return null;
}

function InviteToast({
  invite,
  onAnswer,
  onDismiss,
}: {
  invite: Invite;
  onAnswer: (answer: "join" | "decline") => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="relative flex w-full flex-col gap-2 border border-border bg-popover p-3 pr-9 font-mono text-popover-foreground shadow-lg sm:w-[356px]"
    >
      <p className="text-sm font-medium">
        {invite.sender.name} invited you to room {invite.roomCode}
      </p>
      <div className="flex gap-2">
        <InviteAnswers invite={invite} disabled={false} onAnswer={onAnswer} />
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        className="absolute top-2 right-2 text-muted-foreground"
        onClick={onDismiss}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  );
}

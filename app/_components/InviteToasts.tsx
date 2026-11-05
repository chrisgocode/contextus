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
// at the deadline if the scheduled expiry is late. The Toaster outlives this
// component on pages outside the app, so its toasts go when it does, and when
// the viewer signs out.
export function InviteToasts() {
  const { isAuthenticated } = useConvexAuth();
  const invites = useQuery(
    api.friends.openInvites,
    isAuthenticated ? {} : "skip",
  );
  const viewer = useQuery(api.users.getUser, {});
  const answer = useInviteAnswer(`${isAuthenticated}:${viewer?._id}`);
  const delivery = useRef(
    new Map<
      string,
      {
        deadline: number;
        kind: "unseen" | "shown" | "dismissed" | "expired";
      }
    >(),
  );

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const entries = delivery.current;
    const open = new Set((isAuthenticated ? (invites ?? []) : []).map(toastId));
    for (const id of entries.keys()) {
      if (open.has(id)) continue;
      entries.delete(id);
      lazyToast((toast) => toast.dismiss(id));
    }
    for (const invite of isAuthenticated ? (invites ?? []) : []) {
      const id = toastId(invite);
      let entry = entries.get(id);
      // A renewed deadline is a new delivery, even after dismissal.
      if (entry?.deadline !== invite.expiresAt) {
        entry = { deadline: invite.expiresAt, kind: "unseen" };
        entries.set(id, entry);
      }
      const version = entry;
      const current = () => entries.get(id) === version;
      const dismiss = (kind: "dismissed" | "expired") => {
        if (!current()) return;
        version.kind = kind;
        lazyToast((toast) => {
          if (entries.get(id) === version) toast.dismiss(id);
        });
      };
      if (invite.expiresAt <= Date.now()) {
        dismiss("expired");
        continue;
      }
      if (version.kind === "unseen") {
        lazyToast((toast) => {
          if (!current() || version.kind !== "unseen") return;
          const remaining = invite.expiresAt - Date.now();
          if (remaining <= 0) {
            dismiss("expired");
            return;
          }
          version.kind = "shown";
          toast.custom(
            () => (
              <InviteToast
                invite={invite}
                onAnswer={(response) => {
                  if (!current() || version.kind !== "shown") return;
                  dismiss("dismissed");
                  void answer(invite, response);
                }}
                onDismiss={() => dismiss("dismissed")}
              />
            ),
            {
              id,
              duration: remaining,
              position: "bottom-right",
              onDismiss: () => {
                if (current()) version.kind = "dismissed";
              },
              onAutoClose: () => {
                if (current()) version.kind = "expired";
              },
            },
          );
        });
      }
      if (version.kind === "shown" || version.kind === "unseen") {
        timers.push(
          setTimeout(() => dismiss("expired"), invite.expiresAt - Date.now()),
        );
      }
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [invites, answer, isAuthenticated, viewer?._id]);

  useEffect(() => {
    const entries = delivery.current;
    return () => {
      for (const [id, entry] of entries) {
        entry.kind = "dismissed";
        lazyToast((toast) => {
          // Do not dismiss a renewed Invite delivered by a later effect.
          if (!entries.has(id) || entries.get(id) === entry) toast.dismiss(id);
        });
      }
      entries.clear();
    };
  }, [viewer?._id]);

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

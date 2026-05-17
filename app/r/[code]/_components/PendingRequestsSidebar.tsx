"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { Id } from "@/convex/_generated/dataModel";
import { reportClientError } from "@/lib/report-error";

export function PendingRequestsSidebar({
  gameId,
}: {
  gameId: Id<"games">;
}) {
  const pending = useQuery(api.requests.listPending, { gameId });
  const approveHint = useAction(api.hints.approve);
  const denyHint = useMutation(api.hints.deny);
  const approveGiveup = useAction(api.giveup.approve);
  const denyGiveup = useMutation(api.giveup.deny);
  const [busy, setBusy] = useState<Id<"pendingRequests"> | null>(null);

  if (pending === undefined) return null;
  if (pending.length === 0) {
    return (
      <section className="rounded-lg border p-4">
        <h2 className="font-semibold mb-2">Requests</h2>
        <p className="text-sm text-muted-foreground">No pending requests.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border p-4">
      <h2 className="font-semibold mb-3">Requests</h2>
      <ul className="flex flex-col gap-3">
        {pending.map((p) => (
          <li key={p._id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Avatar className="h-6 w-6">
                {p.requesterImage && (
                  <AvatarImage
                    src={p.requesterImage}
                    alt={p.requesterName ?? ""}
                  />
                )}
                <AvatarFallback>
                  {(p.requesterName ?? "?").slice(0, 1).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm">
                <span className="font-medium">
                  {p.requesterName ?? "Someone"}
                </span>{" "}
                wants{" "}
                <span className="font-mono">
                  {p.type === "hint" ? "a hint" : "to give up"}
                </span>
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="flex-1"
                disabled={busy === p._id}
                onClick={async () => {
                  setBusy(p._id);
                  try {
                    if (p.type === "hint")
                      await approveHint({ requestId: p._id });
                    else await approveGiveup({ requestId: p._id });
                  } catch (err) {
                    reportClientError(err, {
                      userMessage: "Could not approve request.",
                      context: `request.approve.${p.type}`,
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1"
                disabled={busy === p._id}
                onClick={async () => {
                  setBusy(p._id);
                  try {
                    if (p.type === "hint") await denyHint({ requestId: p._id });
                    else await denyGiveup({ requestId: p._id });
                  } catch (err) {
                    reportClientError(err, {
                      userMessage: "Could not deny request.",
                      context: `request.deny.${p.type}`,
                    });
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Deny
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

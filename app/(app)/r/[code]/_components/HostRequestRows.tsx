"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { expectedClientErrorMessage } from "@/lib/client-errors";
import { reportClientError } from "@/lib/report-error";
import {
  HintTag,
  PlayerAvatar,
  RevealRow,
  Scramble,
  TimeLeft,
  useNow,
} from "./RequestReveal";

type PendingRequest = FunctionReturnType<
  typeof api.requests.listPending
>[number];
type Giving = {
  request: PendingRequest;
  hint?: { lemma: string; distance: number };
};

// How long an approved hint stays after it settles; the guess list has it.
const GIVEN_HINT_MS = 4000;

// The Host's Pending requests. The page owns this state so the requests can
// be answered in the Assist sheet while the hint they produce is revealed
// above the guess list, where the requester sees theirs.
export function useHostRequests(pending: PendingRequest[] | undefined) {
  const approve = useAction(api.requests.approve);
  const deny = useMutation(api.requests.deny);
  const [busy, setBusy] = useState<ReadonlySet<Id<"pendingRequests">>>(
    new Set(),
  );
  // The hint request leaves `pending` as soon as it's approved, so the row
  // that reveals it lives here until it's done.
  const [giving, setGiving] = useState<
    ReadonlyMap<Id<"pendingRequests">, Giving>
  >(new Map());

  const setBusyFor = (id: Id<"pendingRequests">, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const updateGiving = (id: Id<"pendingRequests">, entry: Giving | null) =>
    setGiving((current) => {
      const next = new Map(current);
      if (entry === null) next.delete(id);
      else next.set(id, entry);
      return next;
    });
  const forget = useCallback(
    (id: Id<"pendingRequests">) =>
      setGiving((current) => {
        const next = new Map(current);
        next.delete(id);
        return next;
      }),
    [],
  );

  async function onApprove(request: PendingRequest) {
    const context = `request.approve.${request.type}`;
    if (request.type === "hint") updateGiving(request._id, { request });
    setBusyFor(request._id, true);
    try {
      const { lemma, distance } = await approve({ requestId: request._id });
      if (request.type === "hint") {
        // Hint turns always score a distance; without one, skip the reveal.
        updateGiving(
          request._id,
          distance === undefined
            ? null
            : { request, hint: { lemma, distance } },
        );
      }
    } catch (err) {
      if (request.type === "hint") updateGiving(request._id, null);
      reportClientError(err, {
        userMessage:
          expectedClientErrorMessage(err, context) ??
          "Could not approve request.",
        context,
      });
    } finally {
      setBusyFor(request._id, false);
    }
  }

  async function onDeny(request: PendingRequest) {
    const context = `request.deny.${request.type}`;
    setBusyFor(request._id, true);
    try {
      await deny({ requestId: request._id });
    } catch (err) {
      reportClientError(err, {
        userMessage:
          expectedClientErrorMessage(err, context) ?? "Could not deny request.",
        context,
      });
    } finally {
      setBusyFor(request._id, false);
    }
  }

  const waiting = (pending ?? []).filter((p) => !giving.has(p._id));
  return {
    waiting,
    giving: [...giving.values()],
    busy,
    approve: onApprove,
    deny: onDeny,
    forget,
  };
}

export type HostRequests = ReturnType<typeof useHostRequests>;

// Above the guess list: the hints being given, shuffling while Contexto finds
// them and then settling into the word in the requester's row, the same
// reveal the requester sees.
export function HostRequestRows({ requests }: { requests: HostRequests }) {
  const { waiting, giving, forget } = requests;
  const rows = giving.sort(
    (a, b) => a.request._creationTime - b.request._creationTime,
  );

  // The region stays mounted and in the accessibility tree without visible
  // rows, so screen readers announce requests as they arrive. `sr-only`
  // rather than `hidden`: display:none would drop it from the tree.
  return (
    <section
      role="status"
      aria-label="Requests"
      className={rows.length === 0 ? "sr-only" : "flex flex-col gap-2"}
    >
      {waiting.length > 0 && (
        <p className="sr-only">
          {waiting.length} request{waiting.length === 1 ? "" : "s"} waiting
        </p>
      )}
      {rows.map(({ request, hint }) =>
        hint === undefined ? (
          <FindingHintRow key={request._id} request={request} />
        ) : (
          <RevealRow
            key={request._id}
            lemma={hint.lemma}
            distance={hint.distance}
            player={request.requester}
            onSettled={() => {
              setTimeout(() => forget(request._id), GIVEN_HINT_MS);
            }}
          />
        ),
      )}
    </section>
  );
}

// In the Assist sheet: each waiting request with Deny and Give hint / Give
// up. `onApproved` lets the sheet close so the Host sees the reveal.
export function HostRequestList({
  requests,
  onApproved,
}: {
  requests: HostRequests;
  onApproved: () => void;
}) {
  const { waiting, busy, approve, deny } = requests;
  const now = useNow(waiting.length > 0);
  if (waiting.length === 0) return null;
  return (
    <section aria-label="Waiting requests" className="flex flex-col gap-2">
      <h2 className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
        Waiting on you · {waiting.length}
      </h2>
      <ul className="flex flex-col divide-y border">
        {waiting.map((request) => (
          <li key={request._id}>
            <RequestRow
              request={request}
              now={now}
              busy={busy.has(request._id)}
              onApprove={() => {
                onApproved();
                void approve(request);
              }}
              onDeny={() => void deny(request)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

function RequestRow({
  request,
  now,
  busy,
  onApprove,
  onDeny,
}: {
  request: PendingRequest;
  now: number;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const giveup = request.type === "giveup";
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        <PlayerAvatar player={request.requester} className="h-7 w-7" />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">
            {request.requester.name}
          </span>
          <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
            {giveup ? "wants to give up" : "wants a hint"}
            <TimeLeft request={request} now={now} />
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" disabled={busy} onClick={onDeny}>
          Deny
        </Button>
        <Button
          variant={giveup ? "destructive" : "default"}
          disabled={busy}
          onClick={onApprove}
        >
          {giveup ? "Give up" : "Give hint"}
        </Button>
      </div>
    </div>
  );
}

// Shuffles while Contexto finds the hint; RevealRow takes over once it has.
function FindingHintRow({ request }: { request: PendingRequest }) {
  return (
    <div className="relative overflow-hidden rounded-md bg-neutral-900/60 ring-1 ring-white/30">
      <div className="absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-emerald-400/25 to-transparent motion-safe:animate-request-shimmer motion-reduce:hidden" />
      <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
        <span className="flex-1 truncate font-semibold tracking-wide text-white/45">
          <span className="sr-only">
            Finding a hint for {request.requester.name}
          </span>
          <Scramble />
        </span>
        <HintTag />
        <PlayerAvatar player={request.requester} />
        <span className="min-w-[3ch] text-right font-mono text-sm text-white/60">
          ?
        </span>
      </div>
    </div>
  );
}

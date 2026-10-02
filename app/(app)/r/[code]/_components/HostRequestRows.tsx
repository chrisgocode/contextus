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
  Elapsed,
  HintTag,
  PlayerAvatar,
  RevealRow,
  Scramble,
  useNow,
} from "./RequestReveal";
import { useElementInViewport } from "./useElementInViewport";
import { useKeyboardInset } from "./useKeyboardInset";

type PendingRequest = FunctionReturnType<
  typeof api.requests.listPending
>[number];
type Giving = {
  request: PendingRequest;
  hint?: { lemma: string; distance: number };
};

// How long an approved hint stays after it settles; the guess list has it.
const GIVEN_HINT_MS = 4000;

// The Host's Pending requests, above the guess list where the requester sees
// theirs, each with Deny and Give hint / Give up. Giving a hint shuffles
// while Contexto finds it, then settles into the word in the requester's
// row, the same reveal the requester sees.
export function HostRequestRows({
  pending,
}: {
  pending: PendingRequest[] | undefined;
}) {
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
  const now = useNow((pending?.length ?? 0) > 0);
  const [region, setRegion] = useState<HTMLElement | null>(null);
  const regionVisible = useElementInViewport(region, 0.1);
  const keyboardInset = useKeyboardInset();

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
  const rows = [
    ...waiting.map((request) => ({ request, giving: undefined })),
    ...[...giving.values()].map((g) => ({ request: g.request, giving: g })),
  ].sort((a, b) => a.request._creationTime - b.request._creationTime);

  // The region stays mounted and in the accessibility tree while empty, so
  // screen readers announce requests as they arrive. `sr-only` rather than
  // `hidden`: display:none would drop it from the tree.
  return (
    <>
      <section
        ref={setRegion}
        role="status"
        aria-label="Requests"
        className="flex flex-col gap-1 empty:sr-only"
      >
        {rows.length > 0 && (
          <>
            <h2 className="text-xs font-normal uppercase tracking-wide text-muted-foreground">
              Requests · {waiting.length}
            </h2>
            <ul className="flex flex-col gap-2">
              {rows.map(({ request, giving: entry }) => (
                <li key={request._id}>
                  {entry === undefined ? (
                    <RequestRow
                      request={request}
                      now={now}
                      busy={busy.has(request._id)}
                      onApprove={() => onApprove(request)}
                      onDeny={() => onDeny(request)}
                    />
                  ) : entry.hint === undefined ? (
                    <FindingHintRow request={request} />
                  ) : (
                    <RevealRow
                      lemma={entry.hint.lemma}
                      distance={entry.hint.distance}
                      player={request.requester}
                      onSettled={() => {
                        setTimeout(() => forget(request._id), GIVEN_HINT_MS);
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      {/* The rows sit above the guess list, so a Host scrolled down the list
        gets a way back to them. */}
      {waiting.length > 0 && !regionVisible && (
        <button
          type="button"
          aria-label={`Scroll up to ${waiting.length} request${waiting.length === 1 ? "" : "s"}`}
          onClick={() =>
            region?.scrollIntoView({ behavior: "smooth", block: "start" })
          }
          // Above the keyboard while it's open (it covers the home
          // indicator's safe area), else above the safe area.
          style={
            keyboardInset > 0
              ? { bottom: `calc(${keyboardInset}px + 1rem)` }
              : undefined
          }
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+1rem)] right-4 z-50 flex h-10 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 text-sm text-primary-foreground shadow-lg"
        >
          <span aria-hidden="true">↑</span>
          {waiting.length} request{waiting.length === 1 ? "" : "s"}
        </button>
      )}
    </>
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
    <div
      className={`flex items-center gap-3 rounded-md border border-dashed bg-neutral-900/60 px-3 py-2 text-white ${
        giveup ? "border-destructive/60" : "border-emerald-400/50"
      }`}
    >
      <PlayerAvatar player={request.requester} className="h-7 w-7" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold">
            {request.requester.name}
          </span>
          <Elapsed since={request._creationTime} now={now} />
        </span>
        <span className="truncate text-xs text-white/60">
          {giveup ? "wants to give up" : "wants a hint"}
        </span>
      </div>
      <Button size="sm" variant="ghost" disabled={busy} onClick={onDeny}>
        Deny
      </Button>
      <Button
        size="sm"
        variant={giveup ? "destructive" : "default"}
        disabled={busy}
        onClick={onApprove}
      >
        {giveup ? "Give up" : "Give hint"}
      </Button>
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

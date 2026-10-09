"use client";

import { Button } from "@/components/ui/button";
import { type PendingRequest, usePendingRequests } from "./PendingRequests";
import {
  HintTag,
  PlayerAvatar,
  RevealRow,
  Scramble,
  TimeLeft,
} from "./RequestReveal";

// Above the guess list: the hints being given, shuffling while Contexto finds
// them and then settling into the word in the requester's row, the same
// reveal the requester sees.
export function HostRequestRows() {
  const requests = usePendingRequests();
  if (requests.role !== "host") return null;
  const { waiting, giving: rows, settled } = requests;

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
            onSettled={() => settled(request._id)}
          />
        ),
      )}
    </section>
  );
}

// In the Assist sheet: each waiting request with Deny and Give hint / Give
// up. `onApproved` lets the sheet close so the Host sees the reveal.
export function HostRequestList({ onApproved }: { onApproved: () => void }) {
  const requests = usePendingRequests();
  const waiting = requests.role === "host" ? requests.waiting : [];
  if (requests.role !== "host" || waiting.length === 0) return null;
  const { busy, approve, deny } = requests;
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
  busy,
  onApprove,
  onDeny,
}: {
  request: PendingRequest;
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
            <TimeLeft request={request} />
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

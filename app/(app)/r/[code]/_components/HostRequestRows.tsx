"use client";

import { Button } from "@/components/ui/button";
import {
  type Giving,
  type PendingRequest,
  usePendingRequests,
} from "./PendingRequests";
import {
  HintTag,
  PlayerAvatar,
  RevealRow,
  RowLabel,
  Scramble,
  TimeLeft,
  WaitingRow,
} from "./RequestReveal";

// Above the guess list, oldest first: each request waiting on the Host as
// the row its result will fill, with Deny and Give beside it, the same row the
// requester sees. A hint given stays in place, shuffling while Contexto finds
// it and then settling into the word.
export function HostRequestRows() {
  const requests = usePendingRequests();
  const waiting = requests.role === "host" ? requests.waiting : [];
  if (requests.role !== "host") return null;
  const { giving, busy, approve, deny, settled } = requests;
  const rows: Giving[] = [
    ...waiting.map((request) => ({ request })),
    ...giving,
  ].sort((a, b) => a.request._creationTime - b.request._creationTime);
  const isGiving = new Set(giving.map(({ request }) => request._id));

  // The live region stays mounted and in the accessibility tree while empty,
  // so screen readers announce requests as they arrive. `sr-only` rather than
  // `hidden`: display:none would drop it from the tree.
  return (
    <section
      role="status"
      aria-label="Requests"
      className="flex flex-col gap-3 empty:sr-only"
    >
      {rows.map(({ request, hint }) =>
        !isGiving.has(request._id) ? (
          <WaitingRequest
            key={request._id}
            request={request}
            busy={busy.has(request._id)}
            onApprove={() => void approve(request)}
            onDeny={() => void deny(request)}
          />
        ) : (
          <section key={request._id}>
            <RowLabel
              label={`Hint for ${request.requester.name}`}
              action={null}
            />
            {hint === undefined ? (
              <FindingHintRow request={request} />
            ) : (
              <RevealRow
                lemma={hint.lemma}
                distance={hint.distance}
                player={request.requester}
                onSettled={() => settled(request._id)}
              />
            )}
          </section>
        ),
      )}
    </section>
  );
}

function WaitingRequest({
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
  const name = request.requester.name;
  return (
    <section>
      <RowLabel
        label={`${name} ${giveup ? "wants to give up" : "wants a hint"}`}
        action={
          <span className="flex shrink-0 gap-1">
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={onDeny}
              aria-label={`Deny ${name}'s request`}
            >
              Deny
            </Button>
            <Button
              variant={giveup ? "destructive" : "default"}
              size="xs"
              disabled={busy}
              onClick={onApprove}
              aria-label={`${giveup ? "Give up" : "Give hint"} for ${name}`}
            >
              {giveup ? "Give up" : "Give hint"}
            </Button>
          </span>
        }
      />
      <WaitingRow
        type={request.type}
        request={request}
        player={request.requester}
        label={giveup ? "Answer, if you give up" : `Hint for ${name}`}
      />
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

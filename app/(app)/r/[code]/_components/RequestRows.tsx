"use client";

import { Button } from "@/components/ui/button";
import {
  type MyRequest,
  type RequestKind,
  usePendingRequests,
} from "./PendingRequests";
import { type Player, RevealRow, RowLabel, WaitingRow } from "./RequestReveal";

// A non-Host's hint and give-up requests, shown above the guess list where
// their result will land: a pending hint as a placeholder row of shuffling
// letters, a pending give-up as a hidden answer row. When the Host approves a
// hint the letters settle into the word. Which requests and outcomes show is
// up to usePendingRequests.
export function RequestRows({
  host,
  viewer,
}: {
  host: Player;
  viewer: Player;
}) {
  const requests = usePendingRequests();
  if (requests.role !== "requester") return null;
  const {
    mine: { hint, giveup },
    dismiss,
  } = requests;

  // The live region stays mounted and in the accessibility tree while empty,
  // so screen readers announce rows as they appear. `sr-only` rather than
  // `hidden`: display:none would drop it from the tree.
  return (
    <div className="flex flex-col gap-3 empty:sr-only" role="status">
      {giveup &&
        (giveup.status === "pending" ? (
          <section>
            <RowLabel
              label="Answer · if host agrees"
              action={<TakeBack request={giveup} type="giveup" />}
            />
            <WaitingRow
              type="giveup"
              request={giveup}
              player={host}
              label="Give-up requested"
            />
          </section>
        ) : (
          <Outcome
            status={giveup.status}
            what="Give-up"
            onDismiss={() => dismiss(giveup._id)}
          />
        ))}
      {hint &&
        (hint.status === "pending" ? (
          <section>
            <RowLabel
              label="Incoming hint"
              action={<TakeBack request={hint} type="hint" />}
            />
            <WaitingRow
              type="hint"
              request={hint}
              player={viewer}
              label="Hint requested"
            />
          </section>
        ) : hint.status === "approved" && hint.hint !== undefined ? (
          <section>
            <RowLabel
              label="Hint approved"
              action={<DismissButton onClick={() => dismiss(hint._id)} />}
            />
            <RevealRow
              lemma={hint.hint.lemma}
              distance={hint.hint.distance}
              player={viewer}
            />
          </section>
        ) : (
          <Outcome
            status={hint.status}
            what="Hint"
            onDismiss={() => dismiss(hint._id)}
          />
        ))}
    </div>
  );
}

function TakeBack({
  request,
  type,
}: {
  request: MyRequest;
  type: RequestKind;
}) {
  const requests = usePendingRequests();
  if (requests.role !== "requester") return null;
  return (
    <Button
      variant="ghost"
      size="xs"
      disabled={requests.busy.has(request._id)}
      onClick={() => void requests.takeBack(type, request)}
    >
      Take back
    </Button>
  );
}

function DismissButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick}>
      Dismiss
    </Button>
  );
}

// A request the Host declined, or that expired unanswered.
function Outcome({
  status,
  what,
  onDismiss,
}: {
  status: MyRequest["status"];
  what: "Hint" | "Give-up";
  onDismiss: () => void;
}) {
  const expired = status === "expired";
  return (
    <section>
      <RowLabel
        label={`${what} ${expired ? "request expired" : "declined"}`}
        action={<DismissButton onClick={onDismiss} />}
      />
      <div className="rounded-md border border-dashed px-3 py-2.5 text-sm text-muted-foreground">
        {expired
          ? "The host didn't answer in time. Ask again any time."
          : "Ask again any time."}
      </div>
    </section>
  );
}

"use client";

import { Button } from "@/components/ui/button";
import {
  type MyRequest,
  type RequestKind,
  usePendingRequests,
} from "./PendingRequests";
import {
  HintTag,
  type Player,
  PlayerAvatar,
  RevealRow,
  Scramble,
  TimeLeft,
  useNow,
} from "./RequestReveal";

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
  const mine = requests.role === "requester" ? requests.mine : null;
  const now = useNow(
    mine?.hint?.status === "pending" || mine?.giveup?.status === "pending",
  );
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
            <div className="relative overflow-hidden rounded-md border border-dashed border-destructive/60 bg-neutral-900/60">
              <div className="flex items-center gap-2 px-3 py-2.5 text-white">
                <span className="sr-only">Give-up requested</span>
                <span className="flex flex-1 items-center gap-1" aria-hidden>
                  {Array.from({ length: 7 }, (_, i) => (
                    <span
                      key={i}
                      className="inline-block h-4 w-3 bg-white/25 motion-safe:animate-pulse"
                      style={{ animationDelay: `${i * 120}ms` }}
                    />
                  ))}
                </span>
                <TimeLeft request={giveup} now={now} />
                <PlayerAvatar player={host} />
                <span className="min-w-[3ch] text-right font-mono text-sm">
                  1
                </span>
              </div>
            </div>
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
            <div className="relative overflow-hidden rounded-md border border-dashed border-white/30 bg-neutral-900/60">
              <div className="absolute inset-y-0 w-1/3 bg-linear-to-r from-transparent via-emerald-400/25 to-transparent motion-safe:animate-request-shimmer motion-reduce:hidden" />
              <div className="relative flex items-center gap-2 px-3 py-2.5 text-white">
                <span className="flex-1 truncate font-semibold tracking-wide text-white/45">
                  <span className="sr-only">Hint requested</span>
                  <Scramble />
                </span>
                <TimeLeft request={hint} now={now} />
                <HintTag />
                <PlayerAvatar player={viewer} />
                <span className="min-w-[3ch] text-right font-mono text-sm text-white/60">
                  ?
                </span>
              </div>
            </div>
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

function RowLabel({
  label,
  action,
}: {
  label: string;
  action: React.ReactNode;
}) {
  return (
    <div className="mb-1 flex items-center justify-between gap-2">
      <p className="truncate text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      {action}
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

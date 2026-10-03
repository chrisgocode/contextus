"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { BulbIcon, Flag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { expectedClientErrorMessage } from "@/lib/client-errors";
import { reportClientError } from "@/lib/report-error";

// The viewer's own hint and give-up, in the Assist sheet. A Host acts
// directly; anyone else asks the Host. `onDone` closes the sheet once the
// action lands, so the result shows above the guess list.
export function HintGiveupBar({
  gameId,
  isHost,
  onDone,
}: {
  gameId: Id<"games">;
  isHost: boolean;
  onDone?: () => void;
}) {
  const createRequest = useMutation(api.requests.create);
  const hostHint = useAction(api.hints.hostHint);
  const hostGiveup = useAction(api.giveup.hostGiveup);
  // RequestRows shows a pending request's status; the buttons only disable.
  const mine = useQuery(api.requests.latestMine, isHost ? "skip" : { gameId });
  // One request of each type at a time per Game.
  const others = useQuery(
    api.requests.pendingFromOthers,
    isHost ? "skip" : { gameId },
  );
  const [busy, setBusy] = useState<"hint" | "giveup" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const myHintPending = mine?.hint?.status === "pending";
  const myGiveupPending = mine?.giveup?.status === "pending";
  const othersHint = others?.hint ?? null;
  const othersGiveup = others?.giveup ?? null;

  async function run(kind: "hint" | "giveup") {
    setError(null);
    setBusy(kind);
    try {
      if (isHost) {
        if (kind === "hint") await hostHint({ gameId });
        else await hostGiveup({ gameId });
      } else {
        await createRequest({ gameId, type: kind });
      }
      onDone?.();
    } catch (e) {
      const context = `${isHost ? "host" : "request"}.${kind}`;
      const message =
        expectedClientErrorMessage(e, context) ??
        (kind === "hint"
          ? isHost
            ? "Could not get a hint. Try again."
            : "Could not request a hint. Try again."
          : isHost
            ? "Could not give up. Try again."
            : "Could not request to give up. Try again.");
      setError(message);
      reportClientError(e, {
        userMessage: message,
        context,
        showToast: false,
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <ActionButton
        icon={BulbIcon}
        label={busy === "hint" ? "…" : isHost ? "Get hint" : "Request hint"}
        description={
          isHost
            ? "Adds a closer word to everyone's guesses."
            : "The host decides whether to give one."
        }
        disabled={
          busy !== null || (!isHost && (myHintPending || othersHint !== null))
        }
        onClick={() => run("hint")}
      />
      {!isHost && othersHint !== null && (
        <p className="text-xs text-muted-foreground">
          {othersHint.name} already asked for a hint.
        </p>
      )}
      <ActionButton
        icon={Flag01Icon}
        destructive
        label={busy === "giveup" ? "…" : isHost ? "Give up" : "Request give up"}
        description={
          isHost
            ? "Ends this game and shows the word."
            : "The host decides whether to end the game."
        }
        disabled={
          busy !== null ||
          (!isHost && (myGiveupPending || othersGiveup !== null))
        }
        onClick={() => run("giveup")}
      />
      {!isHost && othersGiveup !== null && (
        <p className="text-xs text-muted-foreground">
          {othersGiveup.name} already asked to give up.
        </p>
      )}
      {error && <p className="text-sm text-rose-400">{error}</p>}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  description,
  destructive,
  disabled,
  onClick,
}: {
  icon: typeof BulbIcon;
  label: string;
  description: string;
  destructive?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const descriptionId = useId();
  return (
    <button
      type="button"
      aria-label={label}
      aria-describedby={descriptionId}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-3 border p-3 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${
        destructive
          ? "border-destructive/40 hover:bg-destructive/10"
          : "hover:bg-muted"
      }`}
    >
      <HugeiconsIcon
        icon={icon}
        strokeWidth={2}
        aria-hidden="true"
        className={`size-5 shrink-0 ${destructive ? "text-rose-400" : ""}`}
      />
      <span className="flex flex-col">
        <span
          className={`text-sm font-semibold ${destructive ? "text-rose-400" : ""}`}
        >
          {label}
        </span>
        <span id={descriptionId} className="text-xs text-muted-foreground">
          {description}
        </span>
      </span>
    </button>
  );
}

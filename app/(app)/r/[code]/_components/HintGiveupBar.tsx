"use client";

import { BulbIcon, Flag01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useId } from "react";
import { type RequestKind, usePendingRequests } from "./PendingRequests";

// The viewer's own hint and give-up, in the Assist sheet. A Host acts
// directly; anyone else asks the Host. `onDone` closes the sheet once the
// action lands, so the result shows above the guess list.
export function HintGiveupBar({ onDone }: { onDone?: () => void }) {
  const requests = usePendingRequests();
  const { asking, askError, canAsk } = requests;
  const isHost = requests.role === "host";
  // RequestRows shows the viewer's pending request; the buttons only
  // disable, and say who else got there first.
  const othersHint = isHost ? null : requests.others.hint;
  const othersGiveup = isHost ? null : requests.others.giveup;

  async function run(kind: RequestKind) {
    if (await requests.ask(kind)) onDone?.();
  }

  return (
    <div className="flex flex-col gap-2">
      <ActionButton
        icon={BulbIcon}
        label={asking === "hint" ? "…" : isHost ? "Get hint" : "Request hint"}
        description={
          isHost
            ? "Adds a closer word to everyone's guesses."
            : "The host decides whether to give one."
        }
        disabled={!canAsk.hint}
        onClick={() => run("hint")}
      />
      {othersHint !== null && (
        <p className="text-xs text-muted-foreground">
          {othersHint.name} already asked for a hint.
        </p>
      )}
      <ActionButton
        icon={Flag01Icon}
        destructive
        label={
          asking === "giveup" ? "…" : isHost ? "Give up" : "Request give up"
        }
        description={
          isHost
            ? "Ends this game and shows the word."
            : "The host decides whether to end the game."
        }
        disabled={!canAsk.giveup}
        onClick={() => run("giveup")}
      />
      {othersGiveup !== null && (
        <p className="text-xs text-muted-foreground">
          {othersGiveup.name} already asked to give up.
        </p>
      )}
      {askError && <p className="text-sm text-rose-400">{askError}</p>}
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

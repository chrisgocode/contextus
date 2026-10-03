"use client";

import { BulbIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Id } from "@/convex/_generated/dataModel";
import { HintGiveupBar } from "./HintGiveupBar";
import { HostRequestList, type HostRequests } from "./HostRequestRows";
import { useElementInViewport } from "./useElementInViewport";
import { useKeyboardInset } from "./useKeyboardInset";

// One button beside the guess input for everything that isn't guessing:
// getting or asking for a hint, giving up, and, for the Host, answering
// requests. Its badge counts the requests waiting on the Host.
export function AssistSheet({
  gameId,
  isHost,
  requests,
}: {
  gameId: Id<"games">;
  isHost: boolean;
  requests: HostRequests | null;
}) {
  const [open, setOpen] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const triggerVisible = useElementInViewport(trigger, 0.1);
  const keyboardInset = useKeyboardInset();
  const waiting = requests?.waiting.length ?? 0;
  const waitingLabel = `${waiting} request${waiting === 1 ? "" : "s"}`;
  const close = () => setOpen(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          ref={setTrigger}
          variant="outline"
          className="relative h-full min-h-10 px-3"
          aria-label={
            waiting > 0 ? `Need help? ${waitingLabel} waiting` : undefined
          }
        >
          <HugeiconsIcon
            icon={BulbIcon}
            strokeWidth={2}
            aria-hidden="true"
            className="size-5"
          />
          <span className="sr-only sm:not-sr-only">Need help?</span>
          {waiting > 0 && (
            <span
              aria-hidden="true"
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground"
            >
              {waiting}
            </span>
          )}
        </Button>
      </SheetTrigger>
      {/* The trigger sits at the top of the page, so a Host scrolled down
          the guess list gets a way to the requests. */}
      {waiting > 0 && !triggerVisible && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          // Above the keyboard while it's open (it covers the home
          // indicator's safe area), else above the safe area.
          style={
            keyboardInset > 0
              ? { bottom: `calc(${keyboardInset}px + 1rem)` }
              : undefined
          }
          className="fixed right-4 bottom-[calc(env(safe-area-inset-bottom)+1rem)] z-40 flex h-10 items-center gap-1.5 rounded-full border border-primary bg-primary px-4 text-sm text-primary-foreground shadow-lg"
        >
          Show {waitingLabel}
        </button>
      )}
      <SheetContent
        side="bottom"
        className="mx-auto max-h-[85dvh] w-full max-w-md gap-4 overflow-y-auto p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:bottom-4 sm:border"
      >
        <SheetHeader className="p-0 pr-8">
          <SheetTitle>Need help?</SheetTitle>
          <SheetDescription>
            {isHost
              ? "You decide for the room."
              : "The host decides for the room."}
          </SheetDescription>
        </SheetHeader>
        {requests && <HostRequestList requests={requests} onApproved={close} />}
        <section aria-label="Your actions" className="flex flex-col gap-2">
          <h2 className="text-xs font-normal tracking-wide text-muted-foreground uppercase">
            You
          </h2>
          <HintGiveupBar gameId={gameId} isHost={isHost} onDone={close} />
        </section>
      </SheetContent>
    </Sheet>
  );
}

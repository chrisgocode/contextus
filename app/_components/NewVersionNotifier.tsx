"use client";

import { Cancel01Icon, Refresh01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { watchForNewVersion } from "@/lib/new-version";
import { lazyToast } from "@/lib/toast";

export function NewVersionNotifier() {
  useEffect(() => {
    const currentVersion = process.env.NEXT_PUBLIC_APP_VERSION;
    if (!currentVersion) return;
    return watchForNewVersion(currentVersion, () => {
      lazyToast((toast) =>
        toast.custom(
          (id) => (
            <NewVersionToast
              onRefresh={() => window.location.reload()}
              onDismiss={() => toast.dismiss(id)}
            />
          ),
          { id: "new-version", duration: Infinity, position: "bottom-right" },
        ),
      );
    });
  }, []);

  return null;
}

export function NewVersionToast({
  onRefresh,
  onDismiss,
}: {
  onRefresh: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="status"
      className="relative flex w-full items-start gap-3 border border-border bg-popover p-3 pr-9 font-mono text-popover-foreground shadow-lg sm:w-[356px]"
    >
      <span className="flex size-8 shrink-0 items-center justify-center bg-primary/15 text-primary">
        <HugeiconsIcon
          icon={Refresh01Icon}
          strokeWidth={2}
          className="size-4"
        />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-medium">New version available</p>
        <p className="text-xs text-muted-foreground">
          Refresh to get the latest Contextus. Your games are saved.
        </p>
        <Button size="sm" className="mt-2 self-start" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Dismiss"
        className="absolute top-2 right-2 text-muted-foreground"
        onClick={onDismiss}
      >
        <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
      </Button>
    </div>
  );
}

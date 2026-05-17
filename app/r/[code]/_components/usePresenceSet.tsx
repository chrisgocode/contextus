"use client";

import usePresence from "@convex-dev/presence/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function usePresenceSet(
  roomId: Id<"rooms">,
  viewerUserId: string,
): Set<string> {
  const state = usePresence(api.presence, roomId, viewerUserId);
  return new Set(
    (state ?? []).filter((p) => p.online).map((p) => p.userId),
  );
}

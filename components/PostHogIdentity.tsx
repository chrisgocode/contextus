"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { posthogReady } from "@/lib/posthog-client";

type IdentityTarget =
  | { status: "waiting" }
  | { status: "anonymous" }
  | { status: "viewer"; id: string; isGuest: boolean | undefined };

export function PostHogIdentity() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.users.getUser, isAuthenticated ? {} : "skip");
  const identified = useRef<string | null>(null);

  useEffect(() => {
    const target: IdentityTarget = isLoading
      ? { status: "waiting" }
      : !isAuthenticated
        ? { status: "anonymous" }
        : user
          ? { status: "viewer", id: user._id, isGuest: user.isAnonymous }
          : { status: "waiting" };
    if (target.status === "waiting") return;
    let cancelled = false;
    if (target.status === "anonymous") identified.current = null;
    void posthogReady.then((posthog) => {
      // Both identify and reset belong to this effect's auth/viewer snapshot.
      if (cancelled) return;
      if (target.status === "anonymous") {
        // PostHog persists identity across page loads. Resetting already
        // anonymous visitors would churn their persisted distinct IDs.
        if (posthog.get_property("$user_state") === "identified") {
          posthog.reset();
        }
      } else if (identified.current !== target.id) {
        posthog.identify(target.id, { is_guest: target.isGuest });
        identified.current = target.id;
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, user]);

  return null;
}

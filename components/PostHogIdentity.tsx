"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { posthogReady } from "@/lib/posthog-client";

export function PostHogIdentity() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.users.getUser, isAuthenticated ? {} : "skip");
  const identified = useRef<string | null>(null);

  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;
    if (!isAuthenticated) {
      identified.current = null;
      // PostHog persists identity across page loads, so check the SDK rather
      // than this mount's ref; resetting anonymous visitors would churn IDs.
      void posthogReady.then((posthog) => {
        if (posthog.get_property("$user_state") === "identified") {
          posthog.reset();
        }
      });
    } else if (user) {
      void posthogReady.then((posthog) => {
        if (cancelled || identified.current === user._id) return;
        posthog.identify(user._id, { is_guest: user.isAnonymous });
        identified.current = user._id;
      });
    }
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isLoading, user]);

  return null;
}

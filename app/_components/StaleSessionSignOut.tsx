"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";
import { reportClientError } from "@/lib/report-error";

// An access token outlives its session by up to an hour. Once guest expiry
// deletes the session, the backend treats the token as signed out while the
// client still holds it, so drop it and let pages see a real signed-out state.
export function StaleSessionSignOut() {
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(
    api.users.getUser,
    isAuthenticated ? {} : "skip",
  );
  const { signOut } = useAuthActions();

  useEffect(() => {
    if (currentUser !== null) return;
    signOut().catch((err: unknown) => {
      reportClientError(err, {
        userMessage: "Could not sign out.",
        context: "auth.signOut",
        showToast: false,
      });
    });
  }, [currentUser, signOut]);

  return null;
}

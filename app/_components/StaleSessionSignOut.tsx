"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { reportClientError } from "@/lib/report-error";

// A sign-in that ends a Guest's session can finish its guest merge before its
// own response sets the new account's cookie, so give it time to land.
export const STALE_SIGN_OUT_DELAY_MS = 1000;

// An access token outlives its session by up to an hour. Once guest expiry
// deletes the session, the backend treats the token as signed out while the
// client still holds it, so drop it and let pages see a real signed-out state.
//
// A Guest's session also ends when they sign in and the guest merge deletes
// the Guest, and by then the shared auth cookie holds the new account. So the
// proxy signs out only when the cookie still holds the session the backend
// named, and the reload either way makes the page match the cookie.
export function StaleSessionSignOut() {
  const { isAuthenticated } = useConvexAuth();
  const sessionId = useQuery(
    api.users.staleSession,
    isAuthenticated ? {} : "skip",
  );
  const leaving = useLeaving();

  useEffect(() => {
    if (!sessionId) return;
    const timeout = setTimeout(() => {
      // The page that started sign-in stays loaded until the redirect lands,
      // and reloading it would cancel the sign-in.
      if (leaving.current) return;
      fetch("/api/auth/stale", {
        method: "POST",
        body: JSON.stringify({ sessionId }),
      })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Sign-out failed: ${response.status}`);
          }
          if (!leaving.current) window.location.reload();
        })
        .catch((err: unknown) => {
          reportClientError(err, {
            userMessage: "Could not sign out.",
            context: "auth.signOut",
            showToast: false,
          });
        });
    }, STALE_SIGN_OUT_DELAY_MS);
    return () => clearTimeout(timeout);
  }, [sessionId, leaving]);

  return null;
}

function useLeaving() {
  const leaving = useRef(false);
  useEffect(() => {
    const leave = () => {
      leaving.current = true;
    };
    // A page restored from the back/forward cache is staying after all.
    const stay = () => {
      leaving.current = false;
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener("pageshow", stay);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener("pageshow", stay);
    };
  }, []);
  return leaving;
}

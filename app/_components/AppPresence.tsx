"use client";

import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";

export const VISIBLE_INTERVAL_MS = 10_000;
// Browsers throttle a background tab's timers to about once a minute, so a
// hidden tab promises its next heartbeat later instead of going offline.
export const HIDDEN_INTERVAL_MS = 60_000;

// Tells Friends a registered user has Contextus open, from any tab, including
// a background one.
export function AppPresence() {
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(
    api.users.getUser,
    isAuthenticated ? {} : "skip",
  );
  const registeredUserId =
    currentUser?.isAnonymous === false ? currentUser._id : null;
  const heartbeat = useMutation(api.presence.appHeartbeat);
  const disconnect = useMutation(api.presence.disconnect);
  const convexUrl = useConvex().url;

  useEffect(() => {
    if (registeredUserId === null) return;
    const sessionId = crypto.randomUUID();
    let sessionToken: string | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const beat = () => {
      const interval = document.hidden
        ? HIDDEN_INTERVAL_MS
        : VISIBLE_INTERVAL_MS;
      heartbeat({ sessionId, interval })
        .then((result) => {
          if (result === null) return;
          if (stopped) void disconnect(result);
          else sessionToken = result.sessionToken;
        })
        .catch(() => {});
      return interval;
    };
    const schedule = () => {
      clearInterval(timer);
      timer = setInterval(beat, beat());
    };
    const sendDisconnectBeacon = () => {
      if (sessionToken === null) return;
      navigator.sendBeacon(
        `${convexUrl}/api/mutation`,
        new Blob(
          [
            JSON.stringify({
              path: "presence:disconnect",
              args: { sessionToken },
            }),
          ],
          { type: "application/json" },
        ),
      );
    };

    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("beforeunload", sendDisconnectBeacon);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("beforeunload", sendDisconnectBeacon);
      if (sessionToken !== null) void disconnect({ sessionToken });
    };
  }, [registeredUserId, heartbeat, disconnect, convexUrl]);

  return null;
}

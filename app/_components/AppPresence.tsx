"use client";

import { useConvex, useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { api } from "@/convex/_generated/api";

export const VISIBLE_INTERVAL_MS = 10_000;
// Browsers throttle a background tab's timers to about once a minute, so a
// hidden tab promises its next heartbeat later instead of going offline.
export const HIDDEN_INTERVAL_MS = 60_000;

// Each effect owns one user's tab session. A failed initial heartbeat returns
// to disconnected; a failed renewal retains the token so teardown can release it.
type Connection =
  | { kind: "disconnected" }
  | { kind: "connecting" }
  | { kind: "connected"; sessionToken: string }
  | { kind: "stopped" };

// Tells Friends a registered user has Contextus open, from any tab, including
// a background one.
export function AppPresence() {
  const { isAuthenticated } = useConvexAuth();
  const currentUser = useQuery(
    api.users.getUser,
    isAuthenticated ? {} : "skip",
  );
  const registeredUserId =
    isAuthenticated && currentUser?.isAnonymous === false
      ? currentUser._id
      : null;
  const heartbeat = useMutation(api.presence.appHeartbeat);
  const disconnect = useMutation(api.presence.disconnect);
  const convexUrl = useConvex().url;

  useEffect(() => {
    if (registeredUserId === null) return;
    const sessionId = crypto.randomUUID();
    let connection: Connection = { kind: "disconnected" };
    let timer: ReturnType<typeof setInterval> | undefined;

    const release = (sessionToken: string) => {
      void disconnect({ sessionToken }).catch(() => {});
    };
    const beat = () => {
      const interval = document.hidden
        ? HIDDEN_INTERVAL_MS
        : VISIBLE_INTERVAL_MS;
      if (connection.kind === "stopped") return interval;
      if (connection.kind === "disconnected")
        connection = { kind: "connecting" };
      heartbeat({ sessionId, interval })
        .then((result) => {
          if (result === null) {
            if (connection.kind === "connecting")
              connection = { kind: "disconnected" };
            return;
          }
          if (connection.kind === "stopped") release(result.sessionToken);
          else
            connection = {
              kind: "connected",
              sessionToken: result.sessionToken,
            };
        })
        .catch(() => {
          if (connection.kind === "connecting")
            connection = { kind: "disconnected" };
        });
      return interval;
    };
    const schedule = () => {
      if (connection.kind === "stopped") return;
      clearInterval(timer);
      timer = setInterval(beat, beat());
    };
    const stop = (path: "unload" | "unmount") => {
      const previous = connection;
      connection = { kind: "stopped" };
      clearInterval(timer);
      document.removeEventListener("visibilitychange", schedule);
      window.removeEventListener("beforeunload", unload);
      if (previous.kind !== "connected") return;
      const { sessionToken } = previous;
      if (path === "unmount") {
        release(sessionToken);
        return;
      }
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

    const unload = () => stop("unload");
    schedule();
    document.addEventListener("visibilitychange", schedule);
    window.addEventListener("beforeunload", unload);
    return () => stop("unmount");
  }, [registeredUserId, heartbeat, disconnect, convexUrl]);

  return null;
}

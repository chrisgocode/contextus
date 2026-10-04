"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { getErrorData } from "@/lib/client-errors";
import { reportClientError } from "@/lib/report-error";

// Room entry: the auth ordering behind creating and joining a Room. Pages
// call these hooks and render; they don't coordinate auth readiness or
// pending membership work themselves.

const GUEST_ROOM_LIMIT = "Guest room limit reached";

/**
 * Returns a function that creates a Room, signing in a new Guest first if
 * needed, and resolves with its code. It waits for Convex auth to load, so a
 * click before then takes the right path, and after a Guest sign-in it waits
 * for a signed-in client: `signIn` resolves before the Convex client sends
 * the new token. Rejects with the server's error, e.g. the Guest room limit.
 * A create still waiting on auth when the page unmounts never resolves, so it
 * can't finish somewhere the user has left.
 */
export function useCreateRoom() {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const create = useMutation(api.rooms.create);
  const settled = useRef<boolean | null>(null);
  const waiters = useRef<
    {
      untilAuthenticated: boolean;
      resolve: (isAuthenticated: boolean) => void;
    }[]
  >([]);

  useEffect(() => {
    settled.current = isLoading ? null : isAuthenticated;
    if (isLoading) return;
    waiters.current = waiters.current.filter((waiter) => {
      if (waiter.untilAuthenticated && !isAuthenticated) return true;
      waiter.resolve(isAuthenticated);
      return false;
    });
  }, [isLoading, isAuthenticated]);

  return useCallback(async () => {
    const settledAuth = (untilAuthenticated: boolean) =>
      settled.current === true ||
      (settled.current === false && !untilAuthenticated)
        ? Promise.resolve(settled.current)
        : new Promise<boolean>((resolve) =>
            waiters.current.push({ untilAuthenticated, resolve }),
          );
    if (!(await settledAuth(false))) {
      await signIn("anonymous");
      await settledAuth(true);
    }
    const { code } = await create({});
    return code;
  }, [create, signIn]);
}

/**
 * Loads a Room by code and joins it once the viewer is signed in and the Room
 * is active. A failed join stays failed for that viewer and Room, and a join
 * started for a previous viewer, Room, or mounted page can't overwrite the
 * current state. `leave` stops the page from rejoining the Room it is leaving.
 */
export function useRoomEntry(code: string) {
  const { isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  const data = useQuery(api.rooms.getByCode, { code });
  const join = useMutation(api.rooms.join);
  const leaveMutation = useMutation(api.rooms.leave);
  const [failure, setFailure] = useState<{
    attempt: string;
    message: string;
  } | null>(null);
  const [leaving, setLeaving] = useState(false);

  const viewerUserId = data?.viewerUserId ?? null;
  const isMember =
    viewerUserId !== null &&
    data != null &&
    data.members.some((m) => m.userId === viewerUserId);
  // Who is entering which Room. Errors and pending joins belong to one.
  const attempt = `${code}:${isAuthenticated}:${viewerUserId}`;
  // A failure is dropped once the attempt changes, so the same viewer
  // returning after an auth change tries again instead of seeing it.
  const [lastAttempt, setLastAttempt] = useState(attempt);
  if (lastAttempt !== attempt) {
    setLastAttempt(attempt);
    setFailure(null);
  }
  const joinError = failure?.attempt === attempt ? failure.message : null;
  const shouldJoin =
    data != null &&
    isAuthenticated &&
    viewerUserId !== null &&
    data.room.status === "active" &&
    !isMember &&
    joinError === null &&
    !leaving;

  const currentAttempt = useRef<string | null>(attempt);
  const pendingAttempt = useRef<string | null>(null);
  useEffect(() => {
    currentAttempt.current = attempt;
    return () => {
      currentAttempt.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (!shouldJoin || pendingAttempt.current === attempt) return;
    pendingAttempt.current = attempt;
    join({ code })
      .catch((err) => {
        if (currentAttempt.current !== attempt) return;
        // Shown in place of the Room, including the Guest room limit.
        const message = reportClientError(err, {
          userMessage: "Could not join room. Try again.",
          context: "room.autojoin",
          showToast: false,
        });
        setFailure({ attempt, message });
      })
      .finally(() => {
        if (pendingAttempt.current === attempt) pendingAttempt.current = null;
      });
  }, [attempt, code, join, shouldJoin]);

  const joinAsGuest = async () => {
    try {
      await signIn("anonymous");
    } catch (err) {
      if (getErrorData(err) === GUEST_ROOM_LIMIT) {
        setFailure({ attempt, message: GUEST_ROOM_LIMIT });
      } else {
        reportClientError(err, {
          userMessage: "Could not join as guest. Try again.",
          context: "room.guestJoin",
        });
      }
    }
  };

  // Rejects if the leave fails, and the viewer stays a member.
  const leave = async () => {
    if (data == null) return;
    setLeaving(true);
    try {
      await leaveMutation({ roomId: data.room._id });
    } catch (err) {
      setLeaving(false);
      throw err;
    }
  };

  return { data, isMember, joinError, joinAsGuest, leave };
}

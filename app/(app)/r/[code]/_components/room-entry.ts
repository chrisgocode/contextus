"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { api } from "@/convex/_generated/api";
import { appErrorData } from "@/convex/lib/errors";
import type { ErrorContext } from "@/lib/client-errors";
import { reportClientError, runMutation } from "@/lib/report-error";
import { clearCreatedRoom, isCreatedRoom } from "./created-room";

// Room entry: the auth ordering behind creating and joining a Room, and what
// the Room page should show while it happens. Pages call these hooks and
// render; they don't coordinate auth readiness, pending membership work or
// server error codes themselves.

/** Why creating or joining a Room failed. */
export type EntryFailure =
  | { kind: "guestLimit" }
  | { kind: "error"; message: string };

// The Guest room limit is its own failure; anything else is reported and
// becomes a message to show inline.
function toFailure(
  err: unknown,
  opts: { context: ErrorContext; fallback: string },
): EntryFailure {
  if (appErrorData(err)?.code === "guestRoomLimit")
    return { kind: "guestLimit" };
  const message = reportClientError(err, {
    userMessage: opts.fallback,
    context: opts.context,
    showToast: false,
  });
  return { kind: "error", message };
}

export type RoomEntryAuth = {
  isLoading: boolean;
  isAuthenticated: boolean;
  signIn: (provider: "anonymous") => Promise<unknown>;
};

function useConvexEntryAuth(): RoomEntryAuth {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signIn } = useAuthActions();
  return { isLoading, isAuthenticated, signIn };
}

/**
 * Where Room entry reads auth from: Convex Auth, unless a test provides
 * another hook. The hook must stay the same for the life of the tree.
 */
export const RoomEntryAuthContext =
  createContext<() => RoomEntryAuth>(useConvexEntryAuth);

function useEntryAuth() {
  const useAuth = useContext(RoomEntryAuthContext);
  return useAuth();
}

/**
 * Returns a function that creates a Room, signing in a new Guest first if
 * needed, and resolves with its code or why it failed. It waits for Convex
 * auth to load, so a click before then takes the right path, and after a
 * Guest sign-in it waits for a signed-in client: `signIn` resolves before the
 * Convex client sends the new token. A create still waiting on auth when the
 * page unmounts never resolves, so it can't finish somewhere the user has
 * left.
 */
export function useCreateRoom() {
  const { isLoading, isAuthenticated, signIn } = useEntryAuth();
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

  return useCallback(async (): Promise<
    { kind: "created"; code: string } | EntryFailure
  > => {
    const settledAuth = (untilAuthenticated: boolean) =>
      settled.current === true ||
      (settled.current === false && !untilAuthenticated)
        ? Promise.resolve(settled.current)
        : new Promise<boolean>((resolve) =>
            waiters.current.push({ untilAuthenticated, resolve }),
          );
    try {
      if (!(await settledAuth(false))) {
        await signIn("anonymous");
        await settledAuth(true);
      }
      const { code } = await create({});
      return { kind: "created", code };
    } catch (err) {
      return toFailure(err, {
        context: "room.create",
        fallback: "Could not create room. Try again.",
      });
    }
  }, [create, signIn]);
}

type RoomData = NonNullable<FunctionReturnType<typeof api.rooms.getByCode>>;

/** A Room as its member sees it. */
export type RoomView = {
  data: RoomData;
  activeGame: FunctionReturnType<typeof api.games.getActive> | undefined;
  lastFinished: FunctionReturnType<typeof api.games.listFinished> | undefined;
};

/** What the Room page shows. */
export type RoomEntry =
  // `waiting`: this client just created the Room, so it opens on game setup.
  | { kind: "loading"; waiting: boolean }
  | { kind: "notFound" }
  // The Room ended; the page goes home.
  | { kind: "ended" }
  | { kind: "needsAuth"; code: string; joinAsGuest: () => Promise<void> }
  // Signed in, but the server no longer knows the viewer.
  | { kind: "sessionExpired" }
  | { kind: "guestLimit" }
  | { kind: "joinFailed"; message: string }
  | { kind: "joining"; waiting: boolean }
  // `leave` resolves to whether the viewer left; a failure is reported.
  | { kind: "member"; view: RoomView; leave: () => Promise<boolean> }
  // The Room as it looked when the viewer left. Once the leave lands, the
  // queries describe a non-member, so this stays until the page is gone.
  | { kind: "leaving"; view: RoomView };

/**
 * Loads a Room by code, joins it once the viewer is signed in and the Room is
 * active, and says what the page should show. A failed join stays failed for
 * that viewer and Room, and a join started for a previous viewer, Room, or
 * mounted page can't overwrite the current state. Leaving stops the page from
 * rejoining the Room it is leaving.
 */
export function useRoomEntry(code: string): RoomEntry {
  const { isLoading, isAuthenticated, signIn } = useEntryAuth();
  const data = useQuery(api.rooms.getByCode, { code });
  const join = useMutation(api.rooms.join);
  const leaveMutation = useMutation(api.rooms.leave);
  const [failure, setFailure] = useState<{
    attempt: string;
    failure: EntryFailure;
  } | null>(null);
  const [leavingView, setLeavingView] = useState<RoomView | null>(null);

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
  const joinFailure = failure?.attempt === attempt ? failure.failure : null;
  const shouldJoin =
    data != null &&
    isAuthenticated &&
    viewerUserId !== null &&
    data.room.status === "active" &&
    !isMember &&
    joinFailure === null &&
    leavingView === null;

  // Consumed on mount, so a visit abandoned before the game query resolves
  // can't leave the marker set for a later visit to the same room.
  const [createdCode, setCreatedCode] = useState(() =>
    isCreatedRoom(code) ? code : null,
  );
  const created = createdCode === code;
  const roomId = data != null && isMember ? data.room._id : null;
  const activeGameResult = useQuery(
    api.games.getActive,
    roomId !== null ? { roomId } : "skip",
  );
  // A room this client just created has no game yet, so skip straight to the
  // setup calendar rather than flashing the guess list skeleton.
  if (created && activeGameResult !== undefined) setCreatedCode(null);
  const activeGame =
    activeGameResult === undefined && created ? null : activeGameResult;
  const lastFinished = useQuery(
    api.games.listFinished,
    roomId !== null && activeGame === null ? { roomId } : "skip",
  );

  useEffect(() => clearCreatedRoom(code), [code]);

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
        setFailure({
          attempt,
          failure: toFailure(err, {
            context: "room.autojoin",
            fallback: "Could not join room. Try again.",
          }),
        });
      })
      .finally(() => {
        if (pendingAttempt.current === attempt) pendingAttempt.current = null;
      });
  }, [attempt, code, join, shouldJoin]);

  if (leavingView !== null) return { kind: "leaving", view: leavingView };
  if (data?.room.status === "ended") return { kind: "ended" };
  if (isLoading || data === undefined)
    return { kind: "loading", waiting: created };
  if (data === null) return { kind: "notFound" };
  if (!isAuthenticated) {
    return {
      kind: "needsAuth",
      code: data.room.code,
      joinAsGuest: async () => {
        await runMutation(() => signIn("anonymous"), {
          context: "room.guestJoin",
          fallback: "Could not join as guest. Try again.",
        });
      },
    };
  }
  if (viewerUserId === null) return { kind: "sessionExpired" };
  if (!isMember) {
    if (joinFailure?.kind === "guestLimit") return { kind: "guestLimit" };
    if (joinFailure?.kind === "error")
      return { kind: "joinFailed", message: joinFailure.message };
    return { kind: "joining", waiting: created };
  }
  const view = { data, activeGame, lastFinished };
  return {
    kind: "member",
    view,
    leave: async () => {
      setLeavingView(view);
      const result = await runMutation(
        () => leaveMutation({ roomId: data.room._id }),
        { context: "room.leave", fallback: "Could not leave room." },
      );
      if (!result.ok) setLeavingView(null);
      return result.ok;
    },
  };
}

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
import type { Id } from "@/convex/_generated/dataModel";
import { appErrorData } from "@/convex/lib/errors";
import type { ErrorContext } from "@/lib/client-errors";
import { reportClientError, runMutation } from "@/lib/report-error";
import { isCreatedRoom, takeCreatedRoom } from "./created-room";
import { peekJoinSource, takeJoinSource } from "./join-source";

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
 * needed, and resolves with its code or why it failed. Given Friends, it
 * invites them to the Room in the same step. It waits for Convex auth to
 * load, so a click before then takes the right path, and after a Guest
 * sign-in it waits for a signed-in client: `signIn` resolves before the Convex
 * client sends the new token. A create still waiting on auth when the page
 * unmounts never resolves, so it can't finish somewhere the user has left.
 */
export function useCreateRoom() {
  const { isLoading, isAuthenticated, signIn } = useEntryAuth();
  const create = useMutation(api.rooms.create);
  const viewer = useQuery(api.users.getUser, isAuthenticated ? {} : "skip");
  const previousViewer = useRef<string | null>(null);
  type AuthReadiness = "loading" | "anonymous" | "tokenReady";
  type Created = { kind: "created"; code: string } | EntryFailure;
  const readiness = useRef<AuthReadiness>("loading");
  const hadToken = useRef(false);
  const lifetime = useRef({ active: true, identity: 0 });
  const pending = useRef<Promise<Created> | null>(null);
  const waiters = useRef<
    {
      until: "settled" | "tokenReady";
      resolve: (authenticated: boolean) => void;
    }[]
  >([]);

  useEffect(() => {
    const owner = { active: true, identity: 0 };
    lifetime.current = owner;
    return () => {
      owner.active = false;
      waiters.current = [];
      pending.current = null;
    };
  }, []);

  useEffect(() => {
    const next: AuthReadiness = isLoading
      ? "loading"
      : isAuthenticated
        ? "tokenReady"
        : "anonymous";
    if (next !== "loading") {
      if (hadToken.current && next === "anonymous") {
        lifetime.current.identity++;
        pending.current = null;
      }
      hadToken.current = next === "tokenReady";
    }
    readiness.current = next;
    if (next === "loading") return;
    waiters.current = waiters.current.filter((waiter) => {
      if (waiter.until === "tokenReady" && next !== "tokenReady") return true;
      waiter.resolve(next === "tokenReady");
      return false;
    });
  }, [isLoading, isAuthenticated]);

  useEffect(() => {
    const next = viewer?._id ?? null;
    if (
      previousViewer.current !== null &&
      next !== null &&
      previousViewer.current !== next
    ) {
      lifetime.current.identity++;
      pending.current = null;
    }
    if (next !== null) previousViewer.current = next;
  }, [viewer?._id]);

  return useCallback(
    (invite?: Id<"users">[]): Promise<Created> => {
      if (pending.current) return pending.current;
      const owner = lifetime.current;
      // Cancellation deliberately never resolves, preserving the app-facing
      // contract: callers cannot navigate using an abandoned result.
      const abandoned = () => new Promise<never>(() => {});
      const settledAuth = (until: "settled" | "tokenReady") =>
        readiness.current === "tokenReady" ||
        (readiness.current === "anonymous" && until === "settled")
          ? Promise.resolve(readiness.current === "tokenReady")
          : new Promise<boolean>((resolve) =>
              waiters.current.push({ until, resolve }),
            );
      const operation = async (): Promise<Created> => {
        const identity = owner.identity;
        const current = () => owner.active && owner.identity === identity;
        try {
          if (!(await settledAuth("settled"))) {
            if (!current()) return abandoned();
            await signIn("anonymous");
            if (!current()) return abandoned();
            await settledAuth("tokenReady");
          }
          if (!current()) return abandoned();
          const { code } = await create(invite === undefined ? {} : { invite });
          if (!current()) return abandoned();
          return { kind: "created", code };
        } catch (err) {
          if (!current()) return abandoned();
          return toFailure(err, {
            context:
              invite === undefined ? "room.create" : "room.playWithFriends",
            fallback: "Could not create room. Try again.",
          });
        }
      };
      const promise = operation().finally(() => {
        if (pending.current === promise) pending.current = null;
      });
      pending.current = promise;
      return promise;
    },
    [create, signIn],
  );
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
  const viewerUserId = data?.viewerUserId ?? null;
  const isMember =
    viewerUserId !== null &&
    data != null &&
    data.members.some((m) => m.userId === viewerUserId);
  const key = `${code}:${isAuthenticated}:${viewerUserId}`;
  // Identity, rather than the key alone, distinguishes A → B → A visits.
  const [scope, setScope] = useState(() => ({ key }));
  type Progress =
    | { kind: "idle" }
    | { kind: "failed"; failure: EntryFailure }
    | { kind: "leaving"; view: RoomView };
  const [progress, setProgress] = useState<Progress>({ kind: "idle" });
  if (scope.key !== key) {
    setScope({ key });
    setProgress({ kind: "idle" });
  }
  const attempt = scope;
  const leavingView =
    scope.key === key && progress.kind === "leaving" ? progress.view : null;
  const joinFailure =
    scope.key === key && progress.kind === "failed" ? progress.failure : null;
  const shouldJoin =
    !isLoading &&
    data != null &&
    isAuthenticated &&
    viewerUserId !== null &&
    data.room.status === "active" &&
    !isMember &&
    joinFailure === null &&
    leavingView === null;

  // Consumed on mount, so a visit abandoned before the game query resolves
  // can't leave the marker set for a later visit to the same room.
  const [destination, setDestination] = useState(() => ({
    code,
    created: isCreatedRoom(code),
    source: { via: peekJoinSource(code) },
  }));
  if (destination.code !== code) {
    setDestination({
      code,
      created: isCreatedRoom(code),
      source: { via: peekJoinSource(code) },
    });
  }
  useEffect(() => {
    takeCreatedRoom(code);
    takeJoinSource(code);
  }, [code]);
  const consumedSources = useRef(new WeakSet<object>());
  const created = destination.code === code && destination.created;
  const roomId = data != null && isMember ? data.room._id : null;
  const activeGameResult = useQuery(
    api.games.getActive,
    roomId !== null ? { roomId } : "skip",
  );
  // A room this client just created has no game yet, so skip straight to the
  // setup calendar rather than flashing the guess list skeleton.
  if (created && activeGameResult !== undefined)
    setDestination({ ...destination, created: false });
  const activeGame =
    activeGameResult === undefined && created ? null : activeGameResult;
  const lastFinished = useQuery(
    api.games.listFinished,
    roomId !== null && activeGame === null ? { roomId } : "skip",
  );

  const currentAttempt = useRef<typeof attempt | null>(attempt);
  const pendingAttempt = useRef<typeof attempt | null>(null);
  useEffect(() => {
    currentAttempt.current = attempt;
    return () => {
      currentAttempt.current = null;
    };
  }, [attempt]);

  useEffect(() => {
    if (!shouldJoin || pendingAttempt.current === attempt) return;
    pendingAttempt.current = attempt;
    const via = consumedSources.current.has(destination.source)
      ? undefined
      : destination.source.via;
    consumedSources.current.add(destination.source);
    join(via === undefined ? { code } : { code, via })
      .catch((err) => {
        if (currentAttempt.current !== attempt) return;
        // Shown in place of the Room, including the Guest room limit.
        setProgress({
          kind: "failed",
          failure: toFailure(err, {
            context: "room.autojoin",
            fallback: "Could not join room. Try again.",
          }),
        });
      })
      .finally(() => {
        if (pendingAttempt.current === attempt) pendingAttempt.current = null;
      });
  }, [attempt, code, destination.source, join, shouldJoin]);

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
      if (currentAttempt.current !== attempt) return false;
      setProgress({ kind: "leaving", view });
      try {
        await leaveMutation({ roomId: data.room._id });
        return currentAttempt.current === attempt;
      } catch (err) {
        if (currentAttempt.current !== attempt) return false;
        reportClientError(err, {
          context: "room.leave",
          userMessage: "Could not leave room.",
        });
        setProgress({ kind: "idle" });
        return false;
      }
    },
  };
}

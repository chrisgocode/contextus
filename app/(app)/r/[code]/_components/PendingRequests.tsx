"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runMutation } from "@/lib/report-error";
import { lazyToast } from "@/lib/toast";

export type RequestKind = "hint" | "giveup";
export type PendingRequest = FunctionReturnType<
  typeof api.requests.listPending
>[number];
export type MyRequest = NonNullable<
  FunctionReturnType<typeof api.requests.latestMine>["hint"]
>;
export type Giving = {
  request: PendingRequest;
  hint?: { lemma: string; distance: number };
};
type RequestId = Id<"pendingRequests">;

// How long an approved hint stays after it settles; the guess list has it.
const GIVEN_HINT_MS = 4000;

type Shared = {
  // Asking for a hint or give-up: a Host gets it directly, anyone else asks
  // the Host. Resolves to whether it landed; a failure is in `askError`.
  ask: (kind: RequestKind) => Promise<boolean>;
  asking: RequestKind | null;
  askError: string | null;
  // Whether the viewer may ask for each kind right now.
  canAsk: Record<RequestKind, boolean>;
  busy: ReadonlySet<RequestId>;
};

export type HostView = Shared & {
  role: "host";
  // Requests waiting on the Host, oldest first.
  waiting: PendingRequest[];
  // Hints being given: found, then revealed until a while after they settle.
  giving: Giving[];
  approve: (request: PendingRequest) => Promise<void>;
  deny: (request: PendingRequest) => Promise<void>;
  // The reveal of a given hint has settled; it clears shortly after.
  settled: (id: RequestId) => void;
};

export type RequesterView = Shared & {
  role: "requester";
  // The viewer's own request of each kind to show: pending, or an outcome
  // this page watched it reach and the viewer hasn't dismissed.
  mine: Record<RequestKind, MyRequest | null>;
  // Who else holds a pending request of each kind.
  others: Record<RequestKind, { name: string } | null>;
  takeBack: (kind: RequestKind, request: MyRequest) => Promise<void>;
  dismiss: (id: RequestId) => void;
};

export type PendingRequests = HostView | RequesterView;

const PendingRequestsContext = createContext<PendingRequests | null>(null);

// One Game's Pending requests for the viewer, Host or not. Mounted once
// around the game so the Assist sheet and the rows above the guess list
// share state: a hint approved in the sheet is revealed in the rows.
export function PendingRequestsProvider({
  gameId,
  isHost,
  children,
}: {
  gameId: Id<"games">;
  isHost: boolean;
  children: React.ReactNode;
}) {
  return (
    <GameRequests key={`${gameId}:${isHost}`} gameId={gameId} isHost={isHost}>
      {children}
    </GameRequests>
  );
}

// The subscription, commands and reveal clocks belong to one Game and role.
// Remounting also resets reveal components when the viewer becomes Host.
function GameRequests({
  gameId,
  isHost,
  children,
}: {
  gameId: Id<"games">;
  isHost: boolean;
  children: React.ReactNode;
}) {
  const requests = usePendingRequestsState(gameId, isHost);
  return (
    <PendingRequestsContext value={requests}>{children}</PendingRequestsContext>
  );
}

export function usePendingRequests(): PendingRequests {
  const requests = useContext(PendingRequestsContext);
  if (requests === null) {
    throw new Error("usePendingRequests needs a PendingRequestsProvider");
  }
  return requests;
}

type AskState =
  | { phase: "idle" }
  | { phase: "asking"; kind: RequestKind }
  | { phase: "failed"; message: string };

type RequestOperation =
  | { phase: "fetching"; request: PendingRequest }
  | {
      phase: "revealing";
      request: PendingRequest;
      hint: NonNullable<Giving["hint"]>;
    }
  | {
      phase: "retained";
      request: PendingRequest;
      hint: NonNullable<Giving["hint"]>;
      until: number;
    }
  | { phase: "approving" | "denying" | "cancelling" };
type RequestEvent =
  | { type: "start"; id: RequestId; state: RequestOperation }
  | { type: "revealed"; id: RequestId; hint: NonNullable<Giving["hint"]> }
  | { type: "settled"; id: RequestId; now: number }
  | { type: "finished"; id: RequestId };

function transitionRequests(
  current: ReadonlyMap<RequestId, RequestOperation>,
  event: RequestEvent,
) {
  const next = new Map(current);
  const entry = current.get(event.id);
  switch (event.type) {
    case "start":
      if (!entry) next.set(event.id, event.state);
      break;
    case "revealed":
      if (entry?.phase === "fetching")
        next.set(event.id, {
          phase: "revealing",
          request: entry.request,
          hint: event.hint,
        });
      break;
    case "settled":
      if (entry?.phase === "revealing")
        next.set(event.id, {
          ...entry,
          phase: "retained",
          until: event.now + GIVEN_HINT_MS,
        });
      break;
    case "finished":
      next.delete(event.id);
  }
  return next;
}

type ObservedRequest =
  | {
      phase: "unobserved";
      source: MyRequest | null | undefined;
      watched?: { id: RequestId; dismissed: boolean };
    }
  | { phase: "waiting" | "outcome" | "dismissed"; source: MyRequest };

function observe(
  previous: ObservedRequest,
  source: MyRequest | null | undefined,
): ObservedRequest {
  if (previous.source === source) return previous;
  if (source?.status === "pending") return { phase: "waiting", source };
  // A cancelled newer request may expose an older decision. Keep the last
  // observed identity even while hidden, without replaying that older result.
  const watched =
    previous.phase === "unobserved"
      ? previous.watched
      : {
          id: previous.source._id,
          dismissed: previous.phase === "dismissed",
        };
  if (source && watched?.id === source._id) {
    return { phase: watched.dismissed ? "dismissed" : "outcome", source };
  }
  return { phase: "unobserved", source, watched };
}

function usePendingRequestsState(
  gameId: Id<"games">,
  isHost: boolean,
): PendingRequests {
  const pending = useQuery(
    api.requests.listPending,
    isHost ? { gameId } : "skip",
  );
  const latest = useQuery(
    api.requests.latestMine,
    isHost ? "skip" : { gameId },
  );
  const fromOthers = useQuery(
    api.requests.pendingFromOthers,
    isHost ? "skip" : { gameId },
  );
  const approveRequest = useAction(api.requests.approve);
  const denyRequest = useMutation(api.requests.deny);
  const cancelRequest = useMutation(api.requests.cancel);
  const createRequest = useMutation(api.requests.create);
  const hostHint = useAction(api.hints.hostHint);
  const hostGiveup = useAction(api.giveup.hostGiveup);

  const [command, setCommand] = useState<AskState>({ phase: "idle" });
  const [entries, dispatch] = useReducer(
    transitionRequests,
    new Map<RequestId, RequestOperation>(),
  );
  const active = useRef(false);
  const inFlight = useRef(new Set<RequestId>());
  const askingNow = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  // Owned clocks rearm from deadlines; repeated settlement is harmless.
  useEffect(() => {
    const retained = [...entries].filter(
      (entry) => entry[1].phase === "retained",
    );
    const timers = retained.map(([id, entry]) =>
      setTimeout(
        () => {
          if (active.current) dispatch({ type: "finished", id });
        },
        entry.phase === "retained" ? Math.max(0, entry.until - Date.now()) : 0,
      ),
    );
    return () => timers.forEach(clearTimeout);
  }, [entries]);

  const [observed, setObserved] = useState<
    Record<RequestKind, ObservedRequest>
  >({
    hint: { phase: "unobserved", source: undefined },
    giveup: { phase: "unobserved", source: undefined },
  });
  const hint = observe(observed.hint, latest?.hint);
  const giveupObservation = observe(observed.giveup, latest?.giveup);
  if (hint !== observed.hint || giveupObservation !== observed.giveup) {
    setObserved({ hint, giveup: giveupObservation });
  }
  const pendingHint =
    latest?.hint?.status === "pending" ? latest.hint._id : null;
  const pendingGiveup =
    latest?.giveup?.status === "pending" ? latest.giveup._id : null;
  const asking = command.phase === "asking" ? command.kind : null;
  const askError = command.phase === "failed" ? command.message : null;
  const busy = new Set(
    [...entries]
      .filter(
        ([, state]) =>
          state.phase !== "revealing" && state.phase !== "retained",
      )
      .map(([id]) => id),
  );
  const giving: Giving[] = [...entries.values()].flatMap((state) => {
    switch (state.phase) {
      case "fetching":
        return [{ request: state.request }];
      case "revealing":
      case "retained":
        return [{ request: state.request, hint: state.hint }];
      default:
        return [];
    }
  });
  const start = (id: RequestId, state: RequestOperation) => {
    if (!active.current || inFlight.current.has(id) || entries.has(id))
      return false;
    inFlight.current.add(id);
    dispatch({ type: "start", id, state });
    return true;
  };
  const finish = (id: RequestId) => {
    inFlight.current.delete(id);
    if (active.current) dispatch({ type: "finished", id });
  };

  // Report errors as usual, but only the originating view may show a toast.
  async function runRequest<T>(
    fn: () => Promise<T>,
    options: Parameters<typeof runMutation>[1],
  ) {
    const result = await runMutation(fn, { ...options, showToast: false });
    if (!result.ok && active.current)
      lazyToast((toast) => {
        if (active.current) toast.error(result.message);
      });
    return result;
  }

  async function ask(kind: RequestKind) {
    if (!active.current || askingNow.current) return false;
    askingNow.current = true;
    setCommand({ phase: "asking", kind });
    const result = await runMutation(
      async () => {
        if (isHost) {
          if (kind === "hint") await hostHint({ gameId });
          else await hostGiveup({ gameId });
        } else {
          await createRequest({ gameId, type: kind });
        }
      },
      {
        context: `${isHost ? "host" : "request"}.${kind}`,
        fallback:
          kind === "hint"
            ? isHost
              ? "Could not get a hint. Try again."
              : "Could not request a hint. Try again."
            : isHost
              ? "Could not give up. Try again."
              : "Could not request to give up. Try again.",
        showToast: false,
      },
    );
    askingNow.current = false;
    if (!active.current) return false;
    setCommand(
      result.ok
        ? { phase: "idle" }
        : { phase: "failed", message: result.message },
    );
    return result.ok;
  }

  if (isHost) {
    async function approve(request: PendingRequest) {
      if (
        !start(
          request._id,
          request.type === "hint"
            ? { phase: "fetching", request }
            : { phase: "approving" },
        )
      )
        return;
      const result = await runRequest(
        () => approveRequest({ requestId: request._id }),
        {
          context: `request.approve.${request.type}`,
          fallback: "Could not approve request.",
        },
      );
      inFlight.current.delete(request._id);
      if (!active.current) return;
      if (
        request.type === "hint" &&
        result.ok &&
        result.value.distance !== undefined
      ) {
        dispatch({
          type: "revealed",
          id: request._id,
          hint: { lemma: result.value.lemma, distance: result.value.distance },
        });
      } else {
        dispatch({ type: "finished", id: request._id });
      }
    }

    async function deny(request: PendingRequest) {
      if (!start(request._id, { phase: "denying" })) return;
      await runRequest(() => denyRequest({ requestId: request._id }), {
        context: `request.deny.${request.type}`,
        fallback: "Could not deny request.",
      });
      finish(request._id);
    }

    return {
      role: "host",
      ask,
      asking,
      askError,
      canAsk: { hint: asking === null, giveup: asking === null },
      busy,
      waiting: (pending ?? []).filter(
        (p) => !giving.some((entry) => entry.request._id === p._id),
      ),
      giving: giving.sort(
        (a, b) => a.request._creationTime - b.request._creationTime,
      ),
      approve,
      deny,
      settled: (id) => {
        if (active.current) dispatch({ type: "settled", id, now: Date.now() });
      },
    };
  }

  const shown = (kind: RequestKind) => {
    const entry = observed[kind];
    return entry.phase === "waiting" || entry.phase === "outcome"
      ? entry.source
      : null;
  };
  const giveup = shown("giveup");
  const others = {
    hint: fromOthers?.hint ?? null,
    giveup: fromOthers?.giveup ?? null,
  };

  return {
    role: "requester",
    ask,
    asking,
    askError,
    // One request of each kind at a time per Game.
    canAsk: {
      hint: asking === null && pendingHint === null && others.hint === null,
      giveup:
        asking === null && pendingGiveup === null && others.giveup === null,
    },
    busy,
    mine: {
      hint: shown("hint"),
      // An approved give-up ends the Game, and the end screen takes over.
      giveup: giveup?.status === "approved" ? null : giveup,
    },
    others,
    takeBack: async (kind, request) => {
      if (!start(request._id, { phase: "cancelling" })) return;
      await runRequest(() => cancelRequest({ requestId: request._id }), {
        context: `request.cancel.${kind}`,
        fallback: "Could not take back the request.",
      });
      finish(request._id);
    },
    dismiss: (id) => {
      if (!active.current) return;
      setObserved((current) => {
        const next = { ...current };
        for (const kind of ["hint", "giveup"] as const) {
          const entry = current[kind];
          if (entry.phase === "outcome" && entry.source._id === id)
            next[kind] = { ...entry, phase: "dismissed" };
        }
        return next;
      });
    },
  };
}

"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { createContext, useContext, useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runMutation } from "@/lib/report-error";

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

  const [busy, setBusy] = useState<ReadonlySet<RequestId>>(new Set());
  const [asking, setAsking] = useState<RequestKind | null>(null);
  const [askError, setAskError] = useState<string | null>(null);
  // The hint request leaves `pending` as soon as it's approved, so the row
  // that reveals it lives here until it's done.
  const [giving, setGiving] = useState<ReadonlyMap<RequestId, Giving>>(
    new Map(),
  );
  // The last request of each kind this page watched while pending. Only its
  // outcome shows, so a reload doesn't replay old decisions and a newer
  // request retires the one before it.
  const [watching, setWatching] = useState<
    Partial<Record<RequestKind, string>>
  >({});
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  // Each Game's requests are its own, so nothing carries over into the next.
  const [forGame, setForGame] = useState(gameId);
  if (forGame !== gameId) {
    setForGame(gameId);
    setBusy(new Set());
    setAsking(null);
    setAskError(null);
    setGiving(new Map());
    setWatching({});
    setDismissed(new Set());
  }

  const pendingId = (kind: RequestKind) =>
    latest?.[kind]?.status === "pending" ? latest[kind]._id : null;
  const pendingHint = pendingId("hint");
  const pendingGiveup = pendingId("giveup");
  if (
    (pendingHint !== null && pendingHint !== watching.hint) ||
    (pendingGiveup !== null && pendingGiveup !== watching.giveup)
  ) {
    setWatching({
      hint: pendingHint ?? watching.hint,
      giveup: pendingGiveup ?? watching.giveup,
    });
  }

  const setBusyFor = (id: RequestId, on: boolean) =>
    setBusy((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const updateGiving = (id: RequestId, entry: Giving | null) =>
    setGiving((current) => {
      const next = new Map(current);
      if (entry === null) next.delete(id);
      else next.set(id, entry);
      return next;
    });

  async function ask(kind: RequestKind) {
    setAskError(null);
    setAsking(kind);
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
    if (!result.ok) setAskError(result.message);
    setAsking(null);
    return result.ok;
  }

  if (isHost) {
    async function approve(request: PendingRequest) {
      if (request.type === "hint") updateGiving(request._id, { request });
      setBusyFor(request._id, true);
      const result = await runMutation(
        () => approveRequest({ requestId: request._id }),
        {
          context: `request.approve.${request.type}`,
          fallback: "Could not approve request.",
        },
      );
      if (request.type === "hint") {
        // Hint turns always score a distance; without one, skip the reveal.
        updateGiving(
          request._id,
          !result.ok || result.value.distance === undefined
            ? null
            : {
                request,
                hint: {
                  lemma: result.value.lemma,
                  distance: result.value.distance,
                },
              },
        );
      }
      setBusyFor(request._id, false);
    }

    async function deny(request: PendingRequest) {
      setBusyFor(request._id, true);
      await runMutation(() => denyRequest({ requestId: request._id }), {
        context: `request.deny.${request.type}`,
        fallback: "Could not deny request.",
      });
      setBusyFor(request._id, false);
    }

    return {
      role: "host",
      ask,
      asking,
      askError,
      canAsk: { hint: asking === null, giveup: asking === null },
      busy,
      waiting: (pending ?? []).filter((p) => !giving.has(p._id)),
      giving: [...giving.values()].sort(
        (a, b) => a.request._creationTime - b.request._creationTime,
      ),
      approve,
      deny,
      settled: (id) => {
        setTimeout(() => updateGiving(id, null), GIVEN_HINT_MS);
      },
    };
  }

  const shown = (kind: RequestKind) => {
    const request = latest?.[kind];
    return request != null &&
      (request.status === "pending" ||
        (request._id === watching[kind] && !dismissed.has(request._id)))
      ? request
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
      setBusyFor(request._id, true);
      await runMutation(() => cancelRequest({ requestId: request._id }), {
        context: `request.cancel.${kind}`,
        fallback: "Could not take back the request.",
      });
      setBusyFor(request._id, false);
    },
    dismiss: (id) => setDismissed((current) => new Set([...current, id])),
  };
}

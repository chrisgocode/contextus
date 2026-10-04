import { getFunctionName } from "convex/server";
import { type Mock, vi } from "vitest";
import { PendingRequestsProvider } from "@/app/(app)/r/[code]/_components/PendingRequests";

type ConvexHooks = {
  useAction: Mock;
  useMutation: Mock;
  useQuery: Mock;
};

type Mine = { hint: unknown; giveup: unknown };
type Others = {
  hint: { name: string } | null;
  giveup: { name: string } | null;
};

// The one fake for Pending requests: what the requests queries return, and
// the mutations and actions behind each request. A query skipped for the
// viewer's role returns undefined, like Convex. Change a field, then
// rerender, to model a query update.
export function fakeRequests(
  convex: ConvexHooks,
  initial: {
    listPending?: unknown[];
    latestMine?: Mine;
    pendingFromOthers?: Others;
  } = {},
) {
  const fake = {
    listPending: initial.listPending ?? [],
    latestMine: initial.latestMine ?? { hint: null, giveup: null },
    pendingFromOthers: initial.pendingFromOthers ?? {
      hint: null,
      giveup: null,
    },
    approve: vi.fn().mockResolvedValue({ lemma: "answer" }),
    deny: vi.fn().mockResolvedValue(null),
    cancel: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(null),
    hostHint: vi.fn().mockResolvedValue(null),
    hostGiveup: vi.fn().mockResolvedValue(null),
  };
  const queries: Record<string, () => unknown> = {
    "requests:listPending": () => fake.listPending,
    "requests:latestMine": () => fake.latestMine,
    "requests:pendingFromOthers": () => fake.pendingFromOthers,
  };
  const functions: Record<string, Mock> = {
    "requests:approve": fake.approve,
    "requests:deny": fake.deny,
    "requests:cancel": fake.cancel,
    "requests:create": fake.create,
    "hints:hostHint": fake.hostHint,
    "giveup:hostGiveup": fake.hostGiveup,
  };
  convex.useQuery.mockImplementation((reference, args) => {
    const name = getFunctionName(reference);
    const query = queries[name];
    if (query === undefined) throw new Error(`Unexpected query: ${name}`);
    return args === "skip" ? undefined : query();
  });
  const route = (reference: never) => {
    const name = getFunctionName(reference);
    const fn = functions[name];
    if (fn === undefined) throw new Error(`Unexpected function: ${name}`);
    return fn;
  };
  convex.useMutation.mockImplementation(route);
  convex.useAction.mockImplementation(route);
  return fake;
}

export function RequestsProvider({
  gameId = "game",
  isHost,
  children,
}: {
  gameId?: string;
  isHost: boolean;
  children: React.ReactNode;
}) {
  return (
    <PendingRequestsProvider gameId={gameId as never} isHost={isHost}>
      {children}
    </PendingRequestsProvider>
  );
}

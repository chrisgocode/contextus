import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import { GuessInput } from "@/app/(app)/r/[code]/_components/GuessInput";
import {
  PendingRequestsProvider,
  usePendingRequests,
} from "@/app/(app)/r/[code]/_components/PendingRequests";
import { act, fireEvent, render, screen, userEvent } from "./test-utils";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  create: vi.fn(),
  hostHint: vi.fn(),
}));
vi.mock("convex/react", () => ({
  useAction: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "guesses:submit" ? mocks.submit : mocks.hostHint,
  useMutation: () => mocks.create,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    if (args === "skip") return undefined;
    if (getFunctionName(ref) === "requests:listPending") return [];
    return { hint: null, giveup: null };
  },
}));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
});

it.each([false, true])(
  "preserves a same-Game Guess through role changes (duplicate: %s)",
  async (duplicate) => {
    const pending = Promise.withResolvers<unknown>();
    mocks.submit.mockReturnValue(pending.promise);
    const onDuplicate = vi.fn();
    const view = (isHost: boolean) => (
      <PendingRequestsProvider gameId={"game" as never} isHost={isHost}>
        <GuessInput
          gameId={"game" as never}
          onAchievementsUnlocked={vi.fn()}
          onDuplicate={onDuplicate}
        />
      </PendingRequestsProvider>
    );
    const page = render(view(false));
    fireEvent.change(screen.getByPlaceholderText("Type a word…"), {
      target: { value: "apples" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guess" }));
    page.rerender(view(true));
    expect(screen.getByRole("button", { name: "Guess" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Guess" }));
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    page.rerender(view(false));
    await act(async () =>
      pending.resolve({
        lemma: "apple",
        alreadyGuessed: duplicate,
        unlockedAchievementIds: [],
        won: false,
      }),
    );
    expect(screen.getByPlaceholderText("Type a word…")).toHaveValue("");
    expect(sessionStorage.getItem("guess-draft:game")).toBeNull();
    if (duplicate) expect(onDuplicate).toHaveBeenLastCalledWith("apple");
  },
);

function RequestControls() {
  const requests = usePendingRequests();
  return (
    <>
      <button
        disabled={requests.asking !== null}
        onClick={() => void requests.ask("hint")}
      >
        Ask hint
      </button>
      <output>
        {requests.role}:{requests.asking ?? "idle"}:{requests.askError}
      </output>
    </>
  );
}

it("resets role-specific requests and ignores an old failure while the new role is asking", async () => {
  const old = Promise.withResolvers<null>();
  const current = Promise.withResolvers<null>();
  mocks.create.mockReturnValue(old.promise);
  mocks.hostHint.mockReturnValue(current.promise);
  const view = (isHost: boolean) => (
    <PendingRequestsProvider gameId={"game" as never} isHost={isHost}>
      <RequestControls />
    </PendingRequestsProvider>
  );
  const page = render(view(false));
  fireEvent.click(screen.getByRole("button", { name: "Ask hint" }));
  page.rerender(view(true));
  expect(screen.getByRole("button", { name: "Ask hint" })).toBeEnabled();
  fireEvent.click(screen.getByRole("button", { name: "Ask hint" }));
  await act(async () => old.reject(new Error("old failure")));
  expect(screen.getByRole("status")).toHaveTextContent("host:hint:");
  expect(screen.getByRole("button", { name: "Ask hint" })).toBeDisabled();
  await act(async () => current.resolve(null));
  expect(screen.getByRole("status")).toHaveTextContent("host:idle:");
});

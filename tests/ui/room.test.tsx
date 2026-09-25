// @vitest-environment jsdom

import { Suspense } from "react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACHIEVEMENT_UNLOCK_DISPLAY_MS } from "@/app/_components/AchievementUnlockQueue";
import RoomPage from "@/app/r/[code]/page";
import { reportClientError } from "@/lib/report-error";
import { act, render, screen, userEvent, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
  endRoom: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  signIn: vi.fn(),
  submit: vi.fn(),
  useAction: vi.fn(),
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useAction: mocks.useAction,
  useConvexAuth: mocks.useConvexAuth,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocks.signIn }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("@/app/r/[code]/_components/usePresenceSet", () => ({
  usePresenceSet: () => new Set(["friend"]),
}));
vi.mock("@/app/r/[code]/_components/useElementInViewport", () => ({
  useElementInViewport: () => true,
}));
vi.mock("@/app/r/[code]/_components/GuessList", () => ({
  GuessList: () => <div>Guess list</div>,
}));
vi.mock("@/app/r/[code]/_components/HintGiveupBar", () => ({
  HintGiveupBar: () => <div>Hint controls</div>,
}));
vi.mock("@/app/r/[code]/_components/PendingRequestsSidebar", () => ({
  PendingRequestsSidebar: () => <div>Requests</div>,
}));
vi.mock("@/app/r/[code]/_components/GameSetupCalendar", () => ({
  GameSetupCalendar: () => <div>Game setup</div>,
}));
vi.mock("@/app/r/[code]/_components/EndGameBanner", () => ({
  EndGameBanner: () => <div>End game</div>,
}));

const params = Promise.resolve({ code: "abcdef" });
const room = {
  isViewerHost: true,
  members: [
    { player: { image: null, name: "Alex" }, isHost: true, userId: "user" },
    { player: { image: null, name: "Blair" }, isHost: false, userId: "friend" },
  ],
  room: { _id: "room", code: "ABCDEF", status: "active" },
  viewerUserId: "user",
};

async function renderRoom() {
  let view!: ReturnType<typeof render>;
  await act(async () => {
    view = render(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
  });
  return view;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.clipboardWrite },
  });
  mocks.clipboardWrite.mockResolvedValue(undefined);
  mocks.useConvexAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
  });
  mocks.useAction.mockReturnValue(mocks.submit);
  mocks.useMutation.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "rooms:leave") return mocks.leave;
    if (name === "rooms:endRoom") return mocks.endRoom;
    if (name === "rooms:join") return mocks.join;
    throw new Error(`Unexpected mutation: ${name}`);
  });
  mocks.useQuery.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "rooms:getByCode") return room;
    if (name === "games:getActive") return { _id: "game", contextoGameId: 123 };
    if (name === "games:listFinished") return [];
    if (name === "requests:listPending") return [];
    throw new Error(`Unexpected query: ${name}`);
  });
});

afterEach(() => vi.useRealTimers());

describe("RoomPage", () => {
  it("shows winning guess unlocks after the active game disappears", async () => {
    let resolveSubmit!: (value: unknown) => void;
    mocks.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    let activeGame: { _id: string; contextoGameId: number } | null = {
      _id: "game",
      contextoGameId: 123,
    };
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode") return room;
      if (name === "games:getActive") return activeGame;
      if (name === "games:listFinished") return [];
      if (name === "requests:listPending") return [];
      throw new Error(`Unexpected query: ${name}`);
    });
    const user = userEvent.setup();
    const view = await renderRoom();
    await user.type(screen.getByPlaceholderText("Type a word…"), "answer");
    await user.click(screen.getByRole("button", { name: "Guess" }));

    activeGame = null;
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    vi.useFakeTimers();
    await act(async () =>
      resolveSubmit({
        message: null,
        won: true,
        lemma: "answer",
        unlockedAchievementIds: ["one_and_done", "bullseye"],
      }),
    );

    expect(
      screen.getByText("Diamond achievement unlocked: One and Done"),
    ).toBeVisible();
    await act(async () =>
      vi.advanceTimersByTime(ACHIEVEMENT_UNLOCK_DISPLAY_MS),
    );
    expect(
      screen.getByText("Bronze achievement unlocked: Bullseye"),
    ).toBeVisible();
  });

  it("renders an active member room and performs host room controls", async () => {
    mocks.leave.mockResolvedValue(null);
    mocks.endRoom.mockResolvedValue(null);
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await renderRoom();

    expect(
      await screen.findByRole("heading", { name: "ABCDEF" }),
    ).toBeVisible();
    expect(screen.getByText("Alex")).toBeVisible();
    expect(screen.getByText("Blair")).toBeVisible();
    expect(screen.getByText("Game #123")).toBeVisible();

    await user.click(screen.getByRole("button", { name: /^Copy/ }));
    expect(writeText).toHaveBeenCalledWith("ABCDEF");
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(mocks.leave).toHaveBeenCalledWith({ roomId: "room" });
    await user.click(screen.getByRole("button", { name: /^End/ }));
    expect(mocks.endRoom).toHaveBeenCalledWith({ roomId: "room" });
    expect(mocks.push).toHaveBeenCalledWith("/");
  });

  it("lets an unauthenticated visitor join as a guest or sign in", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    mocks.signIn.mockResolvedValue(null);
    mocks.join.mockResolvedValue(null);
    const user = userEvent.setup();
    await renderRoom();

    await user.click(
      await screen.findByRole("button", { name: "Join as guest" }),
    );
    expect(mocks.signIn).toHaveBeenCalledWith("anonymous");
    expect(mocks.join).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mocks.push).toHaveBeenCalledWith("/signin?redirectTo=%2Fr%2FABCDEF");
  });

  it("offers account creation when automatic guest joining hits the limit", async () => {
    mocks.join.mockRejectedValue({ data: "Guest room limit reached" });
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode")
        return { ...room, isViewerHost: false, viewerUserId: "other" };
      if (name === "games:getActive" || name === "games:listFinished")
        return undefined;
      throw new Error(`Unexpected query: ${name}`);
    });
    const user = userEvent.setup();
    await renderRoom();

    expect(
      await screen.findByText(
        "Create an account to host or join more active rooms.",
      ),
    ).toBeVisible();
    expect(reportClientError).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(mocks.push).toHaveBeenCalledWith("/signin?redirectTo=%2Fr%2FABCDEF");
  });

  it("handles missing and ended rooms", async () => {
    mocks.useQuery.mockReturnValue(null);
    const user = userEvent.setup();
    const view = await renderRoom();
    expect(await screen.findByText("Room not found.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(mocks.push).toHaveBeenCalledWith("/");

    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode")
        return { ...room, room: { ...room.room, status: "ended" } };
      if (name === "games:getActive") return null;
      if (name === "games:listFinished") return [];
      if (name === "requests:listPending") return [];
      throw new Error(`Unexpected query: ${name}`);
    });
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });
});

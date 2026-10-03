import { Suspense } from "react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACHIEVEMENT_UNLOCK_DISPLAY_MS } from "@/app/_components/AchievementUnlockQueue";
import {
  clearCreatedRoom,
  markRoomCreated,
} from "@/app/(app)/r/[code]/_components/created-room";
import { RoomSkeleton } from "@/app/(app)/r/[code]/_components/RoomSkeleton";
import RoomLoading from "@/app/(app)/r/[code]/loading";
import RoomPage from "@/app/(app)/r/[code]/page";
import { reportClientError } from "@/lib/report-error";
import { act, render, screen, userEvent, waitFor, within } from "./test-utils";

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
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

// Skip downloading react-day-picker; these tests don't render the calendar.
vi.mock("@/app/(app)/r/[code]/_components/calendar-loader", () => ({
  preloadCalendar: () => {},
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
  useParams: () => ({ code: "abcdef" }),
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("@/app/(app)/r/[code]/_components/usePresenceSet", () => ({
  usePresenceSet: () => new Set(["friend"]),
}));
vi.mock("@/app/(app)/r/[code]/_components/GuessList", () => ({
  GuessList: () => <div>Guess list</div>,
}));
vi.mock("@/app/(app)/r/[code]/_components/AssistSheet", () => ({
  AssistSheet: () => <div>Hint controls</div>,
}));
vi.mock("@/app/(app)/r/[code]/_components/HostRequestRows", () => ({
  HostRequestRows: () => <div>Requests</div>,
  useHostRequests: () => null,
}));
vi.mock("@/app/(app)/r/[code]/_components/GameSetupCalendar", () => ({
  GameSetupCalendar: () => <div>Game setup</div>,
}));
vi.mock("@/app/(app)/r/[code]/_components/EndGameBanner", () => ({
  EndGameBanner: () => <div>End game</div>,
}));

const params = Promise.resolve({ code: "abcdef" });
const room = {
  isViewerHost: true,
  members: [
    { player: { image: null, name: "Alex" }, isHost: true, userId: "user" },
    { player: { image: null, name: "Blair" }, isHost: false, userId: "friend" },
    { player: { image: null, name: "Casey" }, isHost: false, userId: "away" },
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
  mocks.leave.mockResolvedValue(null);
  mocks.useConvexAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
  });
  mocks.useAction.mockReturnValue(mocks.submit);
  mocks.useMutation.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "rooms:leave") return mocks.leave;
    if (name === "rooms:endRoom") return vi.fn();
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

afterEach(() => {
  vi.useRealTimers();
  clearCreatedRoom("ABCDEF");
});

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

  it("opens a room this client just created on game setup", async () => {
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode") return room;
      if (name === "games:getActive") return undefined;
      if (name === "games:listFinished") return [];
      if (name === "requests:listPending") return [];
      throw new Error(`Unexpected query: ${name}`);
    });
    markRoomCreated("ABCDEF");
    const view = await renderRoom();

    expect(screen.getByText("Game setup")).toBeVisible();

    // A later visit, before the game query resolves, is an ordinary one.
    view.unmount();
    await renderRoom();
    expect(screen.queryByText("Game setup")).not.toBeInTheDocument();
  });

  it("keeps the calendar skeleton while a created room's route loads", () => {
    const expected = render(<RoomSkeleton waiting />).container.innerHTML;
    const neutral = render(<RoomSkeleton />).container.innerHTML;

    expect(render(<RoomLoading />).container.innerHTML).toBe(neutral);
    markRoomCreated("ABCDEF");
    expect(render(<RoomLoading />).container.innerHTML).toBe(expected);
  });

  it("keeps showing the room while leaving it", async () => {
    let current = room;
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode") return current;
      if (name === "games:getActive")
        return { _id: "game", contextoGameId: 123 };
      if (name === "games:listFinished") return [];
      if (name === "requests:listPending") return [];
      throw new Error(`Unexpected query: ${name}`);
    });
    const user = userEvent.setup();
    const view = await renderRoom();

    await user.click(screen.getByRole("button", { name: "Room menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Leave room" }));
    expect(mocks.leave).toHaveBeenCalledWith({ roomId: "room" });
    expect(mocks.push).toHaveBeenCalledWith("/");

    // The mutation lands before the home route does.
    current = {
      ...room,
      members: room.members.filter((m) => m.userId !== "user"),
    };
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    expect(screen.getByText("ABCDEF")).toBeVisible();
    expect(screen.getByText("Alex")).toBeVisible();
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("copies the room code", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue(undefined);
    await renderRoom();

    await user.click(await screen.findByRole("button", { name: /^Copy/ }));
    expect(writeText).toHaveBeenCalledWith("ABCDEF");
  });

  it("labels each member's online status", async () => {
    await renderRoom();

    const status = (name: string) =>
      within(screen.getByText(name).closest("li")!).getByRole("img");
    expect(status("Alex")).toHaveAccessibleName("Online");
    expect(status("Blair")).toHaveAccessibleName("Online");
    expect(status("Casey")).toHaveAccessibleName("Offline");
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

  it("retries joining after a failed join and a new guest sign-in", async () => {
    let isAuthenticated = true;
    let viewerUserId: string | null = "old-guest";
    let joined = false;
    mocks.useConvexAuth.mockImplementation(() => ({
      isAuthenticated,
      isLoading: false,
    }));
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode")
        return {
          ...room,
          viewerUserId,
          members: joined ? [{ ...room.members[0], userId: "new-guest" }] : [],
        };
      if (name === "games:getActive" || name === "games:listFinished")
        return undefined;
      if (name === "requests:listPending") return [];
      throw new Error(`Unexpected query: ${name}`);
    });
    mocks.join.mockRejectedValueOnce(new Error("Session expired"));
    mocks.join.mockResolvedValue(null);
    mocks.signIn.mockResolvedValue(null);
    const view = await renderRoom();
    await screen.findByText("Could not join room. Try again.");

    isAuthenticated = false;
    viewerUserId = null;
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Join as guest" }));

    isAuthenticated = true;
    viewerUserId = "new-guest";
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    await waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("Could not join room. Try again."),
    ).not.toBeInTheDocument();

    joined = true;
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    expect(screen.getByRole("heading", { name: "ABCDEF" })).toBeVisible();
  });

  it("retries joining when the same viewer signs out and back in", async () => {
    let isAuthenticated = true;
    let viewerUserId: string | null = "guest";
    mocks.useConvexAuth.mockImplementation(() => ({
      isAuthenticated,
      isLoading: false,
    }));
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode")
        return { ...room, viewerUserId, members: [] };
      if (name === "games:getActive" || name === "games:listFinished")
        return undefined;
      throw new Error(`Unexpected query: ${name}`);
    });
    mocks.join.mockRejectedValueOnce(new Error("Network down"));
    mocks.join.mockImplementation(() => new Promise(() => {}));
    const view = await renderRoom();
    await screen.findByText("Could not join room. Try again.");

    isAuthenticated = false;
    viewerUserId = null;
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    isAuthenticated = true;
    viewerUserId = "guest";
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );

    await waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    expect(
      screen.queryByText("Could not join room. Try again."),
    ).not.toBeInTheDocument();
  });

  it("ignores a previous viewer's join failure while the new join is pending", async () => {
    let viewerUserId = "old-guest";
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (value: null) => void;
    mocks.join
      .mockImplementationOnce(
        () => new Promise((_, reject) => (rejectOld = reject)),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => (resolveNew = resolve)),
      );
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode")
        return { ...room, viewerUserId, members: [] };
      if (name === "games:getActive" || name === "games:listFinished")
        return undefined;
      throw new Error(`Unexpected query: ${name}`);
    });
    const view = await renderRoom();
    expect(mocks.join).toHaveBeenCalledTimes(1);

    viewerUserId = "new-guest";
    view.rerender(
      <Suspense fallback={<p>Loading room</p>}>
        <RoomPage params={params} />
      </Suspense>,
    );
    await waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    await act(async () => rejectOld(new Error("Old session expired")));

    expect(
      screen.queryByText("Could not join room. Try again."),
    ).not.toBeInTheDocument();
    expect(reportClientError).not.toHaveBeenCalled();
    expect(mocks.join).toHaveBeenCalledTimes(2);
    await act(async () => resolveNew(null));
  });

  it("drops a previous Room's join failure when the code changes", async () => {
    mocks.join.mockImplementation(({ code }) =>
      code === "ABCDEF"
        ? Promise.reject(new Error("Session expired"))
        : new Promise(() => {}),
    );
    mocks.useQuery.mockImplementation((reference, args) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode")
        return {
          ...room,
          room: { ...room.room, code: args.code },
          members: [],
        };
      if (name === "games:getActive" || name === "games:listFinished")
        return undefined;
      throw new Error(`Unexpected query: ${name}`);
    });
    const view = await renderRoom();
    await screen.findByText("Could not join room. Try again.");

    const otherParams = Promise.resolve({ code: "ghijkl" });
    await act(async () => {
      view.rerender(
        <Suspense fallback={<p>Loading room</p>}>
          <RoomPage params={otherParams} />
        </Suspense>,
      );
    });

    expect(mocks.join).toHaveBeenLastCalledWith({ code: "GHIJKL" });
    expect(
      screen.queryByText("Could not join room. Try again."),
    ).not.toBeInTheDocument();
  });

  it("ignores a join that fails after the page unmounts", async () => {
    let rejectJoin!: (error: Error) => void;
    mocks.join.mockImplementation(
      () => new Promise((_, reject) => (rejectJoin = reject)),
    );
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode") return { ...room, members: [] };
      if (name === "games:getActive" || name === "games:listFinished")
        return undefined;
      throw new Error(`Unexpected query: ${name}`);
    });
    const view = await renderRoom();
    expect(mocks.join).toHaveBeenCalledTimes(1);

    view.unmount();
    await act(async () => rejectJoin(new Error("Room not found")));

    expect(reportClientError).not.toHaveBeenCalled();
  });

  it("stays in the Room without rejoining when leaving fails", async () => {
    mocks.leave.mockRejectedValue(new Error("Network down"));
    const user = userEvent.setup();
    await renderRoom();

    await user.click(screen.getByRole("button", { name: "Room menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Leave room" }));

    await waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(expect.any(Error), {
        userMessage: "Could not leave room.",
        context: "room.leave",
      }),
    );
    expect(screen.getByRole("heading", { name: "ABCDEF" })).toBeVisible();
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("waits for a stale session to sign out before joining", async () => {
    mocks.join.mockRejectedValue(new Error("Session expired"));
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "rooms:getByCode")
        return { ...room, viewerUserId: null, members: [] };
      if (name === "games:getActive" || name === "games:listFinished")
        return undefined;
      throw new Error(`Unexpected query: ${name}`);
    });
    await renderRoom();

    expect(mocks.join).not.toHaveBeenCalled();
    expect(reportClientError).not.toHaveBeenCalled();
    expect(screen.getByText("Session expired. Signing you out…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
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

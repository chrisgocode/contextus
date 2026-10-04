import { Suspense } from "react";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACHIEVEMENT_UNLOCK_DISPLAY_MS } from "@/app/_components/AchievementUnlockQueue";
import {
  clearCreatedRoom,
  markRoomCreated,
} from "@/app/(app)/r/[code]/_components/created-room";
import type {
  RoomEntry,
  RoomView,
} from "@/app/(app)/r/[code]/_components/room-entry";
import { RoomSkeleton } from "@/app/(app)/r/[code]/_components/RoomSkeleton";
import RoomLoading from "@/app/(app)/r/[code]/loading";
import RoomPage from "@/app/(app)/r/[code]/page";
import { act, render, screen, userEvent, waitFor, within } from "./test-utils";

const mocks = vi.hoisted(() => ({
  clipboardWrite: vi.fn(),
  endRoom: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  submit: vi.fn(),
  useAction: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
  useRoomEntry: vi.fn(),
}));

// Skip downloading react-day-picker; these tests don't render the calendar.
vi.mock("@/app/(app)/r/[code]/_components/calendar-loader", () => ({
  preloadCalendar: () => {},
}));
// Room entry is tested on its own; here each kind maps to a screen.
vi.mock("@/app/(app)/r/[code]/_components/room-entry", () => ({
  useRoomEntry: mocks.useRoomEntry,
}));
vi.mock("convex/react", () => ({
  useAction: mocks.useAction,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));
vi.mock("next/navigation", () => ({
  useParams: () => ({ code: "abcdef" }),
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
}));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));
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
const view = {
  data: room,
  activeGame: { _id: "game", contextoGameId: 123 },
  lastFinished: [],
} as unknown as RoomView;

function memberOf(roomView: RoomView = view) {
  return {
    kind: "member",
    view: roomView,
    leave: vi.fn().mockResolvedValue(true),
  } satisfies RoomEntry;
}

// What useRoomEntry returns. Change it, then rerender, to model an update.
let entry: RoomEntry;

const page = () => (
  <Suspense fallback={<p>Loading room</p>}>
    <RoomPage params={params} />
  </Suspense>
);

async function renderRoom() {
  let rendered!: ReturnType<typeof render>;
  await act(async () => {
    rendered = render(page());
  });
  return rendered;
}

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: mocks.clipboardWrite },
  });
  mocks.clipboardWrite.mockResolvedValue(undefined);
  mocks.endRoom.mockResolvedValue(null);
  entry = memberOf();
  mocks.useRoomEntry.mockImplementation(() => entry);
  mocks.useAction.mockReturnValue(mocks.submit);
  mocks.useMutation.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "rooms:endRoom") return mocks.endRoom;
    if (name.startsWith("requests:")) return vi.fn();
    throw new Error(`Unexpected mutation: ${name}`);
  });
  mocks.useQuery.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name.startsWith("requests:")) return undefined;
    throw new Error(`Unexpected query: ${name}`);
  });
});

afterEach(() => {
  vi.useRealTimers();
  clearCreatedRoom("ABCDEF");
});

describe("RoomPage", () => {
  it("enters the Room by its upper-case code", async () => {
    await renderRoom();
    expect(mocks.useRoomEntry).toHaveBeenCalledWith("ABCDEF");
  });

  it("shows winning guess unlocks after the active game disappears", async () => {
    let resolveSubmit!: (value: unknown) => void;
    mocks.submit.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSubmit = resolve;
        }),
    );
    const user = userEvent.setup();
    const rendered = await renderRoom();
    await user.type(screen.getByPlaceholderText("Type a word…"), "answer");
    await user.click(screen.getByRole("button", { name: "Guess" }));

    entry = memberOf({ ...view, activeGame: null });
    rendered.rerender(page());
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

  it("opens game setup when the Room has no game", async () => {
    entry = memberOf({ ...view, activeGame: null });
    await renderRoom();

    expect(screen.getByText("Game setup")).toBeVisible();
  });

  it("shows the calendar skeleton while a created Room loads or joins", async () => {
    const waiting = render(<RoomSkeleton waiting />).container.innerHTML;
    const neutral = render(<RoomSkeleton />).container.innerHTML;

    entry = { kind: "loading", waiting: true };
    const rendered = await renderRoom();
    expect(rendered.container.innerHTML).toBe(waiting);

    entry = { kind: "joining", waiting: false };
    rendered.rerender(page());
    expect(rendered.container.innerHTML).toBe(neutral);
  });

  it("keeps the calendar skeleton while a created room's route loads", () => {
    const expected = render(<RoomSkeleton waiting />).container.innerHTML;
    const neutral = render(<RoomSkeleton />).container.innerHTML;

    expect(render(<RoomLoading />).container.innerHTML).toBe(neutral);
    markRoomCreated("ABCDEF");
    expect(render(<RoomLoading />).container.innerHTML).toBe(expected);
  });

  it("goes home and leaves, showing the Room while leaving", async () => {
    const member = memberOf();
    entry = member;
    const user = userEvent.setup();
    const rendered = await renderRoom();

    await user.click(screen.getByRole("button", { name: "Room menu" }));
    await user.click(screen.getByRole("menuitem", { name: "Leave room" }));
    expect(member.leave).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith("/");

    entry = { kind: "leaving", view };
    rendered.rerender(page());
    expect(screen.getByRole("heading", { name: "ABCDEF" })).toBeVisible();
    expect(screen.getByText("Alex")).toBeVisible();
  });

  it("ends the Room and goes home", async () => {
    const user = userEvent.setup();
    await renderRoom();

    await user.click(screen.getByRole("button", { name: "Room menu" }));
    await user.click(screen.getByRole("menuitem", { name: "End room" }));

    expect(mocks.endRoom).toHaveBeenCalledWith({ roomId: "room" });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/"));
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

  it("lets a signed-out visitor join as a guest or sign in", async () => {
    const joinAsGuest = vi.fn().mockResolvedValue(undefined);
    entry = { kind: "needsAuth", code: "ABCDEF", joinAsGuest };
    const user = userEvent.setup();
    await renderRoom();

    await user.click(
      await screen.findByRole("button", { name: "Join as guest" }),
    );
    expect(joinAsGuest).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(mocks.push).toHaveBeenCalledWith("/signin?redirectTo=%2Fr%2FABCDEF");
  });

  it("tells a viewer whose session expired", async () => {
    entry = { kind: "sessionExpired" };
    await renderRoom();

    expect(screen.getByText("Session expired. Signing you out…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  it("offers account creation at the Guest limit", async () => {
    entry = { kind: "guestLimit" };
    const user = userEvent.setup();
    await renderRoom();

    expect(
      screen.getByText("Create an account to host or join more active rooms."),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(mocks.push).toHaveBeenCalledWith("/signin?redirectTo=%2Fr%2FABCDEF");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.push).toHaveBeenLastCalledWith("/");
  });

  it("shows why joining failed", async () => {
    entry = { kind: "joinFailed", message: "Could not join room. Try again." };
    const user = userEvent.setup();
    await renderRoom();

    expect(screen.getByText("Could not join room. Try again.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Retry" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(mocks.push).toHaveBeenCalledWith("/");
  });

  it("handles missing and ended rooms", async () => {
    entry = { kind: "notFound" };
    const user = userEvent.setup();
    const rendered = await renderRoom();
    expect(await screen.findByText("Room not found.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Home" }));
    expect(mocks.push).toHaveBeenCalledWith("/");

    entry = { kind: "ended" };
    rendered.rerender(page());
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
  });
});

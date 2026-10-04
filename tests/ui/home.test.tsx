import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { renderToString } from "react-dom/server";
import Home from "@/app/(app)/(home)/page";
import {
  clearCreatedRoom,
  isCreatedRoom,
} from "@/app/(app)/r/[code]/_components/created-room";
import { render, screen, userEvent, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  playAgain: vi.fn(),
  push: vi.fn(),
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

// Skip downloading react-day-picker; these tests don't render the calendar.
vi.mock("@/app/(app)/r/[code]/_components/calendar-loader", () => ({
  preloadCalendar: () => {},
}));
vi.mock("convex/react", () => ({
  useConvexAuth: mocks.useConvexAuth,
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));
// Room entry is tested on its own; here each outcome maps to a screen.
vi.mock("@/app/(app)/r/[code]/_components/room-entry", () => ({
  useCreateRoom: () => mocks.createRoom,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useConvexAuth.mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
  });
  mocks.useQuery.mockReturnValue(undefined);
  mocks.useMutation.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "rooms:playAgain") return mocks.playAgain;
    throw new Error(`Unexpected mutation: ${name}`);
  });
});

describe("Home", () => {
  it("server-renders Create and Join before auth resolves", () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });

    const html = renderToString(<Home />);

    expect(html).toContain("Start a new room");
    expect(html).toContain("Join a room");
  });

  it("opens a room it creates on game setup", async () => {
    mocks.createRoom.mockResolvedValue({ kind: "created", code: "ABCDEF" });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Create room" }));

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/ABCDEF"));
    expect(isCreatedRoom("ABCDEF")).toBe(true);
    clearCreatedRoom("ABCDEF");
  });

  it("opens the room page to join, even before auth resolves", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    const user = userEvent.setup();
    render(<Home />);

    await user.type(screen.getByPlaceholderText("ABCDEF"), " ab12 ");
    await user.click(screen.getByRole("button", { name: "Join" }));

    expect(mocks.push).toHaveBeenCalledWith("/r/AB12");
  });

  it("offers account creation when a guest reaches the room limit", async () => {
    mocks.createRoom.mockResolvedValue({ kind: "guestLimit" });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(
      await screen.findByText(
        "Create an account to host or join more active rooms.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(mocks.push).toHaveBeenCalledWith("/signin?redirectTo=%2F");
  });

  it("shows why creating a room failed", async () => {
    mocks.createRoom.mockResolvedValue({
      kind: "error",
      message: "Too many requests. Wait a moment and try again.",
    });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(
      await screen.findByText(
        "Too many requests. Wait a moment and try again.",
      ),
    ).toBeVisible();
  });

  it("links a signed-out visitor to sign in", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin",
    );
  });

  it("links a guest to sign in", () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocks.useQuery.mockImplementation((reference) =>
      getFunctionName(reference) === "users:getUser"
        ? { isAnonymous: true, username: "guest" }
        : undefined,
    );

    render(<Home />);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/signin",
    );
  });

  it("hides sign in while auth is loading", () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });

    render(<Home />);

    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });

  it("shows a registered user's rooms and starts a recent group again", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "users:getUser")
        return { isAnonymous: false, username: "alex" };
      if (name === "rooms:listMine") return [{ _id: "room", code: "ACTIVE" }];
      if (name === "rooms:listRecentGroups")
        return [
          {
            lastActivityAt: Date.UTC(2026, 0, 2),
            members: [
              { player: { image: null, name: "Alex" }, userId: "alex" },
              { player: { image: null, name: "Blair" }, userId: "blair" },
            ],
            roomId: "old-room",
          },
        ];
      throw new Error(`Unexpected query: ${name}`);
    });
    mocks.playAgain.mockResolvedValue({ code: "NEWONE" });
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByText("Your active rooms")).toBeVisible();
    expect(screen.getByText("Alex + Blair")).toBeVisible();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(mocks.push).toHaveBeenCalledWith("/user/alex");

    await user.click(screen.getByRole("button", { name: "Play Contextus" }));
    expect(mocks.playAgain).toHaveBeenCalledWith({ roomId: "old-room" });
    expect(mocks.push).toHaveBeenCalledWith("/r/NEWONE");
  });
});

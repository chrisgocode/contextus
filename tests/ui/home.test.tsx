import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { renderToString } from "react-dom/server";
import Home from "@/app/(app)/(home)/page";
import {
  clearCreatedRoom,
  isCreatedRoom,
} from "@/app/(app)/r/[code]/_components/created-room";
import { MAX_INVITES_AT_ONCE } from "@/convex/lib/inviteLimits";
import {
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
  within,
} from "./test-utils";

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  playAgain: vi.fn(),
  sendFriendRequest: vi.fn(),
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
    if (name === "friends:sendRequest") return mocks.sendFriendRequest;
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
      if (name === "friends:overview")
        return { friends: [], incoming: [], outgoing: [] };
      if (name === "friends:suggestions") return [];
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

  it("adds a suggested Friend in one tap", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "users:getUser")
        return { isAnonymous: false, username: "alex" };
      if (name === "rooms:listMine" || name === "rooms:listRecentGroups")
        return [];
      if (name === "friends:overview")
        return { friends: [], incoming: [], outgoing: [] };
      if (name === "friends:suggestions")
        return [{ id: "blair", name: "Blair", image: null, username: "blair" }];
      throw new Error(`Unexpected query: ${name}`);
    });
    mocks.sendFriendRequest.mockResolvedValue({ status: "requested" });
    const user = userEvent.setup();
    render(<Home />);

    expect(screen.getByRole("link", { name: "Blair" })).toHaveAttribute(
      "href",
      "/user/blair",
    );
    await user.click(screen.getByRole("button", { name: "Add friend" }));

    expect(mocks.sendFriendRequest).toHaveBeenCalledWith({
      userId: "blair",
      via: "suggestion",
    });
  });

  describe("Play with friends", () => {
    type Kind = "online" | "inRoom" | "offline";
    function signInWithFriends(
      friends: { id: string; name: string; status?: Kind }[],
    ) {
      mocks.useConvexAuth.mockReturnValue({
        isAuthenticated: true,
        isLoading: false,
      });
      mocks.useQuery.mockImplementation((reference) => {
        const name = getFunctionName(reference);
        if (name === "users:getUser")
          return { isAnonymous: false, username: "alex" };
        if (name === "rooms:listMine" || name === "rooms:listRecentGroups")
          return [];
        if (name === "friends:suggestions") return [];
        if (name === "friends:overview")
          return {
            friends: friends.map(({ status = "online", ...friend }) => ({
              ...friend,
              image: null,
              username: friend.id,
              status: { kind: status },
            })),
            incoming: [],
            outgoing: [],
            invites: [],
            room: null,
          };
        throw new Error(`Unexpected query: ${name}`);
      });
    }

    async function openRoster() {
      const user = userEvent.setup();
      render(<Home />);
      await user.click(
        screen.getByRole("button", { name: "Play with friends" }),
      );
      return user;
    }

    const friend = (name: RegExp) =>
      screen.getByRole("button", { name, pressed: false }) as HTMLElement;

    it("creates a room with the picked Friends, named on the button, and opens it on game setup", async () => {
      signInWithFriends([
        { id: "blair", name: "Blair" },
        { id: "casey", name: "Casey" },
        { id: "drew", name: "Drew" },
      ]);
      mocks.createRoom.mockResolvedValue({ kind: "created", code: "FRIEND" });
      const user = await openRoster();

      expect(
        screen.getByRole("group", { name: "Play with friends" }),
      ).toHaveFocus();
      expect(
        screen.getByRole("button", { name: "Pick friends to invite" }),
      ).toBeDisabled();
      await user.click(friend(/^Blair/));
      expect(
        screen.getByRole("button", { name: "Create room with Blair" }),
      ).toBeEnabled();
      await user.click(friend(/^Casey/));
      await user.click(friend(/^Drew/));
      await user.click(
        screen.getByRole("button", {
          name: "Create room with Blair, Casey and 1 more",
        }),
      );

      expect(mocks.createRoom).toHaveBeenCalledWith(["blair", "casey", "drew"]);
      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/FRIEND"));
      expect(isCreatedRoom("FRIEND")).toBe(true);
      clearCreatedRoom("FRIEND");
    });

    it("unpicks a Friend tapped again", async () => {
      signInWithFriends([{ id: "blair", name: "Blair" }]);
      const user = await openRoster();

      await user.click(friend(/^Blair/));
      await user.click(
        screen.getByRole("button", { name: /^Blair/, pressed: true }),
      );

      expect(
        screen.getByRole("button", { name: "Pick friends to invite" }),
      ).toBeDisabled();
    });

    it("lists Friends who are around under Online and the rest under Offline", async () => {
      signInWithFriends([
        { id: "sam", name: "Sam", status: "inRoom" },
        { id: "riley", name: "Riley", status: "offline" },
      ]);
      await openRoster();

      expect(
        within(screen.getByRole("region", { name: "Online" })).getByRole(
          "button",
          { name: "Sam In a Room" },
        ),
      ).toBeVisible();
      expect(
        within(screen.getByRole("region", { name: "Offline" })).getByRole(
          "button",
          { name: "Riley Offline" },
        ),
      ).toBeVisible();
    });

    it("finds Friends by name or username", async () => {
      signInWithFriends([
        { id: "blair", name: "Blair" },
        { id: "riley", name: "Riley", status: "offline" },
      ]);
      const user = await openRoster();
      const search = screen.getByRole("searchbox", { name: "Find a friend" });

      await user.type(search, "RIL");
      expect(friend(/^Riley/)).toBeVisible();
      expect(screen.queryByRole("button", { name: /^Blair/ })).toBeNull();

      await user.click(screen.getByRole("button", { name: "Clear search" }));
      expect(search).toHaveValue("");
      expect(search).toHaveFocus();
      expect(friend(/^Blair/)).toBeVisible();

      await user.type(search, "zz");
      expect(screen.getByText("No friend matches “zz”.")).toBeVisible();
    });

    it("keeps a pick made before searching", async () => {
      signInWithFriends([
        { id: "blair", name: "Blair" },
        { id: "casey", name: "Casey" },
      ]);
      const user = await openRoster();

      await user.click(friend(/^Blair/));
      await user.type(
        screen.getByRole("searchbox", { name: "Find a friend" }),
        "cas",
      );
      await user.click(friend(/^Casey/));

      expect(
        screen.getByRole("button", {
          name: "Create room with Blair and Casey",
        }),
      ).toBeEnabled();
    });

    it("narrows the list to picked Friends and back", async () => {
      signInWithFriends([
        { id: "blair", name: "Blair" },
        { id: "casey", name: "Casey" },
      ]);
      const user = await openRoster();

      await user.click(friend(/^Casey/));
      await user.click(screen.getByRole("button", { name: "1 picked" }));
      expect(screen.queryByRole("button", { name: /^Blair/ })).toBeNull();
      expect(
        screen.getByRole("button", { name: /^Casey/, pressed: true }),
      ).toBeVisible();

      await user.click(screen.getByRole("button", { name: "1 picked" }));
      expect(friend(/^Blair/)).toBeVisible();
    });

    it("moves between Friends with the arrow keys", async () => {
      signInWithFriends([
        { id: "blair", name: "Blair" },
        { id: "casey", name: "Casey" },
      ]);
      const user = await openRoster();

      await user.click(
        screen.getByRole("searchbox", { name: "Find a friend" }),
      );
      await user.keyboard("{ArrowDown}");
      expect(friend(/^Blair/)).toHaveFocus();
      await user.keyboard("{ArrowDown}");
      expect(friend(/^Casey/)).toHaveFocus();
      await user.keyboard(" ");

      expect(
        screen.getByRole("button", { name: "Create room with Casey" }),
      ).toBeEnabled();
    });

    it("shows why the room couldn't be created", async () => {
      signInWithFriends([{ id: "blair", name: "Blair" }]);
      mocks.createRoom.mockResolvedValue({
        kind: "error",
        message: "Someone you picked is no longer your friend.",
      });
      const user = await openRoster();

      await user.click(friend(/^Blair/));
      await user.click(
        screen.getByRole("button", { name: "Create room with Blair" }),
      );

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Someone you picked is no longer your friend.",
      );
      expect(mocks.push).not.toHaveBeenCalled();
    });

    it("stops picking at the most Friends one Room can invite at once", async () => {
      signInWithFriends(
        Array.from({ length: MAX_INVITES_AT_ONCE + 1 }, (_, i) => ({
          id: `friend${i}`,
          name: `Friend ${i}`,
        })),
      );
      await openRoster();

      const tokens = screen.getAllByRole("button", { pressed: false });
      for (const token of tokens.slice(0, MAX_INVITES_AT_ONCE)) {
        fireEvent.click(token);
      }

      expect(tokens.at(-1)).toBeDisabled();
      expect(
        screen.getByText(
          `You can invite up to ${MAX_INVITES_AT_ONCE} friends at once.`,
        ),
      ).toBeVisible();
      fireEvent.click(tokens[0]);
      expect(tokens.at(-1)).toBeEnabled();
    });

    it("points to the Friends panel when there are no Friends", async () => {
      signInWithFriends([]);
      await openRoster();

      expect(
        screen.getByText(
          "Add Friends from the Friends panel to invite them here.",
        ),
      ).toBeVisible();
    });

    it("goes back to the Create room buttons on Cancel", async () => {
      signInWithFriends([{ id: "blair", name: "Blair" }]);
      const user = await openRoster();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      expect(
        screen.getByRole("button", { name: "Play with friends" }),
      ).toHaveFocus();
      expect(screen.getByRole("button", { name: "Create room" })).toBeVisible();
    });

    it("isn't offered to Guests", () => {
      render(<Home />);

      expect(
        screen.queryByRole("button", { name: "Play with friends" }),
      ).toBeNull();
    });
  });
});

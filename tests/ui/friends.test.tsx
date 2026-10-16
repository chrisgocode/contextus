import { getFunctionName } from "convex/server";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FriendButton } from "@/app/_components/FriendButton";
import { FriendsPanel } from "@/app/_components/FriendsPanel";
import type { Id } from "@/convex/_generated/dataModel";
import { appError } from "@/convex/lib/errors";
import { render, screen, userEvent, waitFor, within } from "./test-utils";

const mocks = vi.hoisted(() => ({
  answerInvite: vi.fn(),
  answerRequest: vi.fn(),
  cancelRequest: vi.fn(),
  invite: vi.fn(),
  push: vi.fn(),
  sendRequest: vi.fn(),
  setAppearOffline: vi.fn(),
  sendRequestByUsername: vi.fn(),
  unfriend: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name === "friends:answerInvite") return mocks.answerInvite;
    if (name === "friends:answerRequest") return mocks.answerRequest;
    if (name === "friends:invite") return mocks.invite;
    if (name === "friends:cancelRequest") return mocks.cancelRequest;
    if (name === "friends:sendRequest") return mocks.sendRequest;
    if (name === "users:setAppearOffline") return mocks.setAppearOffline;
    if (name === "friends:sendRequestByUsername")
      return mocks.sendRequestByUsername;
    if (name === "friends:unfriend") return mocks.unfriend;
    throw new Error(`Unexpected mutation: ${name}`);
  },
  useQuery: (
    reference: Parameters<typeof getFunctionName>[0],
    args: unknown,
  ) =>
    getFunctionName(reference) === "users:getUser"
      ? { player: { name: "Alice" }, image: null }
      : mocks.useQuery(reference, args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));

const bob = "bob" as Id<"users">;
const roomId = "room" as Id<"rooms">;

function player(id: string, name: string) {
  return { id, name, image: null, username: id, isGuest: false, exists: true };
}

type FriendStatus =
  | { kind: "online" }
  | { kind: "inRoom"; code: string }
  | { kind: "offline" };

function friend(id: string, name: string, status: FriendStatus) {
  return { ...player(id, name), status };
}

function invite(id: string, roomCode: string, sender: string) {
  return {
    _id: id,
    roomCode,
    expiresAt: 0,
    sender: player(sender, sender),
  };
}

function overview(
  overrides: Partial<{
    friends: ReturnType<typeof friend>[];
    incoming: ReturnType<typeof player>[];
    outgoing: ReturnType<typeof player>[];
    moreIncoming: boolean;
    appearOffline: boolean;
    invites: ReturnType<typeof invite>[];
    room: { invited: string[]; members: string[] } | null;
  }> = {},
) {
  return {
    friends: [],
    incoming: [],
    outgoing: [],
    moreIncoming: false,
    appearOffline: false,
    invites: [],
    room: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("FriendButton", () => {
  it("sends a Friend request to the profile's user", async () => {
    mocks.useQuery.mockReturnValue("none");
    mocks.sendRequest.mockResolvedValue({ status: "requested" });
    const user = userEvent.setup();
    render(<FriendButton userId={bob} />);

    await user.click(screen.getByRole("button", { name: "Add friend" }));

    expect(mocks.sendRequest).toHaveBeenCalledWith({ userId: bob });
  });

  it("accepts the profile user's Friend request", async () => {
    mocks.useQuery.mockReturnValue("incoming");
    mocks.answerRequest.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<FriendButton userId={bob} />);

    await user.click(screen.getByRole("button", { name: "Accept request" }));

    expect(mocks.answerRequest).toHaveBeenCalledWith({
      userId: bob,
      answer: "accept",
    });
  });

  it("shows why a send failed and lets you retry", async () => {
    mocks.useQuery.mockReturnValue("none");
    mocks.sendRequest
      .mockRejectedValueOnce(appError("friendLimitOther"))
      .mockResolvedValueOnce({ status: "requested" });
    const user = userEvent.setup();
    render(<FriendButton userId={bob} />);
    const button = screen.getByRole("button", { name: "Add friend" });

    await user.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    expect(toast.error).toHaveBeenCalledWith(
      "They have reached the maximum number of friends.",
    );
    await user.click(button);

    expect(mocks.sendRequest).toHaveBeenCalledTimes(2);
  });

  it.each(["requested", "friends"])(
    "only shows the %s state",
    (relationship) => {
      mocks.useQuery.mockReturnValue(relationship);
      render(<FriendButton userId={bob} />);

      expect(screen.getByRole("button")).toBeDisabled();
    },
  );

  it("renders nothing when the two can't be Friends", () => {
    mocks.useQuery.mockReturnValue(null);
    const { container } = render(<FriendButton userId={bob} />);

    expect(container).toBeEmptyDOMElement();
  });
});

describe("FriendsPanel", () => {
  async function openPanel(props: { roomId?: Id<"rooms"> } = {}) {
    const user = userEvent.setup();
    render(<FriendsPanel {...props} />);
    await user.click(screen.getByRole("button", { name: /^Friends/ }));
    return { user, panel: await screen.findByRole("dialog") };
  }

  it("counts incoming requests on its button, and shows when there are more", () => {
    mocks.useQuery.mockReturnValue(
      overview({
        incoming: Array.from({ length: 100 }, (_, i) =>
          player(`u${i}`, `User ${i}`),
        ),
        moreIncoming: true,
      }),
    );
    render(<FriendsPanel />);

    const button = screen.getByRole("button", {
      name: "Friends, 100+ friend requests",
    });
    expect(within(button).getByText("100+")).toBeInTheDocument();
  });

  it("accepts and declines incoming requests and cancels outgoing ones", async () => {
    mocks.useQuery.mockReturnValue(
      overview({
        incoming: [player("carol", "Carol"), player("dave", "Dave")],
        outgoing: [player("erin", "Erin")],
      }),
    );
    mocks.answerRequest.mockResolvedValue(null);
    mocks.cancelRequest.mockResolvedValue(null);
    const { user, panel } = await openPanel();
    const requests = within(panel).getByRole("region", { name: "Requests" });
    const [carol, dave] = within(requests).getAllByRole("listitem");
    const sent = within(panel).getByRole("region", { name: "Sent" });

    await user.click(within(carol).getByRole("button", { name: "Accept" }));
    await user.click(within(dave).getByRole("button", { name: "Decline" }));
    await user.click(within(sent).getByRole("button", { name: "Cancel" }));

    expect(mocks.answerRequest.mock.calls).toEqual([
      [{ userId: "carol", answer: "accept" }],
      [{ userId: "dave", answer: "decline" }],
    ]);
    expect(mocks.cancelRequest).toHaveBeenCalledWith({ userId: "erin" });
  });

  it("re-enables its buttons after a failed answer so you can retry", async () => {
    mocks.useQuery.mockReturnValue(
      overview({ incoming: [player("carol", "Carol")] }),
    );
    mocks.answerRequest
      .mockRejectedValueOnce(appError("friendLimit"))
      .mockResolvedValueOnce(null);
    const { user, panel } = await openPanel();
    const accept = within(panel).getByRole("button", { name: "Accept" });

    await user.click(accept);
    await waitFor(() => expect(accept).toBeEnabled());
    expect(toast.error).toHaveBeenCalledWith(
      "You have reached the maximum number of friends.",
    );
    await user.click(accept);

    expect(mocks.answerRequest).toHaveBeenCalledTimes(2);
  });

  it("shows each Friend's status, with Join for a Friend In a Room", async () => {
    mocks.useQuery.mockReturnValue(
      overview({
        friends: [
          friend("carol", "Carol", { kind: "inRoom", code: "ABCD" }),
          friend("dave", "Dave", { kind: "online" }),
          friend("erin", "Erin", { kind: "offline" }),
        ],
      }),
    );
    const { panel } = await openPanel();
    const friends = within(panel).getByRole("region", { name: "Friends" });
    const [carol, dave, erin] = within(friends).getAllByRole("listitem");

    expect(carol).toHaveTextContent("In a Room");
    expect(within(carol).getByRole("link", { name: "Join" })).toHaveAttribute(
      "href",
      "/r/ABCD",
    );
    expect(dave).toHaveTextContent("Online");
    expect(erin).toHaveTextContent("Offline");
    for (const row of [dave, erin]) {
      expect(
        within(row).queryByRole("link", { name: "Join" }),
      ).not.toBeInTheDocument();
    }
  });

  it("shows your own status last and switches Appear offline", async () => {
    mocks.useQuery.mockReturnValue(
      overview({
        appearOffline: true,
        friends: [friend("dave", "Dave", { kind: "online" })],
      }),
    );
    mocks.setAppearOffline.mockResolvedValue(null);
    const { user, panel } = await openPanel();
    const regions = within(panel).getAllByRole("region");
    const yours = regions[regions.length - 1];
    expect(yours).toHaveAccessibleName("Your status");
    expect(yours).toHaveTextContent("Alice");
    const online = within(yours).getByRole("radio", { name: "Online" });
    const appearOffline = within(yours).getByRole("radio", {
      name: "Appear offline",
    });
    expect(appearOffline).toBeChecked();

    await user.click(online);

    expect(mocks.setAppearOffline).toHaveBeenCalledWith({
      appearOffline: false,
    });
    await waitFor(() => expect(online).toBeEnabled());
  });

  it("puts the choice back when saving Appear offline fails", async () => {
    mocks.useQuery.mockReturnValue(overview());
    mocks.setAppearOffline.mockRejectedValue(new Error("timed out"));
    const { user, panel } = await openPanel();
    const yours = within(panel).getByRole("region", { name: "Your status" });
    const online = within(yours).getByRole("radio", { name: "Online" });

    await user.click(
      within(yours).getByRole("radio", { name: "Appear offline" }),
    );

    await waitFor(() => expect(online).toBeEnabled());
    expect(online).toBeChecked();
    expect(yours).toHaveTextContent("Friends see you online.");
  });

  it("sends a Friend request by username and says when it's sent", async () => {
    mocks.useQuery.mockReturnValue(overview());
    mocks.sendRequestByUsername.mockResolvedValue({ status: "requested" });
    const { user, panel } = await openPanel();
    const username = within(panel).getByRole("textbox", { name: "Username" });

    await user.type(username, "Bobby");
    await user.click(within(panel).getByRole("button", { name: "Add friend" }));

    expect(mocks.sendRequestByUsername).toHaveBeenCalledWith({
      username: "Bobby",
    });
    expect(await within(panel).findByRole("status")).toHaveTextContent(
      "Friend request sent.",
    );
    expect(username).toHaveValue("");
  });

  it("shows an unknown username inline, keeping what was typed", async () => {
    mocks.useQuery.mockReturnValue(overview());
    mocks.sendRequestByUsername.mockRejectedValue(appError("userNotFound"));
    const { user, panel } = await openPanel();
    const username = within(panel).getByRole("textbox", { name: "Username" });

    await user.type(username, "nobody{Enter}");

    expect(await within(panel).findByRole("alert")).toHaveTextContent(
      "No player has that username.",
    );
    expect(username).toHaveValue("nobody");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("unfriends from a Friend's menu", async () => {
    mocks.useQuery.mockReturnValue(
      overview({
        friends: [friend("carol", "Carol", { kind: "online" })],
      }),
    );
    mocks.unfriend.mockResolvedValue(null);
    const { user, panel } = await openPanel();

    await user.click(
      within(panel).getByRole("button", { name: "Options for Carol" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: "Unfriend" }));

    expect(mocks.unfriend).toHaveBeenCalledWith({ userId: "carol" });
  });

  it("tells a Guest that Friends need an account", async () => {
    mocks.useQuery.mockReturnValue(null);
    const { panel } = await openPanel();

    expect(
      within(panel).getByText(/Friends need an account/),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("link", { name: "Sign in" }),
    ).toHaveAttribute("href", "/signin");
  });

  it("invites Friends into the Room, and shows who is invited or already in", async () => {
    mocks.useQuery.mockReturnValue(
      overview({
        friends: [
          friend("carol", "Carol", { kind: "online" }),
          friend("dave", "Dave", { kind: "offline" }),
          friend("erin", "Erin", { kind: "inRoom", code: "ABCDEF" }),
        ],
        room: { invited: ["dave"], members: ["erin"] },
      }),
    );
    mocks.invite.mockResolvedValue(null);
    const { user, panel } = await openPanel({ roomId });
    const [carol, dave, erin] = within(
      within(panel).getByRole("region", { name: "Friends" }),
    ).getAllByRole("listitem");

    await user.click(within(carol).getByRole("button", { name: "Invite" }));
    expect(within(dave).getByText("Invited")).toBeInTheDocument();
    await user.click(within(dave).getByRole("button", { name: "Resend" }));

    expect(within(erin).getByText("In this room")).toBeInTheDocument();
    expect(
      within(erin).queryByRole("button", { name: /Invite|Resend/ }),
    ).toBeNull();
    expect(within(erin).queryByRole("link", { name: "Join" })).toBeNull();
    expect(mocks.useQuery).toHaveBeenCalledWith(expect.anything(), { roomId });
    expect(mocks.invite.mock.calls).toEqual([
      [{ roomId, userId: "carol" }],
      [{ roomId, userId: "dave" }],
    ]);
  });

  it("offers no Invite buttons outside a Room", async () => {
    mocks.useQuery.mockReturnValue(
      overview({ friends: [friend("carol", "Carol", { kind: "online" })] }),
    );
    const { panel } = await openPanel();

    expect(within(panel).queryByRole("button", { name: "Invite" })).toBeNull();
  });

  it("joins an open Invite's Room and declines another", async () => {
    mocks.useQuery.mockReturnValue(
      overview({
        invites: [
          invite("i1", "ABCDEF", "Carol"),
          invite("i2", "GHIJKL", "Dave"),
        ],
      }),
    );
    mocks.answerInvite.mockImplementation(async ({ answer }) =>
      answer === "join" ? { code: "ABCDEF" } : null,
    );
    const { user, panel } = await openPanel();
    const invites = within(panel).getByRole("region", { name: "Invites" });
    expect(within(invites).getByText("Room GHIJKL")).toBeInTheDocument();

    await user.click(
      within(invites).getByRole("button", { name: "Join room ABCDEF" }),
    );
    const [, dave] = within(invites).getAllByRole("listitem");
    await user.click(within(dave).getByRole("button", { name: "Decline" }));

    expect(mocks.answerInvite.mock.calls).toEqual([
      [{ inviteId: "i1", answer: "join" }],
      [{ inviteId: "i2", answer: "decline" }],
    ]);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/r/ABCDEF");
  });

  it("explains an Invite that ended before it was answered", async () => {
    mocks.useQuery.mockReturnValue(
      overview({ invites: [invite("i1", "ABCDEF", "Carol")] }),
    );
    mocks.answerInvite.mockRejectedValue(appError("inviteNotFound"));
    const { user, panel } = await openPanel();

    await user.click(
      within(panel).getByRole("button", { name: "Join room ABCDEF" }),
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("This invite has ended."),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

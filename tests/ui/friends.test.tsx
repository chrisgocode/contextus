import { getFunctionName } from "convex/server";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FriendButton } from "@/app/(app)/user/[username]/_components/FriendButton";
import { FriendsPanel } from "@/app/_components/FriendsPanel";
import type { Id } from "@/convex/_generated/dataModel";
import { appError } from "@/convex/lib/errors";
import { render, screen, userEvent, waitFor, within } from "./test-utils";

const mocks = vi.hoisted(() => ({
  answerRequest: vi.fn(),
  cancelRequest: vi.fn(),
  sendRequest: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: (reference: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(reference);
    if (name === "friends:answerRequest") return mocks.answerRequest;
    if (name === "friends:cancelRequest") return mocks.cancelRequest;
    if (name === "friends:sendRequest") return mocks.sendRequest;
    throw new Error(`Unexpected mutation: ${name}`);
  },
  useQuery: mocks.useQuery,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));

const bob = "bob" as Id<"users">;

function player(id: string, name: string) {
  return { id, name, image: null, username: id, isGuest: false, exists: true };
}

function overview(
  overrides: Partial<{
    friends: ReturnType<typeof player>[];
    incoming: ReturnType<typeof player>[];
    outgoing: ReturnType<typeof player>[];
    moreIncoming: boolean;
  }> = {},
) {
  return {
    friends: [],
    incoming: [],
    outgoing: [],
    moreIncoming: false,
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
  async function openPanel() {
    const user = userEvent.setup();
    render(<FriendsPanel />);
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
});

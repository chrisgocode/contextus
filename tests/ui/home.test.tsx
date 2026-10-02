import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { renderToString } from "react-dom/server";
import Home from "@/app/(app)/(home)/page";
import { reportClientError } from "@/lib/report-error";
import { render, screen, userEvent, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  join: vi.fn(),
  playAgain: vi.fn(),
  push: vi.fn(),
  signIn: vi.fn(),
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
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocks.signIn }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useConvexAuth.mockReturnValue({
    isAuthenticated: false,
    isLoading: false,
  });
  mocks.useQuery.mockReturnValue(undefined);
  mocks.useMutation.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "rooms:create") return mocks.create;
    if (name === "rooms:join") return mocks.join;
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

  it("waits for auth to load before creating a signed-in user's room", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    mocks.create.mockResolvedValue({ code: "ABCDEF" });
    const user = userEvent.setup();
    const { rerender } = render(<Home />);

    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    rerender(<Home />);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/ABCDEF"));
    expect(mocks.signIn).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({});
  });

  it("creates a new guest's room only once the client is signed in", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    mocks.signIn.mockResolvedValue({ signingIn: true });
    mocks.create.mockResolvedValue({ code: "ABCDEF" });
    const user = userEvent.setup();
    const { rerender } = render(<Home />);

    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(mocks.signIn).not.toHaveBeenCalled();

    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: false,
    });
    rerender(<Home />);
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("anonymous"));

    // signIn resolves before the Convex client sends the new token.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.create).not.toHaveBeenCalled();

    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: false,
      isLoading: true,
    });
    rerender(<Home />);
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    rerender(<Home />);

    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/ABCDEF"));
    expect(mocks.create).toHaveBeenCalledTimes(1);
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
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocks.create.mockRejectedValue({ data: "Guest room limit reached" });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Create room" }));
    expect(
      await screen.findByText(
        "Create an account to host or join more active rooms.",
      ),
    ).toBeVisible();
    expect(reportClientError).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(mocks.push).toHaveBeenCalledWith("/signin");
  });

  it("tells a user who creates rooms too fast to wait", async () => {
    mocks.useConvexAuth.mockReturnValue({
      isAuthenticated: true,
      isLoading: false,
    });
    mocks.create.mockRejectedValue({
      data: "Too many requests. Wait a moment and try again.",
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

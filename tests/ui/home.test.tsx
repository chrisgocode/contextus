// @vitest-environment jsdom

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

  it("creates a room as a guest", async () => {
    mocks.create.mockResolvedValue({ code: "ABCDEF" });
    const user = userEvent.setup();
    render(<Home />);

    await user.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(mocks.signIn).toHaveBeenCalledWith("anonymous"));
    expect(mocks.create).toHaveBeenCalledWith({});
    expect(mocks.push).toHaveBeenCalledWith("/r/ABCDEF");
  });

  it.each([
    { isAuthenticated: true, signsIn: false },
    { isAuthenticated: false, signsIn: true },
  ])(
    "waits for auth before creating a room (authenticated: $isAuthenticated)",
    async ({ isAuthenticated, signsIn }) => {
      mocks.useConvexAuth.mockReturnValue({
        isAuthenticated: false,
        isLoading: true,
      });
      mocks.create.mockResolvedValue({ code: "ABCDEF" });
      const user = userEvent.setup();
      const { rerender } = render(<Home />);

      await user.click(screen.getByRole("button", { name: "Create room" }));
      expect(mocks.signIn).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();

      mocks.useConvexAuth.mockReturnValue({
        isAuthenticated,
        isLoading: false,
      });
      rerender(<Home />);

      await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/ABCDEF"));
      expect(mocks.signIn).toHaveBeenCalledTimes(signsIn ? 1 : 0);
      expect(mocks.create).toHaveBeenCalledWith({});
    },
  );

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
    await user.click(screen.getByRole("button", { name: "Profile" }));
    expect(mocks.push).toHaveBeenCalledWith("/user/alex");

    await user.click(screen.getByRole("button", { name: "Play Contextus" }));
    expect(mocks.playAgain).toHaveBeenCalledWith({ roomId: "old-room" });
    expect(mocks.push).toHaveBeenCalledWith("/r/NEWONE");
  });
});

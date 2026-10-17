import type { ReactElement } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteToasts } from "@/app/_components/InviteToasts";
import { render, screen, userEvent, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  answerInvite: vi.fn(),
  push: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useMutation: () => mocks.answerInvite,
  useQuery: mocks.useQuery,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("sonner", () => ({
  toast: { custom: vi.fn(), dismiss: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));

function invite(expiresAt = Date.now() + 60_000) {
  return {
    _id: "i1",
    roomCode: "ABCDEF",
    expiresAt,
    sender: {
      id: "carol",
      name: "Carol",
      image: null,
      username: "carol",
      isGuest: false,
      exists: true,
    },
  };
}

// Renders what the last toast.custom call would put in the corner.
function renderLastToast() {
  const [content] = vi.mocked(toast.custom).mock.lastCall!;
  render(content("invite-i1") as ReactElement);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("InviteToasts", () => {
  it("shows one toast per open Invite until it expires, again only when it is re-sent", async () => {
    const expiresAt = Date.now() + 60_000;
    mocks.useQuery.mockReturnValue([invite(expiresAt)]);
    const { rerender } = render(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(1));
    const options = vi.mocked(toast.custom).mock.lastCall![1];
    expect(options?.id).toBe("invite-i1");
    expect(options?.duration).toBeGreaterThan(55_000);
    expect(options?.duration).toBeLessThanOrEqual(60_000);

    mocks.useQuery.mockReturnValue([invite(expiresAt)]);
    rerender(<InviteToasts />);
    mocks.useQuery.mockReturnValue([invite(expiresAt + 1)]);
    rerender(<InviteToasts />);

    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(2));
  });

  it("removes the toast once its Invite ends", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    const { rerender } = render(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalled());

    mocks.useQuery.mockReturnValue([]);
    rerender(<InviteToasts />);

    await waitFor(() =>
      expect(toast.dismiss).toHaveBeenCalledWith("invite-i1"),
    );
  });

  it("removes its toasts when it unmounts, as on a page outside the app", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    const { unmount } = render(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalled());

    unmount();

    await waitFor(() =>
      expect(toast.dismiss).toHaveBeenCalledWith("invite-i1"),
    );
  });

  it("removes its toasts once the viewer is signed out", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    const { rerender } = render(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalled());

    mocks.useQuery.mockReturnValue(undefined);
    rerender(<InviteToasts />);

    await waitFor(() =>
      expect(toast.dismiss).toHaveBeenCalledWith("invite-i1"),
    );
    mocks.useQuery.mockReturnValue([invite()]);
    rerender(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalledTimes(2));
  });

  it("joins the Room from the toast", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    mocks.answerInvite.mockResolvedValue({ code: "ABCDEF" });
    render(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalled());
    renderLastToast();

    expect(
      screen.getByText("Carol invited you to room ABCDEF"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Join room ABCDEF" }),
    );

    expect(mocks.answerInvite).toHaveBeenCalledWith({
      inviteId: "i1",
      answer: "join",
    });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/ABCDEF"));
  });

  it("dismissing the toast doesn't decline the Invite", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    render(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalled());
    renderLastToast();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(toast.dismiss).toHaveBeenCalledWith("invite-i1");
    expect(mocks.answerInvite).not.toHaveBeenCalled();
  });
});

import { getFunctionName } from "convex/server";
import { StrictMode, type ReactElement } from "react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InviteToasts } from "@/app/_components/InviteToasts";
import { act, render, screen, userEvent, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  answerInvite: vi.fn(),
  push: vi.fn(),
  useQuery: vi.fn(),
  pathname: "/",
  viewer: "alice",
  authenticated: true,
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: false,
  }),
  useMutation: () => mocks.answerInvite,
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) =>
    getFunctionName(ref) === "users:getUser"
      ? { _id: mocks.viewer }
      : mocks.useQuery(ref, args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  usePathname: () => mocks.pathname,
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
  vi.resetAllMocks();
  mocks.pathname = "/";
  mocks.viewer = "alice";
  mocks.authenticated = true;
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

  it("does not deliver a queued toast after unmount", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    const { unmount } = render(<InviteToasts />);
    unmount();
    await act(async () => {});
    expect(toast.custom).not.toHaveBeenCalled();
  });

  it("does not replay an expired deadline when its query arrives late", async () => {
    mocks.useQuery.mockReturnValue([invite(Date.now() - 1)]);
    render(<InviteToasts />);
    await act(async () => {});
    expect(toast.custom).not.toHaveBeenCalled();
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

  it("dismisses at the deadline without replaying a late query, and renews once", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const deadline = Date.now() + 5000;
      mocks.useQuery.mockReturnValue([invite(deadline)]);
      const { rerender } = render(<InviteToasts />);
      await act(async () => {});
      expect(toast.custom).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTime(5000));
      expect(toast.dismiss).toHaveBeenCalledWith("invite-i1");
      mocks.useQuery.mockReturnValue([invite(deadline)]);
      rerender(<InviteToasts />);
      await act(async () => {});
      expect(toast.custom).toHaveBeenCalledTimes(1);
      mocks.useQuery.mockReturnValue([invite(deadline + 5000)]);
      rerender(<InviteToasts />);
      await act(async () => {});
      expect(toast.custom).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows only one toast during Strict Mode effect replay", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    render(
      <StrictMode>
        <InviteToasts />
      </StrictMode>,
    );
    await act(async () => {});
    expect(toast.custom).toHaveBeenCalledTimes(1);
  });

  it("removes toasts on sign-out even if the old query remains available", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    const { rerender } = render(<InviteToasts />);
    await act(async () => {});
    mocks.authenticated = false;
    rerender(<InviteToasts />);
    await act(async () => {});
    expect(toast.dismiss).toHaveBeenCalledWith("invite-i1");
    expect(toast.custom).toHaveBeenCalledTimes(1);
  });

  it.each(["viewer", "sign-out", "room", "profile", "return"])(
    "ignores a pending join after changing %s",
    async (change) => {
      mocks.useQuery.mockReturnValue([invite()]);
      const pending = Promise.withResolvers<{ code: string }>();
      mocks.answerInvite.mockReturnValue(pending.promise);
      const { rerender } = render(<InviteToasts />);
      await act(async () => {});
      renderLastToast();
      await userEvent.click(
        screen.getByRole("button", { name: "Join room ABCDEF" }),
      );
      if (change === "viewer") mocks.viewer = "bob";
      else if (change === "sign-out") mocks.authenticated = false;
      else mocks.pathname = change === "profile" ? "/user/bob" : "/r/OTHERX";
      rerender(<InviteToasts />);
      if (change === "return") {
        mocks.pathname = "/";
        rerender(<InviteToasts />);
      }
      await act(async () => pending.resolve({ code: "ABCDEF" }));
      expect(mocks.push).not.toHaveBeenCalled();
    },
  );

  it("lets a toast delivered on the previous route join from the current route", async () => {
    mocks.useQuery.mockReturnValue([invite()]);
    mocks.answerInvite.mockResolvedValue({ code: "ABCDEF" });
    const page = render(<InviteToasts />);
    await act(async () => {});
    renderLastToast();
    mocks.pathname = "/user/bob";
    page.rerender(<InviteToasts />);
    await userEvent.click(
      screen.getByRole("button", { name: "Join room ABCDEF" }),
    );
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/ABCDEF"));
    expect(toast.custom).toHaveBeenCalledTimes(1);
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
    const { rerender } = render(<InviteToasts />);
    await waitFor(() => expect(toast.custom).toHaveBeenCalled());
    renderLastToast();

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    rerender(<InviteToasts />);
    await act(async () => {});
    expect(toast.custom).toHaveBeenCalledTimes(1);

    expect(toast.dismiss).toHaveBeenCalledWith("invite-i1");
    expect(mocks.answerInvite).not.toHaveBeenCalled();
  });
});

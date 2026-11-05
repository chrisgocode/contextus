import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { PostHogIdentity } from "@/components/PostHogIdentity";

const analytics = vi.hoisted(() => ({
  identify: vi.fn(),
  reset: vi.fn(),
  userState: "anonymous",
  get_property: (name: string) =>
    name === "$user_state" ? analytics.userState : undefined,
  auth: { isAuthenticated: true, isLoading: false },
  ready: Promise.resolve(),
  user: { _id: "guest-1", isAnonymous: true },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => analytics.auth,
  useQuery: () => analytics.user,
}));
vi.mock("@/lib/posthog-client", () => ({
  get posthogReady() {
    return analytics.ready.then(() => analytics);
  },
}));

it("identifies Guests and accounts by Convex ID, then resets on sign-out", async () => {
  analytics.identify.mockClear();
  analytics.reset.mockClear();
  analytics.auth.isAuthenticated = true;
  analytics.user = { _id: "guest-1", isAnonymous: true };
  analytics.userState = "anonymous";
  const { rerender } = render(<PostHogIdentity />);
  await waitFor(() =>
    expect(analytics.identify).toHaveBeenCalledWith("guest-1", {
      is_guest: true,
    }),
  );

  analytics.user = { _id: "account-2", isAnonymous: false };
  rerender(<PostHogIdentity />);
  await waitFor(() =>
    expect(analytics.identify).toHaveBeenCalledWith("account-2", {
      is_guest: false,
    }),
  );
  expect(analytics.reset).not.toHaveBeenCalled();

  analytics.userState = "identified";
  analytics.auth.isAuthenticated = false;
  rerender(<PostHogIdentity />);
  await waitFor(() => expect(analytics.reset).toHaveBeenCalledOnce());
});

it("resets an identity persisted from an earlier page load when signed out", async () => {
  analytics.reset.mockClear();
  analytics.auth.isAuthenticated = false;
  analytics.userState = "identified";
  render(<PostHogIdentity />);
  await waitFor(() => expect(analytics.reset).toHaveBeenCalledOnce());
});

it("keeps an anonymous visitor's distinct ID when signed out", async () => {
  analytics.reset.mockClear();
  analytics.auth.isAuthenticated = false;
  analytics.userState = "anonymous";
  render(<PostHogIdentity />);
  await Promise.resolve();
  await Promise.resolve();
  expect(analytics.reset).not.toHaveBeenCalled();
});

beforeEach(() => {
  analytics.identify.mockClear();
  analytics.reset.mockClear();
  analytics.auth = { isAuthenticated: true, isLoading: false };
  analytics.user = { _id: "guest-1", isAnonymous: true };
  analytics.userState = "anonymous";
  analytics.ready = Promise.resolve();
});

it("does not reset a newly signed-in identity when readiness was delayed", async () => {
  let ready!: () => void;
  analytics.ready = new Promise<void>((resolve) => {
    ready = resolve;
  });
  analytics.auth.isAuthenticated = false;
  analytics.userState = "identified";
  const { rerender } = render(<PostHogIdentity />);
  analytics.auth.isAuthenticated = true;
  rerender(<PostHogIdentity />);
  await act(async () => {
    ready();
  });
  expect(analytics.reset).not.toHaveBeenCalled();
  expect(analytics.identify).toHaveBeenCalledExactlyOnceWith("guest-1", {
    is_guest: true,
  });
});

it.each(["sign-out", "account", "loading"])(
  "discards a delayed Guest identify after %s",
  async (next) => {
    let ready!: () => void;
    analytics.ready = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const { rerender } = render(<PostHogIdentity />);
    if (next === "sign-out") analytics.auth.isAuthenticated = false;
    if (next === "account")
      analytics.user = { _id: "account-2", isAnonymous: false };
    if (next === "loading") analytics.auth.isLoading = true;
    rerender(<PostHogIdentity />);
    await act(async () => {
      ready();
    });
    if (next === "account") {
      expect(analytics.identify).toHaveBeenCalledExactlyOnceWith("account-2", {
        is_guest: false,
      });
    } else {
      expect(analytics.identify).not.toHaveBeenCalled();
    }
  },
);

it.each([true, false])(
  "cancels delayed identity work on unmount (authenticated: %s)",
  async (authenticated) => {
    let ready!: () => void;
    analytics.ready = new Promise<void>((resolve) => {
      ready = resolve;
    });
    analytics.auth.isAuthenticated = authenticated;
    analytics.userState = "identified";
    const { unmount } = render(<PostHogIdentity />);
    unmount();
    await act(async () => {
      ready();
    });
    expect(analytics.reset).not.toHaveBeenCalled();
    expect(analytics.identify).not.toHaveBeenCalled();
  },
);

it("does not re-identify the same viewer on repeated query results", async () => {
  const { rerender } = render(<PostHogIdentity />);
  await waitFor(() => expect(analytics.identify).toHaveBeenCalledOnce());
  analytics.user = { _id: "guest-1", isAnonymous: true };
  rerender(<PostHogIdentity />);
  await act(async () => {});
  expect(analytics.identify).toHaveBeenCalledOnce();
});

it("cancels a delayed reset while authentication is loading", async () => {
  let ready!: () => void;
  analytics.ready = new Promise<void>((resolve) => {
    ready = resolve;
  });
  analytics.auth.isAuthenticated = false;
  analytics.userState = "identified";
  const { rerender } = render(<PostHogIdentity />);
  analytics.auth.isLoading = true;
  rerender(<PostHogIdentity />);
  await act(async () => {
    ready();
  });
  expect(analytics.reset).not.toHaveBeenCalled();
});

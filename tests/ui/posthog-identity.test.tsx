import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { PostHogIdentity } from "@/components/PostHogIdentity";

const analytics = vi.hoisted(() => ({
  identify: vi.fn(),
  reset: vi.fn(),
  auth: { isAuthenticated: true, isLoading: false },
  user: { _id: "guest-1", isAnonymous: true },
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => analytics.auth,
  useQuery: () => analytics.user,
}));
vi.mock("@/lib/posthog-client", () => ({
  posthogReady: Promise.resolve(analytics),
}));

it("identifies Guests and accounts by Convex ID, then resets on sign-out", async () => {
  analytics.identify.mockClear();
  analytics.reset.mockClear();
  analytics.auth.isAuthenticated = true;
  analytics.user = { _id: "guest-1", isAnonymous: true };
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

  analytics.auth.isAuthenticated = false;
  rerender(<PostHogIdentity />);
  await waitFor(() => expect(analytics.reset).toHaveBeenCalledOnce());
});

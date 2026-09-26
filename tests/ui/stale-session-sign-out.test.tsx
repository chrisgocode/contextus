import { beforeEach, describe, expect, it, vi } from "vitest";
import { StaleSessionSignOut } from "@/app/_components/StaleSessionSignOut";
import { render, waitFor } from "./test-utils";

const convex = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
}));
const auth = vi.hoisted(() => ({ signOut: vi.fn() }));

vi.mock("convex/react", () => convex);
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signOut: auth.signOut }),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  auth.signOut.mockResolvedValue(undefined);
});

describe("StaleSessionSignOut", () => {
  it("signs out a token the backend no longer accepts", async () => {
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
    convex.useQuery.mockReturnValue(null);

    render(<StaleSessionSignOut />);

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledTimes(1));
  });

  it("keeps a signed-in user and waits while loading", () => {
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
    convex.useQuery.mockReturnValue(undefined);
    const { rerender } = render(<StaleSessionSignOut />);

    convex.useQuery.mockReturnValue({ _id: "guest" });
    rerender(<StaleSessionSignOut />);

    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

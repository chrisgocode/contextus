import { beforeEach, describe, expect, it, vi } from "vitest";
import { TimeZoneSync } from "@/app/_components/TimeZoneSync";
import { render, waitFor } from "./test-utils";

const convex = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => convex);
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));

const deviceTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("TimeZoneSync", () => {
  it("records the device time zone for each signed-in user", async () => {
    const setTimeZone = vi.fn().mockResolvedValue(null);
    convex.useMutation.mockReturnValue(setTimeZone);
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
    convex.useQuery.mockReturnValue({ _id: "guest" });

    const { rerender } = render(<TimeZoneSync />);
    await waitFor(() =>
      expect(setTimeZone).toHaveBeenCalledWith({ timeZone: deviceTimeZone }),
    );

    convex.useQuery.mockReturnValue({ _id: "account" });
    rerender(<TimeZoneSync />);
    await waitFor(() => expect(setTimeZone).toHaveBeenCalledTimes(2));
  });

  it("waits for a signed-in user", () => {
    const setTimeZone = vi.fn();
    convex.useMutation.mockReturnValue(setTimeZone);
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: false });
    convex.useQuery.mockReturnValue(undefined);

    render(<TimeZoneSync />);

    expect(setTimeZone).not.toHaveBeenCalled();
  });
});

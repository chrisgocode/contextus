import { beforeEach, describe, expect, it, vi } from "vitest";
import { reportClientError } from "@/lib/report-error";
import { TimeZoneSync } from "@/app/_components/TimeZoneSync";
import { act, render, waitFor } from "./test-utils";

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
  it("ignores an old identity's failure after the user changes", async () => {
    let rejectOld!: (error: Error) => void;
    const setTimeZone = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectOld = reject;
          }),
      )
      .mockResolvedValue(null);
    convex.useMutation.mockReturnValue(setTimeZone);
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
    convex.useQuery.mockReturnValue({ _id: "old-user" });
    const { rerender } = render(<TimeZoneSync />);
    convex.useQuery.mockReturnValue({ _id: "new-user" });
    rerender(<TimeZoneSync />);
    await act(async () => rejectOld(new Error("old request")));
    expect(setTimeZone).toHaveBeenCalledTimes(2);
    expect(reportClientError).not.toHaveBeenCalled();
  });

  it.each(["sign-out", "unmount"])(
    "ignores late failures after %s",
    async (event) => {
      let reject!: (error: Error) => void;
      const setTimeZone = vi.fn(
        () =>
          new Promise((_, fail) => {
            reject = fail;
          }),
      );
      convex.useMutation.mockReturnValue(setTimeZone);
      convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
      convex.useQuery.mockReturnValue({ _id: "alice" });
      const view = render(<TimeZoneSync />);
      if (event === "unmount") view.unmount();
      else {
        // The cached user can outlive authentication while the query is skipped.
        convex.useConvexAuth.mockReturnValue({ isAuthenticated: false });
        view.rerender(<TimeZoneSync />);
      }
      await act(async () => reject(new Error("late failure")));
      expect(reportClientError).not.toHaveBeenCalled();
      expect(setTimeZone).toHaveBeenCalledTimes(1);
    },
  );

  it("reports a failure belonging to the current user", async () => {
    const error = new Error("current request");
    convex.useMutation.mockReturnValue(vi.fn().mockRejectedValue(error));
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
    convex.useQuery.mockReturnValue({ _id: "alice" });
    render(<TimeZoneSync />);
    await waitFor(() =>
      expect(reportClientError).toHaveBeenCalledWith(error, {
        userMessage: "Could not save your time zone.",
        context: "users.setTimeZone",
        showToast: false,
      }),
    );
  });

  it("syncs only once while the current identity stays the same", () => {
    const setTimeZone = vi.fn().mockResolvedValue(null);
    convex.useMutation.mockReturnValue(setTimeZone);
    convex.useConvexAuth.mockReturnValue({ isAuthenticated: true });
    convex.useQuery.mockReturnValue({ _id: "alice" });
    const { rerender } = render(<TimeZoneSync />);
    convex.useQuery.mockReturnValue({ _id: "alice", name: "New name" });
    rerender(<TimeZoneSync />);
    expect(setTimeZone).toHaveBeenCalledTimes(1);
  });

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

import { getFunctionName } from "convex/server";
import { beforeEach, expect, it, vi } from "vitest";
import Home from "@/app/(app)/(home)/page";
import { act, fireEvent, render, screen, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  signIn: vi.fn(),
  push: vi.fn(),
  viewer: "alice",
  authenticated: true,
  loading: false,
}));
vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => ({ signIn: mocks.signIn }),
}));
vi.mock("convex/react", () => ({
  useConvexAuth: () => ({
    isAuthenticated: mocks.authenticated,
    isLoading: mocks.loading,
  }),
  useMutation: () => mocks.create,
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => {
    if (getFunctionName(ref) === "users:getUser")
      return { _id: mocks.viewer, isAnonymous: true };
    return undefined;
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/app/(app)/r/[code]/_components/calendar-loader", () => ({
  preloadCalendar: () => {},
}));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.viewer = "alice";
  mocks.authenticated = true;
  mocks.loading = false;
});

it.each(["viewer", "sign-out", "auth-wait"])(
  "releases Home immediately on %s and permits a fresh create",
  async (change) => {
    const old = Promise.withResolvers<{ code: string }>();
    mocks.create
      .mockReturnValueOnce(old.promise)
      .mockResolvedValue({ code: "NEWONE" });
    const page = render(<Home />);
    if (change === "auth-wait") {
      mocks.loading = true;
      page.rerender(<Home />);
    }
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    if (change !== "auth-wait")
      await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
    else mocks.create.mockReset().mockResolvedValue({ code: "NEWONE" });
    mocks.loading = false;
    if (change === "viewer") mocks.viewer = "bob";
    else mocks.authenticated = false;
    page.rerender(<Home />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Create room" })).toBeEnabled(),
    );
    expect(screen.queryByText("Opening room")).toBeNull();
    mocks.authenticated = true;
    page.rerender(<Home />);
    fireEvent.click(screen.getByRole("button", { name: "Create room" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/r/NEWONE"));
    await act(async () => old.resolve({ code: "OLDONE" }));
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

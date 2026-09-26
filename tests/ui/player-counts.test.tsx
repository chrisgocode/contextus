// @vitest-environment jsdom

import { beforeEach, expect, test, vi } from "vitest";
import PlayerCountsPage from "@/app/(app)/admin/players/page";
import { render, screen } from "./test-utils";

const mocks = vi.hoisted(() => ({
  useConvexAuth: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: mocks.useConvexAuth,
  useQuery: mocks.useQuery,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useConvexAuth.mockReturnValue({
    isAuthenticated: true,
    isLoading: false,
  });
});

test("shows no count to a viewer denied by the backend", () => {
  mocks.useQuery.mockReturnValue(null);
  render(<PlayerCountsPage />);
  expect(screen.getByText("This page is private.")).toBeVisible();
  expect(screen.queryByLabelText("Live player count")).toBeNull();
});

test("shows the live count and sampled history to the owner", () => {
  const now = Date.UTC(2026, 8, 25, 12);
  mocks.useQuery.mockReturnValue({
    count: 3,
    capped: false,
    asOf: now,
    samples: [{ sampledAt: now - 60_000, count: 4 }],
  });
  render(<PlayerCountsPage />);
  expect(screen.getByLabelText("Live player count")).toHaveTextContent("3");
  expect(screen.getByLabelText("Player count history")).toHaveTextContent(
    "Peak 4",
  );
});

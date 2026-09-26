import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileClient } from "@/app/(app)/user/[username]/_components/ProfileClient";
import { reportClientError } from "@/lib/report-error";
import { render, screen, userEvent, waitFor } from "./test-utils";

const mocks = vi.hoisted(() => ({
  generateUploadUrl: vi.fn(),
  replace: vi.fn(),
  updateProfile: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));
vi.mock("@/lib/report-error", () => ({ reportClientError: vi.fn() }));
vi.mock("@/app/(app)/user/[username]/_components/ActivityGraph", () => ({
  ActivityGraph: () => <div>Activity graph</div>,
}));
vi.mock("@/app/(app)/user/[username]/_components/Achievements", () => ({
  Achievements: () => <div>Achievements</div>,
}));

const profile = {
  displayUsername: "Alex",
  email: "alex@example.com",
  image: null,
  isCurrentUser: true,
  name: "Alex Doe",
  player: { name: "Alex Doe", image: null },
  username: "alex",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useQuery.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "users:getByUsername") return profile;
    if (name === "users:getActivityGraph") return { days: [] };
    if (name === "achievements:listForProfile") return { achievements: [] };
    throw new Error(`Unexpected query: ${name}`);
  });
  mocks.useMutation.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "users:generateProfileImageUploadUrl")
      return mocks.generateUploadUrl;
    if (name === "users:updateProfile") return mocks.updateProfile;
    throw new Error(`Unexpected mutation: ${name}`);
  });
});

describe("ProfileClient", () => {
  it("renders missing and loading profiles without exposing edit controls", () => {
    mocks.useQuery.mockReturnValue(undefined);
    const { rerender } = render(<ProfileClient username="missing" />);
    expect(
      screen.queryByRole("button", { name: "Edit Profile" }),
    ).not.toBeInTheDocument();

    mocks.useQuery.mockReturnValue(null);
    rerender(<ProfileClient username="missing" />);
    expect(screen.getByText("Profile not found.")).toBeVisible();
  });

  it("validates required profile fields before saving", async () => {
    const user = userEvent.setup();
    render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));

    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Name is required.")).toBeVisible();

    await user.type(screen.getByLabelText("Name"), "Alex Doe");
    await user.clear(screen.getByLabelText("Username"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Username is required.")).toBeVisible();
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it("saves trimmed profile values and follows a changed username", async () => {
    mocks.updateProfile.mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "  Alex Smith  ");
    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "NewAlex");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mocks.updateProfile).toHaveBeenCalledWith({
        name: "Alex Smith",
        username: "NewAlex",
      }),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/user/newalex");
    expect(
      screen.queryByRole("button", { name: "Save" }),
    ).not.toBeInTheDocument();
  });

  it("keeps editing available when the save fails", async () => {
    mocks.updateProfile.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Could not save profile. Check your details and try again.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    expect(reportClientError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ context: "profile.update" }),
    );
  });

  it("shows a username conflict inline", async () => {
    mocks.updateProfile.mockRejectedValue({
      data: "Username is already taken.",
    });
    const user = userEvent.setup();
    render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Username is already taken.")).toBeVisible();
  });
});

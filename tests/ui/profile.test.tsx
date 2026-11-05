import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { appError } from "@/convex/lib/errors";
import { ProfileClient } from "@/app/(app)/user/[username]/_components/ProfileClient";
import UserProfilePage from "@/app/(app)/user/[username]/page";
import {
  act,
  fireEvent,
  render,
  screen,
  userEvent,
  waitFor,
} from "./test-utils";

const mocks = vi.hoisted(() => ({
  generateUploadUrl: vi.fn(),
  fetch: vi.fn(),
  createObjectURL: vi.fn(),
  revokeObjectURL: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
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
  notFound: mocks.notFound,
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/app/(app)/user/[username]/_components/ActivityGraph", () => ({
  ActivityGraph: () => <div>Activity graph</div>,
}));
vi.mock("@/app/(app)/user/[username]/_components/Achievements", () => ({
  Achievements: () => <div>Achievements</div>,
}));

const profile = {
  _id: "alex-user",
  displayUsername: "Alex",
  email: "alex@example.com",
  image: null,
  isCurrentUser: true,
  name: "Alex Doe",
  player: { name: "Alex Doe", image: null },
  username: "alex",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateProfile.mockReset().mockResolvedValue(null);
  mocks.generateUploadUrl
    .mockReset()
    .mockResolvedValue("https://upload.example/avatar");
  mocks.fetch.mockReset().mockResolvedValue({
    ok: true,
    json: async () => ({ storageId: "avatar-1" }),
  });
  mocks.createObjectURL.mockReset().mockReturnValue("blob:avatar-1");
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = mocks.createObjectURL;
      static revokeObjectURL = mocks.revokeObjectURL;
    },
  );
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
    if (name === "friends:sendRequest" || name === "friends:answerRequest")
      return vi.fn();
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
    expect(() => rerender(<ProfileClient username="missing" />)).toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(mocks.notFound).toHaveBeenCalled();
  });

  it("opens the avatar picker from the keyboard", async () => {
    const user = userEvent.setup();
    const { container } = render(<ProfileClient username="alex" />);
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');
    const pickFile = vi.fn();
    fileInput?.addEventListener("click", pickFile);

    screen.getByRole("button", { name: "Change profile picture" }).focus();
    await user.keyboard("{Enter}");

    expect(pickFile).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Name")).toBeVisible();
  });

  it("does not offer avatar changes on someone else's profile", () => {
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "users:getByUsername")
        return { ...profile, isCurrentUser: false };
      if (name === "users:getActivityGraph") return { days: [] };
      if (name === "achievements:listForProfile") return { achievements: [] };
      if (name === "friends:relationship") return "none";
      throw new Error(`Unexpected query: ${name}`);
    });
    render(<ProfileClient username="alex" />);
    expect(
      screen.queryByRole("button", { name: "Change profile picture" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add friend" })).toBeVisible();
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

  it("preserves the draft when opening the avatar picker during editing", async () => {
    const user = userEvent.setup();
    render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "My draft");
    await user.click(
      screen.getByRole("button", { name: "Change profile picture" }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("My draft");
  });

  it("ignores a save completion after navigating to another profile", async () => {
    const pending = deferred<null>();
    mocks.updateProfile.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    const { rerender } = render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "NewAlex");
    await user.click(screen.getByRole("button", { name: "Save" }));

    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "users:getByUsername")
        return {
          ...profile,
          _id: "bob-user",
          username: "bob",
          displayUsername: "Bob",
          name: "Bob",
          player: { name: "Bob", image: null },
        };
      if (name === "users:getActivityGraph") return { days: [] };
      if (name === "achievements:listForProfile") return { achievements: [] };
      throw new Error(name);
    });
    rerender(<ProfileClient username="bob" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Bob draft");
    await act(async () => pending.resolve(null));
    expect(screen.getByLabelText("Name")).toHaveValue("Bob draft");
    expect(mocks.replace).not.toHaveBeenCalledWith("/user/newalex");
  });

  it("does not repeat a no-avatar persistence request before controls commit", async () => {
    const pending = deferred<null>();
    mocks.updateProfile.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(mocks.updateProfile).toHaveBeenCalledExactlyOnceWith({
      name: "Alex Doe",
      username: "Alex",
    });
    expect(mocks.generateUploadUrl).not.toHaveBeenCalled();
    await act(async () => pending.resolve(null));
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    expect(screen.getByLabelText("Name")).toBeEnabled();
  });

  it("does not apply an obsolete error when the profile identity changes on the same route", async () => {
    const pending = deferred<null>();
    mocks.updateProfile.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    const { rerender } = render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    mocks.useQuery.mockImplementation((reference) => {
      const name = getFunctionName(reference);
      if (name === "users:getByUsername")
        return { ...profile, _id: "replacement-user", name: "Replacement" };
      if (name === "users:getActivityGraph") return { days: [] };
      if (name === "achievements:listForProfile") return { achievements: [] };
      throw new Error(name);
    });
    rerender(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await act(async () => pending.reject(appError("usernameTaken")));
    expect(screen.getByLabelText("Name")).toHaveValue("Replacement");
    expect(
      screen.queryByText("Username is already taken."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it.each([
    [
      "unsupported type",
      new File(["bad"], "avatar.svg", { type: "image/svg+xml" }),
      "Please choose a PNG, JPEG, WebP or GIF image.",
    ],
    [
      "oversized image",
      new File([new Uint8Array(1024 * 1024 + 1)], "avatar.png", {
        type: "image/png",
      }),
      "Profile image must be 1 MB or smaller.",
    ],
  ])(
    "clears the prior selection after an %s replacement",
    async (_label, invalidFile, error) => {
      const user = userEvent.setup({ applyAccept: false });
      const { container } = render(<ProfileClient username="alex" />);
      await user.click(
        screen.getByRole("button", { name: "Change profile picture" }),
      );
      const input =
        container.querySelector<HTMLInputElement>('input[type="file"]')!;
      await user.upload(
        input,
        new File(["image"], "avatar.png", { type: "image/png" }),
      );
      await user.upload(input, invalidFile);
      expect(screen.getByText(error)).toBeVisible();
      expect(mocks.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:avatar-1",
      );
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Edit Profile" }),
        ).toBeEnabled(),
      );
      expect(mocks.generateUploadUrl).not.toHaveBeenCalled();
      expect(mocks.updateProfile).toHaveBeenCalledExactlyOnceWith({
        name: "Alex Doe",
        username: "Alex",
      });
    },
  );

  it("releases replaced, cancelled and unmounted previews once and resets the draft", async () => {
    mocks.createObjectURL
      .mockReturnValueOnce("blob:first")
      .mockReturnValueOnce("blob:second")
      .mockReturnValueOnce("blob:third");
    const user = userEvent.setup();
    const { container, unmount } = render(<ProfileClient username="alex" />);
    await user.click(
      screen.getByRole("button", { name: "Change profile picture" }),
    );
    const input =
      container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(["image"], "avatar.png", { type: "image/png" });
    await user.upload(input, file);
    await user.upload(input, file);
    expect(mocks.revokeObjectURL.mock.calls).toEqual([["blob:first"]]);
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Discard me");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(mocks.revokeObjectURL.mock.calls).toEqual([
      ["blob:first"],
      ["blob:second"],
    ]);
    await user.click(
      screen.getByRole("button", { name: "Change profile picture" }),
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Alex Doe");
    expect(screen.getByLabelText("Username")).toHaveValue("Alex");
    await user.upload(input, file);
    unmount();
    expect(mocks.revokeObjectURL.mock.calls).toEqual([
      ["blob:first"],
      ["blob:second"],
      ["blob:third"],
    ]);
    expect(mocks.updateProfile).not.toHaveBeenCalled();
  });

  it.each(["upload-url", "network", "response"] as const)(
    "retains the draft and selected avatar after %s failure and retries",
    async (failure) => {
      if (failure === "upload-url")
        mocks.generateUploadUrl.mockRejectedValueOnce(new Error("offline"));
      if (failure === "network")
        mocks.fetch.mockRejectedValueOnce(new Error("offline"));
      if (failure === "response")
        mocks.fetch.mockResolvedValueOnce({ ok: false });
      const user = userEvent.setup();
      const { container } = render(<ProfileClient username="alex" />);
      await user.click(
        screen.getByRole("button", { name: "Change profile picture" }),
      );
      const file = new File(["image"], "avatar.png", { type: "image/png" });
      await user.upload(
        container.querySelector<HTMLInputElement>('input[type="file"]')!,
        file,
      );
      await user.clear(screen.getByLabelText("Name"));
      await user.type(screen.getByLabelText("Name"), "My draft");
      await user.click(screen.getByRole("button", { name: "Save" }));
      expect(
        await screen.findByText(
          "Could not save profile. Check your details and try again.",
        ),
      ).toBeVisible();
      expect(screen.getByLabelText("Name")).toHaveValue("My draft");
      expect(mocks.updateProfile).not.toHaveBeenCalled();
      expect(mocks.revokeObjectURL).not.toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Edit Profile" }),
        ).toBeEnabled(),
      );
      expect(mocks.updateProfile).toHaveBeenCalledExactlyOnceWith({
        name: "My draft",
        username: "Alex",
        avatarStorageId: "avatar-1",
      });
      expect(mocks.fetch).toHaveBeenLastCalledWith(
        "https://upload.example/avatar",
        {
          method: "POST",
          headers: { "Content-Type": "image/png" },
          body: file,
        },
      );
      expect(mocks.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:avatar-1",
      );
    },
  );

  it("preserves the draft after persistence fails following an upload, and uploads again on retry", async () => {
    mocks.updateProfile.mockRejectedValueOnce(appError("usernameTaken"));
    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ storageId: "first-upload" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ storageId: "retry-upload" }),
      });
    const user = userEvent.setup();
    const { container } = render(<ProfileClient username="alex" />);
    await user.click(
      screen.getByRole("button", { name: "Change profile picture" }),
    );
    await user.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(["image"], "avatar.png", { type: "image/png" }),
    );
    await user.clear(screen.getByLabelText("Username"));
    await user.type(screen.getByLabelText("Username"), "NewAlex");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Username is already taken.")).toBeVisible();
    expect(screen.getByLabelText("Username")).toHaveValue("NewAlex");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.revokeObjectURL).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(mocks.replace).toHaveBeenCalledWith("/user/newalex"),
    );
    expect(mocks.generateUploadUrl).toHaveBeenCalledTimes(2);
    expect(mocks.updateProfile.mock.calls).toEqual([
      [
        {
          name: "Alex Doe",
          username: "NewAlex",
          avatarStorageId: "first-upload",
        },
      ],
      [
        {
          name: "Alex Doe",
          username: "NewAlex",
          avatarStorageId: "retry-upload",
        },
      ],
    ]);
    expect(mocks.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
      "blob:avatar-1",
    );
  });

  it("claims repeated submissions and locks the draft throughout upload and persistence", async () => {
    const url = deferred<string>();
    const upload = deferred<{
      ok: boolean;
      json: () => Promise<{ storageId: string }>;
    }>();
    const persist = deferred<null>();
    mocks.generateUploadUrl.mockReturnValue(url.promise);
    mocks.fetch.mockReturnValue(upload.promise);
    mocks.updateProfile.mockReturnValue(persist.promise);
    const user = userEvent.setup();
    const { container } = render(<ProfileClient username="alex" />);
    await user.click(
      screen.getByRole("button", { name: "Change profile picture" }),
    );
    await user.upload(
      container.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(["image"], "avatar.png", { type: "image/png" }),
    );
    const form = screen.getByRole("button", { name: "Save" }).closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    expect(mocks.generateUploadUrl).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "Change profile picture" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Saving..." })).toBeDisabled();
    await act(async () => url.resolve("https://upload.example/avatar"));
    fireEvent.submit(form);
    expect(mocks.fetch).toHaveBeenCalledOnce();
    await act(async () =>
      upload.resolve({
        ok: true,
        json: async () => ({ storageId: "avatar-1" }),
      }),
    );
    fireEvent.submit(form);
    expect(mocks.updateProfile).toHaveBeenCalledOnce();
    await act(async () => persist.resolve(null));
    expect(screen.getByRole("button", { name: "Edit Profile" })).toBeEnabled();
    expect(mocks.updateProfile).toHaveBeenCalledOnce();
  });

  it.each(["upload-url", "upload", "body"] as const)(
    "stops obsolete %s completions after unmount before persistence",
    async (stage) => {
      const url = deferred<string>();
      const upload = deferred<{
        ok: boolean;
        json: () => Promise<{ storageId: string }>;
      }>();
      const body = deferred<{ storageId: string }>();
      mocks.generateUploadUrl.mockReturnValue(url.promise);
      mocks.fetch.mockReturnValue(upload.promise);
      const user = userEvent.setup();
      const { container, unmount } = render(<ProfileClient username="alex" />);
      await user.click(
        screen.getByRole("button", { name: "Change profile picture" }),
      );
      await user.upload(
        container.querySelector<HTMLInputElement>('input[type="file"]')!,
        new File(["image"], "avatar.png", { type: "image/png" }),
      );
      await user.click(screen.getByRole("button", { name: "Save" }));
      if (stage !== "upload-url")
        await act(async () => url.resolve("https://upload.example/avatar"));
      if (stage === "body")
        await act(async () =>
          upload.resolve({ ok: true, json: () => body.promise }),
        );
      unmount();
      await act(async () => {
        url.resolve("https://upload.example/avatar");
        upload.resolve({ ok: true, json: () => body.promise });
        body.resolve({ storageId: "obsolete" });
      });
      expect(mocks.updateProfile).not.toHaveBeenCalled();
      expect(mocks.replace).not.toHaveBeenCalled();
      expect(mocks.revokeObjectURL).toHaveBeenCalledExactlyOnceWith(
        "blob:avatar-1",
      );
      if (stage === "upload-url") expect(mocks.fetch).not.toHaveBeenCalled();
    },
  );

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
  });

  it("shows a username conflict inline", async () => {
    mocks.updateProfile.mockRejectedValue(appError("usernameTaken"));
    const user = userEvent.setup();
    render(<ProfileClient username="alex" />);
    await user.click(screen.getByRole("button", { name: "Edit Profile" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Username is already taken.")).toBeVisible();
  });
});

describe("UserProfilePage", () => {
  it("decodes the username route parameter", async () => {
    const page = await UserProfilePage({
      params: Promise.resolve({ username: "%C3%A9lodie" }),
    });

    expect(page.props).toEqual({ username: "élodie" });
  });

  it("renders not found for a malformed username escape", async () => {
    await expect(
      UserProfilePage({ params: Promise.resolve({ username: "%E0%A4%A" }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});

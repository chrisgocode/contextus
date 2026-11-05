import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearCreatedRoom,
  markRoomCreated,
} from "@/app/(app)/r/[code]/_components/created-room";
import { markFriendStatusJoin } from "@/app/(app)/r/[code]/_components/join-source";
import {
  type RoomEntryAuth,
  RoomEntryAuthContext,
  useCreateRoom,
  useRoomEntry,
} from "@/app/(app)/r/[code]/_components/room-entry";
import type { Id } from "@/convex/_generated/dataModel";
import { appError } from "@/convex/lib/errors";
import { captureException } from "@/lib/sentry-client";
import {
  act,
  render,
  screen,
  fireEvent,
  renderHook,
  waitFor,
} from "./test-utils";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  join: vi.fn(),
  leave: vi.fn(),
  useMutation: vi.fn(),
  useQuery: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useMutation: mocks.useMutation,
  useQuery: mocks.useQuery,
}));
vi.mock("@/lib/sentry-client", () => ({ captureException: vi.fn() }));

const member = {
  player: { image: null, name: "Alex" },
  isHost: true,
  userId: "user",
};
const room = {
  isViewerHost: true,
  members: [member],
  room: { _id: "room", code: "ABCDEF", status: "active" },
  viewerUserId: "user",
};
const game = { _id: "game", contextoGameId: 123 };

// What the Room and game queries return. Change a field, then rerender, to
// model a query update. A skipped query returns undefined, like Convex.
let queries: {
  getByCode: (args: { code: string }) => unknown;
  getActive: unknown;
  listFinished: unknown;
  viewer: unknown;
};

// The fake auth adapter: change a field, then rerender, to model an auth
// change.
let auth: RoomEntryAuth;

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <RoomEntryAuthContext value={() => ({ ...auth })}>
      {children}
    </RoomEntryAuthContext>
  );
}

function renderEntry(code = "ABCDEF") {
  return renderHook(({ code }) => useRoomEntry(code), {
    initialProps: { code },
    wrapper,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth = {
    isLoading: false,
    isAuthenticated: true,
    signIn: vi.fn().mockResolvedValue(null),
  };
  queries = {
    getByCode: () => room,
    getActive: game,
    listFinished: [],
    viewer: { _id: "user" },
  };
  mocks.join.mockResolvedValue(null);
  mocks.leave.mockResolvedValue(null);
  mocks.useMutation.mockImplementation((reference) => {
    const name = getFunctionName(reference);
    if (name === "rooms:create") return mocks.create;
    if (name === "rooms:join") return mocks.join;
    if (name === "rooms:leave") return mocks.leave;
    throw new Error(`Unexpected mutation: ${name}`);
  });
  mocks.useQuery.mockImplementation((reference, args) => {
    const name = getFunctionName(reference);
    if (args === "skip") return undefined;
    if (name === "users:getUser") return queries.viewer;
    if (name === "rooms:getByCode") return queries.getByCode(args);
    if (name === "games:getActive") return queries.getActive;
    if (name === "games:listFinished") return queries.listFinished;
    throw new Error(`Unexpected query: ${name}`);
  });
});

afterEach(() => clearCreatedRoom("ABCDEF"));

// Exercise coordination through rendered output and user actions.
function EntryScreen({ code }: { code: string }) {
  const entry = useRoomEntry(code);
  return (
    <>
      <output>{entry.kind}</output>
      {entry.kind === "member" && (
        <button onClick={() => void entry.leave()}>
          Leave {entry.view.data.room.code}
        </button>
      )}
    </>
  );
}

it("leaving one Room cannot freeze the next destination", async () => {
  mocks.leave.mockImplementation(() => new Promise(() => {}));
  queries.getByCode = ({ code }) => ({ ...room, room: { ...room.room, code } });
  const page = render(<EntryScreen code="ABCDEF" />, { wrapper });
  fireEvent.click(screen.getByText("Leave ABCDEF"));
  expect(screen.getByRole("status")).toHaveTextContent("leaving");
  page.rerender(<EntryScreen code="GHIJKL" />);
  expect(screen.getByText("Leave GHIJKL")).toBeVisible();
});

it("a join failure from an abandoned visit cannot poison a return to the same Room", async () => {
  let rejectOld!: (error: Error) => void;
  mocks.join
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    )
    .mockImplementation(() => new Promise(() => {}));
  queries.getByCode = ({ code }) => ({
    ...room,
    room: { ...room.room, code },
    members: [],
  });
  const page = render(<EntryScreen code="ABCDEF" />, { wrapper });
  page.rerender(<EntryScreen code="GHIJKL" />);
  page.rerender(<EntryScreen code="ABCDEF" />);
  await act(async () => rejectOld(new Error("old failure")));
  expect(screen.getByRole("status")).toHaveTextContent("joining");
  expect(captureException).not.toHaveBeenCalled();
});

function CreateScreen() {
  const create = useCreateRoom();
  return <button onClick={() => void create()}>Create</button>;
}

it("an abandoned anonymous sign-in cannot create a Room", async () => {
  let signedIn!: () => void;
  auth.isAuthenticated = false;
  auth.signIn = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        signedIn = resolve;
      }),
  );
  const page = render(<CreateScreen />, { wrapper });
  fireEvent.click(screen.getByText("Create"));
  await waitFor(() => expect(auth.signIn).toHaveBeenCalled());
  page.unmount();
  await act(async () => signedIn());
  expect(mocks.create).not.toHaveBeenCalled();
});

it("duplicate creation submits share the auth and mutation attempt", async () => {
  mocks.create.mockImplementation(() => new Promise(() => {}));
  render(<CreateScreen />, { wrapper });
  fireEvent.click(screen.getByText("Create"));
  fireEvent.click(screen.getByText("Create"));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
});

it("joins only after token readiness even if Room display data is ready", () => {
  auth.isLoading = true;
  queries.getByCode = () => ({ ...room, members: [] });
  const page = render(<EntryScreen code="ABCDEF" />, { wrapper });
  expect(mocks.join).not.toHaveBeenCalled();
  auth.isLoading = false;
  page.rerender(<EntryScreen code="ABCDEF" />);
  expect(mocks.join).toHaveBeenCalledWith({ code: "ABCDEF" });
});

it("an old leave failure cannot replace the next Room's leaving view", async () => {
  let rejectOld!: (error: Error) => void;
  mocks.leave
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectOld = reject;
        }),
    )
    .mockImplementation(() => new Promise(() => {}));
  queries.getByCode = ({ code }) => ({ ...room, room: { ...room.room, code } });
  const page = render(<EntryScreen code="ABCDEF" />, { wrapper });
  fireEvent.click(screen.getByText("Leave ABCDEF"));
  page.rerender(<EntryScreen code="GHIJKL" />);
  fireEvent.click(screen.getByText("Leave GHIJKL"));
  await act(async () => rejectOld(new Error("old failure")));
  expect(screen.getByRole("status")).toHaveTextContent("leaving");
});

it("an abandoned destination cannot keep its created-Room setup handoff", () => {
  markRoomCreated("ABCDEF");
  queries.getActive = undefined;
  const page = render(<EntryScreen code="GHIJKL" />, { wrapper });
  page.unmount();
  auth.isLoading = true;
  const next = renderEntry("ABCDEF");
  expect(next.result.current).toEqual({ kind: "loading", waiting: false });
});

it("a previous viewer's create failure is ignored after account changes", async () => {
  let rejectOld!: (error: Error) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectOld = reject;
      }),
  );
  const page = render(<CreateScreen />, { wrapper });
  fireEvent.click(screen.getByText("Create"));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  queries.viewer = { _id: "other-user" };
  page.rerender(<CreateScreen />);
  await act(async () => rejectOld(new Error("old failure")));
  expect(captureException).not.toHaveBeenCalled();
});

it("Friend attribution is used only by the first join attempt at a destination", async () => {
  let viewerUserId = "old-user";
  queries.getByCode = () => ({ ...room, viewerUserId, members: [] });
  mocks.join
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementation(() => new Promise(() => {}));
  markFriendStatusJoin("ABCDEF");
  const page = render(<EntryScreen code="ABCDEF" />, { wrapper });
  await waitFor(() =>
    expect(screen.getByRole("status")).toHaveTextContent("joinFailed"),
  );
  expect(mocks.join).toHaveBeenNthCalledWith(1, {
    code: "ABCDEF",
    via: "friend_status",
  });
  viewerUserId = "new-user";
  page.rerender(<EntryScreen code="ABCDEF" />);
  expect(mocks.join).toHaveBeenNthCalledWith(2, { code: "ABCDEF" });
});

it("signing out through auth loading invalidates an in-flight create", async () => {
  let rejectOld!: (error: Error) => void;
  mocks.create.mockImplementation(
    () =>
      new Promise((_, reject) => {
        rejectOld = reject;
      }),
  );
  const page = render(<CreateScreen />, { wrapper });
  fireEvent.click(screen.getByText("Create"));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledTimes(1));
  auth.isLoading = true;
  page.rerender(<CreateScreen />);
  auth.isLoading = false;
  auth.isAuthenticated = false;
  page.rerender(<CreateScreen />);
  await act(async () => rejectOld(new Error("old failure")));
  expect(captureException).not.toHaveBeenCalled();
});

describe("useRoomEntry", () => {
  it("is loading until auth and the Room load", () => {
    auth.isLoading = true;
    const { result, rerender } = renderEntry();
    expect(result.current).toEqual({ kind: "loading", waiting: false });

    auth.isLoading = false;
    queries.getByCode = () => undefined;
    rerender({ code: "ABCDEF" });
    expect(result.current).toEqual({ kind: "loading", waiting: false });
  });

  it("finds no Room for an unknown code", () => {
    queries.getByCode = () => null;
    const { result } = renderEntry();
    expect(result.current).toEqual({ kind: "notFound" });
  });

  it("says when the Room has ended", () => {
    queries.getByCode = () => ({
      ...room,
      room: { ...room.room, status: "ended" },
    });
    const { result } = renderEntry();
    expect(result.current).toEqual({ kind: "ended" });
  });

  it("asks a signed-out visitor to sign in, and signs in a Guest", async () => {
    auth.isAuthenticated = false;
    queries.getByCode = () => ({ ...room, viewerUserId: null, members: [] });
    const { result } = renderEntry();
    const entry = result.current;
    if (entry.kind !== "needsAuth") throw new Error(entry.kind);
    expect(entry.code).toBe("ABCDEF");

    await act(() => entry.joinAsGuest());
    expect(auth.signIn).toHaveBeenCalledWith("anonymous");
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("waits for a stale session to sign out before joining", () => {
    queries.getByCode = () => ({ ...room, viewerUserId: null, members: [] });
    const { result } = renderEntry();

    expect(result.current).toEqual({ kind: "sessionExpired" });
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("says a join came from a Friend's status when the friends panel's Join led here", () => {
    queries.getByCode = () => ({ ...room, members: [] });
    mocks.join.mockImplementation(() => new Promise(() => {}));
    markFriendStatusJoin("abcdef");

    renderEntry();

    expect(mocks.join).toHaveBeenCalledWith({
      code: "ABCDEF",
      via: "friend_status",
    });
  });

  it("joins an active Room the viewer isn't in, then is a member", async () => {
    let joined = false;
    queries.getByCode = () => ({ ...room, members: joined ? [member] : [] });
    mocks.join.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderEntry();

    expect(result.current).toEqual({ kind: "joining", waiting: false });
    expect(mocks.join).toHaveBeenCalledWith({ code: "ABCDEF" });

    joined = true;
    rerender({ code: "ABCDEF" });
    expect(result.current).toMatchObject({
      kind: "member",
      view: { data: { members: [member] }, activeGame: game },
    });
  });

  it("is at the Guest limit when joining hits it", async () => {
    mocks.join.mockRejectedValue(appError("guestRoomLimit"));
    queries.getByCode = () => ({ ...room, viewerUserId: "other" });
    const { result } = renderEntry();

    await waitFor(() => expect(result.current).toEqual({ kind: "guestLimit" }));
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports any other failed join", async () => {
    mocks.join.mockRejectedValue(new Error("Network down"));
    queries.getByCode = () => ({ ...room, members: [] });
    const { result } = renderEntry();

    await waitFor(() =>
      expect(result.current).toEqual({
        kind: "joinFailed",
        message: "Could not join room. Try again.",
      }),
    );
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { surface: "room.autojoin" },
    });
  });

  it("retries joining after a failed join and a new guest sign-in", async () => {
    let viewerUserId: string | null = "old-guest";
    queries.getByCode = () => ({ ...room, viewerUserId, members: [] });
    mocks.join.mockRejectedValueOnce(new Error("Session expired"));
    const { result, rerender } = renderEntry();
    await waitFor(() => expect(result.current.kind).toBe("joinFailed"));

    auth.isAuthenticated = false;
    viewerUserId = null;
    rerender({ code: "ABCDEF" });
    expect(result.current.kind).toBe("needsAuth");

    auth.isAuthenticated = true;
    viewerUserId = "new-guest";
    rerender({ code: "ABCDEF" });
    await waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    expect(result.current.kind).toBe("joining");
  });

  it("retries joining when the same viewer signs out and back in", async () => {
    let viewerUserId: string | null = "guest";
    queries.getByCode = () => ({ ...room, viewerUserId, members: [] });
    mocks.join.mockRejectedValueOnce(new Error("Network down"));
    mocks.join.mockImplementation(() => new Promise(() => {}));
    const { result, rerender } = renderEntry();
    await waitFor(() => expect(result.current.kind).toBe("joinFailed"));

    auth.isAuthenticated = false;
    viewerUserId = null;
    rerender({ code: "ABCDEF" });
    auth.isAuthenticated = true;
    viewerUserId = "guest";
    rerender({ code: "ABCDEF" });

    await waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    expect(result.current.kind).toBe("joining");
  });

  it("ignores a previous viewer's join failure while the new join is pending", async () => {
    let viewerUserId = "old-guest";
    let rejectOld!: (error: Error) => void;
    mocks.join
      .mockImplementationOnce(
        () => new Promise((_, reject) => (rejectOld = reject)),
      )
      .mockImplementationOnce(() => new Promise(() => {}));
    queries.getByCode = () => ({ ...room, viewerUserId, members: [] });
    const { result, rerender } = renderEntry();
    expect(mocks.join).toHaveBeenCalledTimes(1);

    viewerUserId = "new-guest";
    rerender({ code: "ABCDEF" });
    await waitFor(() => expect(mocks.join).toHaveBeenCalledTimes(2));
    await act(async () => rejectOld(new Error("Old session expired")));

    expect(result.current.kind).toBe("joining");
    expect(captureException).not.toHaveBeenCalled();
    expect(mocks.join).toHaveBeenCalledTimes(2);
  });

  it("drops a previous Room's join failure when the code changes", async () => {
    mocks.join.mockImplementation(({ code }) =>
      code === "ABCDEF"
        ? Promise.reject(new Error("Session expired"))
        : new Promise(() => {}),
    );
    queries.getByCode = ({ code }) => ({
      ...room,
      room: { ...room.room, code },
      members: [],
    });
    const { result, rerender } = renderEntry();
    await waitFor(() => expect(result.current.kind).toBe("joinFailed"));

    rerender({ code: "GHIJKL" });

    await waitFor(() =>
      expect(mocks.join).toHaveBeenLastCalledWith({ code: "GHIJKL" }),
    );
    expect(result.current.kind).toBe("joining");
  });

  it("ignores a join that fails after the page unmounts", async () => {
    let rejectJoin!: (error: Error) => void;
    mocks.join.mockImplementation(
      () => new Promise((_, reject) => (rejectJoin = reject)),
    );
    queries.getByCode = () => ({ ...room, members: [] });
    const { unmount } = renderEntry();
    expect(mocks.join).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => rejectJoin(new Error("Room not found")));

    expect(captureException).not.toHaveBeenCalled();
  });

  it("opens a Room this client just created on game setup", () => {
    queries.getActive = undefined;
    markRoomCreated("ABCDEF");
    auth.isLoading = true;
    const first = renderEntry();
    expect(first.result.current).toEqual({ kind: "loading", waiting: true });

    auth.isLoading = false;
    first.rerender({ code: "ABCDEF" });
    expect(first.result.current).toMatchObject({
      kind: "member",
      view: { activeGame: null },
    });

    // A later visit, before the game query resolves, is an ordinary one.
    first.unmount();
    const second = renderEntry();
    expect(second.result.current).toMatchObject({
      kind: "member",
      view: { activeGame: undefined },
    });
  });

  it("keeps the Room as it was while leaving, without rejoining", async () => {
    let current = room;
    queries.getByCode = () => current;
    const { result, rerender } = renderEntry();
    const entry = result.current;
    if (entry.kind !== "member") throw new Error(entry.kind);

    let left!: boolean;
    await act(async () => {
      left = await entry.leave();
    });
    expect(left).toBe(true);
    expect(mocks.leave).toHaveBeenCalledWith({ roomId: "room" });

    // The mutation lands before the home route does.
    current = { ...room, members: [] };
    rerender({ code: "ABCDEF" });
    expect(result.current).toEqual({ kind: "leaving", view: entry.view });
    expect(mocks.join).not.toHaveBeenCalled();
  });

  it("stays a member without rejoining when leaving fails", async () => {
    mocks.leave.mockRejectedValue(new Error("Network down"));
    const { result } = renderEntry();
    const entry = result.current;
    if (entry.kind !== "member") throw new Error(entry.kind);

    let left!: boolean;
    await act(async () => {
      left = await entry.leave();
    });

    expect(left).toBe(false);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { surface: "room.leave" },
    });
    expect(result.current.kind).toBe("member");
    expect(mocks.join).not.toHaveBeenCalled();
  });
});

describe("useCreateRoom", () => {
  function renderCreate() {
    return renderHook(() => useCreateRoom(), { wrapper });
  }

  it("waits for auth to load before creating a signed-in user's room", async () => {
    auth.isLoading = true;
    auth.isAuthenticated = false;
    mocks.create.mockResolvedValue({ code: "ABCDEF" });
    const { result, rerender } = renderCreate();

    const created = result.current();
    await Promise.resolve();
    expect(mocks.create).not.toHaveBeenCalled();

    auth.isLoading = false;
    auth.isAuthenticated = true;
    rerender();

    expect(await created).toEqual({ kind: "created", code: "ABCDEF" });
    expect(auth.signIn).not.toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({});
  });

  it("creates a new guest's room only once the client is signed in", async () => {
    auth.isLoading = true;
    auth.isAuthenticated = false;
    mocks.create.mockResolvedValue({ code: "ABCDEF" });
    const { result, rerender } = renderCreate();

    const created = result.current();
    auth.isLoading = false;
    rerender();
    await waitFor(() => expect(auth.signIn).toHaveBeenCalledWith("anonymous"));

    // signIn resolves before the Convex client sends the new token.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.create).not.toHaveBeenCalled();

    auth.isLoading = true;
    rerender();
    auth.isLoading = false;
    auth.isAuthenticated = true;
    rerender();

    expect(await created).toEqual({ kind: "created", code: "ABCDEF" });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("is at the Guest limit when creating hits it", async () => {
    mocks.create.mockRejectedValue(appError("guestRoomLimit"));
    const { result } = renderCreate();

    expect(await result.current()).toEqual({ kind: "guestLimit" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("tells a user who creates rooms too fast to wait", async () => {
    mocks.create.mockRejectedValue(appError("rateLimited"));
    const { result } = renderCreate();

    expect(await result.current()).toEqual({
      kind: "error",
      message: "Too many requests. Wait a moment and try again.",
    });
  });

  it("invites the given Friends with the room, and explains a Friend who is gone", async () => {
    mocks.create.mockResolvedValueOnce({ code: "ABCDEF" });
    mocks.create.mockRejectedValueOnce(appError("notFriends"));
    const { result } = renderCreate();
    const friends = ["blair" as Id<"users">];

    expect(await result.current(friends)).toEqual({
      kind: "created",
      code: "ABCDEF",
    });
    expect(mocks.create).toHaveBeenCalledWith({ invite: friends });
    expect(await result.current(friends)).toEqual({
      kind: "error",
      message: "Someone you picked is no longer your friend.",
    });
    expect(captureException).not.toHaveBeenCalled();
  });
});

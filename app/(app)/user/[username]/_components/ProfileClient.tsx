"use client";

import type { FunctionReturnType } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { notFound, useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { FriendButton } from "@/app/_components/FriendButton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { runMutation } from "@/lib/report-error";
import { Achievements } from "./Achievements";
import { ActivityGraph } from "./ActivityGraph";

// Mirrors the limits updateProfile enforces on the server.
const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";
const MAX_AVATAR_BYTES = 1024 * 1024;

export function ProfileSkeleton() {
  return (
    <>
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <Skeleton className="h-20 w-20 rounded-full" />
          <div className="flex flex-col gap-1">
            <Skeleton className="h-8 w-44 max-w-[60%]" />
            <Skeleton className="h-4 w-20 max-w-[60%]" />
          </div>
        </div>

        <div className="flex w-full flex-col gap-2">
          <Skeleton className="h-9 w-full" />
        </div>
      </section>

      <section>
        <div className="mt-4 flex flex-col gap-3 border-y py-4">
          <div className="grid grid-cols-38 gap-1">
            {Array.from({ length: 266 }).map((_, index) => (
              <Skeleton
                key={index}
                className="aspect-square w-full rounded-xs"
              />
            ))}
          </div>
          <div className="flex items-center justify-between gap-4">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </section>
    </>
  );
}

export function ProfileClient({ username }: { username: string }) {
  const router = useRouter();
  const profile = useQuery(api.users.getByUsername, { username });
  const activityGraph = useQuery(api.users.getActivityGraph, { username });
  const achievementState = useQuery(api.achievements.listForProfile, {
    username,
  });
  useEffect(() => {
    if (
      profile === undefined ||
      profile === null ||
      profile.username === null
    ) {
      return;
    }
    if (profile.username !== username) {
      router.replace(`/user/${profile.username}`);
    }
  }, [profile, router, username]);

  if (
    profile === undefined ||
    activityGraph === undefined ||
    achievementState === undefined
  ) {
    return <ProfileSkeleton />;
  }

  if (profile === null || activityGraph === null || achievementState === null) {
    notFound();
  }

  return (
    <ProfileEditor
      key={`${username}:${profile._id}:${profile.isCurrentUser}`}
      loadedProfile={profile}
      activityGraph={activityGraph}
      achievementState={achievementState}
    />
  );
}

type Draft = {
  name: string;
  username: string;
  avatar: { file: File; preview: string } | null;
};
type SaveStage = "upload-url" | "upload" | "persist";
type EditState =
  | { stage: "viewing" }
  | { stage: "editing"; draft: Draft }
  | {
      stage: "failed";
      draft: Draft;
      failedAt: "validate" | SaveStage;
      error: string;
    }
  | { stage: SaveStage; draft: Draft }
  | { stage: "navigating"; username: string };

function ProfileEditor({
  loadedProfile,
  activityGraph,
  achievementState,
}: {
  loadedProfile: NonNullable<
    FunctionReturnType<typeof api.users.getByUsername>
  >;
  activityGraph: NonNullable<
    FunctionReturnType<typeof api.users.getActivityGraph>
  >;
  achievementState: NonNullable<
    FunctionReturnType<typeof api.achievements.listForProfile>
  >;
}) {
  const router = useRouter();
  const generateUploadUrl = useMutation(
    api.users.generateProfileImageUploadUrl,
  );
  const updateProfile = useMutation(api.users.updateProfile);
  const nameInputId = useId();
  const usernameInputId = useId();
  const emailInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<EditState>({ stage: "viewing" });
  // A synchronous claim prevents repeated submits before React commits disabled controls.
  // Unmounting this keyed editor invalidates all of its outstanding work.
  const inFlight = useRef<symbol | null>(null);
  useLayoutEffect(
    () => () => {
      inFlight.current = null;
    },
    [],
  );
  const draft = "draft" in state ? state.draft : null;
  const selectedAvatarPreview = draft?.avatar?.preview ?? null;
  useEffect(() => {
    if (selectedAvatarPreview === null) return;
    return () => URL.revokeObjectURL(selectedAvatarPreview);
  }, [selectedAvatarPreview]);
  const isEditing = draft !== null;
  const isBusy =
    state.stage !== "viewing" &&
    state.stage !== "editing" &&
    state.stage !== "failed";
  const error = state.stage === "failed" ? state.error : null;
  const nameInput = draft?.name ?? "";
  const usernameInput = draft?.username ?? "";
  const displayName = loadedProfile.player.name;
  const avatarSrc = selectedAvatarPreview ?? loadedProfile.player.image;
  const canEdit = loadedProfile.isCurrentUser;
  const profileEmail = loadedProfile.email ?? "";
  const profileUsername =
    loadedProfile.displayUsername ?? loadedProfile.username ?? "";
  const avatar = (
    <Avatar className="h-20 w-20">
      {avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
      <AvatarFallback className="text-2xl">
        {displayName.slice(0, 1).toUpperCase()}
      </AvatarFallback>
    </Avatar>
  );

  function beginEditing() {
    if (!canEdit || state.stage !== "viewing") return;
    inFlight.current = null;
    setState({
      stage: "editing",
      draft: {
        name: loadedProfile.name ?? "",
        username: profileUsername,
        avatar: null,
      },
    });
  }

  function handleAvatarClick() {
    if (!canEdit || isBusy) return;
    beginEditing();
    fileInputRef.current?.click();
  }

  function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0] ?? null;
    // Allow picking the same file again after cancellation or a failed validation.
    event.currentTarget.value = "";
    if (file === null || draft === null || isBusy) return;
    const invalidReason = !AVATAR_ACCEPT.split(",").includes(file.type)
      ? "Please choose a PNG, JPEG, WebP or GIF image."
      : file.size > MAX_AVATAR_BYTES
        ? "Profile image must be 1 MB or smaller."
        : null;
    if (invalidReason !== null) {
      setState({
        stage: "failed",
        draft: { ...draft, avatar: null },
        failedAt: "validate",
        error: invalidReason,
      });
      return;
    }
    setState({
      stage: "editing",
      draft: { ...draft, avatar: { file, preview: URL.createObjectURL(file) } },
    });
  }

  function changeDraft(field: "name" | "username", value: string) {
    if (draft === null || isBusy) return;
    setState({ stage: "editing", draft: { ...draft, [field]: value } });
  }

  function cancelEditing() {
    if (isBusy) return;
    inFlight.current = null;
    setState({ stage: "viewing" });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (draft === null || isBusy || inFlight.current !== null) return;
    const trimmedName = draft.name.trim();
    const trimmedUsername = draft.username.trim();
    const validationError =
      trimmedName.length === 0
        ? "Name is required."
        : trimmedUsername.length === 0
          ? "Username is required."
          : null;
    if (validationError !== null) {
      setState({
        stage: "failed",
        draft,
        failedAt: "validate",
        error: validationError,
      });
      return;
    }

    const request = Symbol("profile save");
    inFlight.current = request;
    const isCurrent = () => inFlight.current === request;
    let stage: SaveStage = draft.avatar === null ? "persist" : "upload-url";
    setState({ stage, draft });
    const result = await runMutation(
      async () => {
        let avatarStorageId: Id<"_storage"> | undefined;
        if (draft.avatar !== null) {
          const uploadUrl = await generateUploadUrl({});
          if (!isCurrent()) return;
          stage = "upload";
          setState({ stage, draft });
          const uploadResponse = await fetch(uploadUrl, {
            method: "POST",
            headers: { "Content-Type": draft.avatar.file.type },
            body: draft.avatar.file,
          });
          if (!isCurrent()) return;
          if (!uploadResponse.ok)
            throw new Error("Profile image upload failed.");
          const { storageId } = (await uploadResponse.json()) as {
            storageId: Id<"_storage">;
          };
          if (!isCurrent()) return;
          avatarStorageId = storageId;
        }
        if (!isCurrent()) return;
        stage = "persist";
        setState({ stage, draft });
        await updateProfile({
          name: trimmedName,
          username: trimmedUsername,
          ...(avatarStorageId === undefined ? {} : { avatarStorageId }),
        });
      },
      {
        context: "profile.update",
        fallback: "Could not save profile. Check your details and try again.",
        showToast: false,
      },
    );
    if (!isCurrent()) return;
    if (!result.ok) {
      inFlight.current = null;
      setState({
        stage: "failed",
        draft,
        failedAt: stage,
        error: result.message,
      });
      return;
    }
    // Success releases the preview through its sole effect owner. Keep the claim
    // until the next edit session so repeated submit events cannot persist twice.
    const nextUsername = trimmedUsername.toLowerCase();
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (nextUsername !== loadedProfile.username) {
      setState({ stage: "navigating", username: nextUsername });
      router.replace(`/user/${nextUsername}`);
    } else {
      setState({ stage: "viewing" });
    }
  }

  return (
    <>
      <section className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept={AVATAR_ACCEPT}
            className="hidden"
            disabled={isBusy}
            onChange={handleAvatarChange}
          />
          {canEdit ? (
            <button
              type="button"
              aria-label="Change profile picture"
              className="cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              disabled={isBusy}
              onClick={handleAvatarClick}
            >
              {avatar}
            </button>
          ) : (
            avatar
          )}
          {!isEditing && (
            <div className="min-w-0">
              <h2 className="truncate text-2xl font-semibold">{displayName}</h2>
              {profileUsername && (
                <p className="truncate text-sm text-muted-foreground">
                  @{profileUsername}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex w-full flex-col gap-2">
          {!canEdit && <FriendButton userId={loadedProfile._id} />}
          {canEdit &&
            (isEditing ? (
              <form
                onSubmit={handleSubmit}
                className="flex flex-col gap-3 border p-3"
              >
                <label htmlFor={nameInputId} className="text-sm font-medium">
                  Name
                </label>
                <Input
                  id={nameInputId}
                  value={nameInput}
                  onChange={(event) => changeDraft("name", event.target.value)}
                  disabled={isBusy}
                  autoComplete="name"
                />
                <label
                  htmlFor={usernameInputId}
                  className="text-sm font-medium"
                >
                  Username
                </label>
                <Input
                  id={usernameInputId}
                  value={usernameInput}
                  onChange={(event) =>
                    changeDraft("username", event.target.value)
                  }
                  disabled={isBusy}
                  autoComplete="username"
                  maxLength={20}
                />
                <label htmlFor={emailInputId} className="text-sm font-medium">
                  Email
                </label>
                <Input id={emailInputId} value={profileEmail} disabled />
                {error && <p className="text-sm text-destructive">{error}</p>}
                <div className="flex gap-2">
                  <Button type="submit" className="flex-1" disabled={isBusy}>
                    {isBusy ? "Saving..." : "Save"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    disabled={isBusy}
                    onClick={cancelEditing}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <Button
                disabled={isBusy}
                onClick={beginEditing}
                className="w-full justify-center hover:bg-muted/80"
              >
                Edit Profile
              </Button>
            ))}
        </div>
      </section>

      <section>
        <div className="mt-4 divide-y border-y text-sm">
          <ActivityGraph days={activityGraph.days} />
        </div>
        <Achievements achievementState={achievementState} />
      </section>
    </>
  );
}

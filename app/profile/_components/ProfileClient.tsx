"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import {
	type ChangeEvent,
	type FormEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Achievements } from "./Achievements";
import { ActivityGraph } from "./ActivityGraph";

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

export function ProfileClient({
	viewedUserId,
}: {
	viewedUserId: Id<"users"> | null;
}) {
	const router = useRouter();
	const { isLoading, isAuthenticated } = useConvexAuth();
	const userArgs = isAuthenticated
		? viewedUserId === null
			? {}
			: { userId: viewedUserId }
		: "skip";
	const profile = useQuery(api.users.getUser, userArgs);
	const activityGraph = useQuery(api.users.getActivityGraph, userArgs);
	const generateUploadUrl = useMutation(
		api.users.generateProfileImageUploadUrl,
	);
	const updateProfile = useMutation(api.users.updateProfile);
	const nameInputId = useId();
	const usernameInputId = useId();
	const emailInputId = useId();
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [isEditing, setIsEditing] = useState(false);
	const [nameInput, setNameInput] = useState("");
	const [usernameInput, setUsernameInput] = useState("");
	const [selectedAvatarFile, setSelectedAvatarFile] = useState<File | null>(
		null,
	);
	const [selectedAvatarPreview, setSelectedAvatarPreview] = useState<
		string | null
	>(null);
	const [error, setError] = useState<string | null>(null);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		if (!isLoading && !isAuthenticated) router.replace("/signin");
	}, [isLoading, isAuthenticated, router]);

	useEffect(() => {
		if (selectedAvatarPreview === null) return;
		return () => URL.revokeObjectURL(selectedAvatarPreview);
	}, [selectedAvatarPreview]);

	if (
		isLoading ||
		!isAuthenticated ||
		profile === undefined ||
		activityGraph === undefined
	) {
		return <ProfileSkeleton />;
	}

	if (profile === null || activityGraph === null) {
		return <p className="text-muted-foreground">Profile not found.</p>;
	}

	const loadedProfile = profile;
	const displayName = loadedProfile.name ?? "Anonymous";
	const avatarSrc = selectedAvatarPreview ?? loadedProfile.image;
	const canEdit = loadedProfile.isCurrentUser;
	const profileEmail = loadedProfile.email ?? "";
	const profileUsername =
		loadedProfile.displayUsername ?? loadedProfile.username ?? "";
	const isBusy = isSaving;

	function beginEditing() {
		if (!canEdit) return;
		setNameInput(loadedProfile.name ?? "");
		setUsernameInput(profileUsername);
		setError(null);
		setIsEditing(true);
	}

	function handleAvatarClick() {
		if (!canEdit) return;
		beginEditing();
		fileInputRef.current?.click();
	}

	function handleAvatarChange(event: ChangeEvent<HTMLInputElement>) {
		const file = event.currentTarget.files?.[0] ?? null;
		if (file === null) return;
		if (!file.type.startsWith("image/")) {
			setError("Please choose an image file.");
			return;
		}
		setSelectedAvatarFile(file);
		setSelectedAvatarPreview((previous) => {
			if (previous !== null) URL.revokeObjectURL(previous);
			return URL.createObjectURL(file);
		});
	}

	function resetEditState() {
		setNameInput(loadedProfile.name ?? "");
		setUsernameInput(profileUsername);
		setSelectedAvatarFile(null);
		setSelectedAvatarPreview((previous) => {
			if (previous !== null) URL.revokeObjectURL(previous);
			return null;
		});
		setError(null);
	}

	async function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const trimmedName = nameInput.trim();
		const trimmedUsername = usernameInput.trim();
		if (trimmedName.length === 0) {
			setError("Name is required.");
			return;
		}
		if (trimmedUsername.length === 0) {
			setError("Username is required.");
			return;
		}

		setIsSaving(true);
		setError(null);
		try {
			let avatarStorageId: Id<"_storage"> | undefined;
			if (selectedAvatarFile !== null) {
				const uploadUrl = await generateUploadUrl({});
				const uploadResponse = await fetch(uploadUrl, {
					method: "POST",
					headers: { "Content-Type": selectedAvatarFile.type },
					body: selectedAvatarFile,
				});
				if (!uploadResponse.ok) {
					throw new Error("Profile image upload failed.");
				}
				const { storageId } = (await uploadResponse.json()) as {
					storageId: Id<"_storage">;
				};
				avatarStorageId = storageId;
			}

			await updateProfile({
				name: trimmedName,
				username: trimmedUsername,
				...(avatarStorageId === undefined ? {} : { avatarStorageId }),
			});
			setIsEditing(false);
			setSelectedAvatarFile(null);
			setSelectedAvatarPreview((previous) => {
				if (previous !== null) URL.revokeObjectURL(previous);
				return null;
			});
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "Could not update profile.",
			);
		} finally {
			setIsSaving(false);
		}
	}

	return (
		<>
			<section className="flex flex-col gap-4">
				<div className="flex items-center gap-4">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/*"
						className="hidden"
						onChange={handleAvatarChange}
					/>
					<Avatar
						className="h-20 w-20 cursor-pointer"
						onClick={handleAvatarClick}
					>
						{avatarSrc && <AvatarImage src={avatarSrc} alt={displayName} />}
						<AvatarFallback className="text-2xl">
							{displayName.slice(0, 1).toUpperCase()}
						</AvatarFallback>
					</Avatar>
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
									onChange={(event) => setNameInput(event.target.value)}
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
									onChange={(event) => setUsernameInput(event.target.value)}
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
										onClick={() => {
											resetEditState();
											setIsEditing(false);
										}}
									>
										Cancel
									</Button>
								</div>
							</form>
						) : (
							<Button
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
			</section>

			<Achievements />
		</>
	);
}

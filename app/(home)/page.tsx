"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
	Avatar,
	AvatarFallback,
	AvatarGroup,
	AvatarGroupCount,
	AvatarImage,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { getErrorData } from "@/lib/client-errors";
import { reportClientError } from "@/lib/report-error";

export default function Home() {
	const { isLoading, isAuthenticated } = useConvexAuth();
	const router = useRouter();
	const currentUser = useQuery(
		api.users.getUser,
		isAuthenticated ? {} : "skip",
	);
	const isRegistered = isAuthenticated && currentUser?.isAnonymous === false;

	const header = (
		<header className="flex items-center justify-between">
			<h1 className="text-2xl font-bold">Contextus</h1>
			{isRegistered ? (
				<Button
					variant="outline"
					onClick={() => {
						if (currentUser?.username)
							router.push(`/user/${currentUser.username}`);
					}}
					disabled={!currentUser?.username}
				>
					Profile
				</Button>
			) : null}
		</header>
	);

	if (isLoading || (isAuthenticated && currentUser === undefined)) {
		return (
			<>
				{header}
				<HomeContentSkeleton />
			</>
		);
	}

	return (
		<>
			{header}
			<section className="flex flex-col gap-3">
				<p className="max-w-xl text-muted-foreground">
					Co-op Contexto with friends. Join a room code and guess together.
				</p>
				{!isRegistered && (
					<p className="text-sm text-muted-foreground">
						No account needed—create or join a room and start playing.
					</p>
				)}
			</section>
			{isAuthenticated && <MyRooms />}
			{isRegistered && <RecentGroups />}
			<CreateRoom isAuthenticated={isAuthenticated} />
			<JoinRoom isAuthenticated={isAuthenticated} />
		</>
	);
}

function HomeContentSkeleton() {
	return (
		<>
			<div className="h-32 w-full rounded-lg border" />
			<div className="h-28 w-full rounded-lg border" />
		</>
	);
}

function CreateRoom({ isAuthenticated }: { isAuthenticated: boolean }) {
	const router = useRouter();
	const { signIn } = useAuthActions();
	const create = useMutation(api.rooms.create);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	return (
		<section className="rounded-lg border p-6 flex flex-col gap-3">
			<h2 className="text-lg font-semibold">Start a new room</h2>
			<p className="text-sm text-muted-foreground">
				You will be the host. Share the room code with friends to play together.
			</p>
			<Button
				disabled={busy}
				onClick={async () => {
					setError(null);
					setBusy(true);
					try {
						if (!isAuthenticated) await signIn("anonymous");
						const { code } = await create({});
						router.push(`/r/${code}`);
					} catch (err) {
						const isRoomLimit =
							getErrorData(err) === "Guest room limit reached";
						const message = isRoomLimit
							? "Guest room limit reached"
							: "Could not create room. Try again.";
						setError(message);
						if (!isRoomLimit) {
							reportClientError(err, {
								userMessage: message,
								context: "room.create",
							});
						}
					} finally {
						setBusy(false);
					}
				}}
			>
				{busy ? "Creating…" : "Create room"}
			</Button>
			{error === "Guest room limit reached" ? (
				<div className="flex flex-col gap-2 text-sm text-muted-foreground">
					<p>Create an account to host or join more active rooms.</p>
					<Button variant="outline" onClick={() => router.push("/signin")}>
						Create account
					</Button>
				</div>
			) : error ? (
				<p className="text-sm text-destructive">{error}</p>
			) : null}
		</section>
	);
}

function JoinRoom({ isAuthenticated }: { isAuthenticated: boolean }) {
	const router = useRouter();
	const join = useMutation(api.rooms.join);
	const [code, setCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	return (
		<section className="rounded-lg border p-6 flex flex-col gap-3">
			<h2 className="text-lg font-semibold">Join a room</h2>
			<form
				className="flex gap-2"
				onSubmit={async (e) => {
					e.preventDefault();
					setError(null);
					setBusy(true);
					try {
						const normalized = code.toUpperCase().trim();
						if (!isAuthenticated) {
							router.push(`/r/${normalized}`);
							return;
						}
						await join({ code: normalized });
						router.push(`/r/${normalized}`);
					} catch (err) {
						const isRoomLimit =
							getErrorData(err) === "Guest room limit reached";
						const message = isRoomLimit
							? "Guest room limit reached"
							: "Could not join room. Check the code and try again.";
						setError(message);
						if (!isRoomLimit) {
							reportClientError(err, {
								userMessage: message,
								context: "room.join",
							});
						}
					} finally {
						setBusy(false);
					}
				}}
			>
				<Input
					placeholder="ABCDEF"
					value={code}
					onChange={(e) => setCode(e.target.value)}
					maxLength={6}
					autoCapitalize="characters"
					className="uppercase"
				/>
				<Button type="submit" disabled={busy || code.length === 0}>
					{busy ? "Joining…" : isAuthenticated ? "Join" : "Join as guest"}
				</Button>
			</form>
			{error === "Guest room limit reached" ? (
				<div className="flex flex-col gap-2 text-sm text-muted-foreground">
					<p>Create an account to host or join more active rooms.</p>
					<Button variant="outline" onClick={() => router.push("/signin")}>
						Create account
					</Button>
				</div>
			) : error ? (
				<p className="text-sm text-rose-400">{error}</p>
			) : null}
		</section>
	);
}

function MyRooms() {
	const rooms = useQuery(api.rooms.listMine, {});
	if (rooms === undefined) return null;
	if (rooms.length === 0) return null;
	return (
		<section className="rounded-lg border p-6 flex flex-col gap-3">
			<h2 className="text-lg font-semibold">Your active rooms</h2>
			<ul className="flex flex-col gap-3">
				{rooms.map((r) => (
					<li
						key={r._id}
						className="flex items-center justify-between gap-3 border-l-2 border-primary/70 pl-3"
					>
						<span className="font-mono text-base tracking-widest">
							{r.code}
						</span>
						<Button asChild className="h-11 min-w-24">
							<a href={`/r/${r.code}`}>Join</a>
						</Button>
					</li>
				))}
			</ul>
		</section>
	);
}

function RecentGroups() {
	const router = useRouter();
	const groups = useQuery(api.rooms.listRecentGroups, {});
	const playAgain = useMutation(api.rooms.playAgain);
	const [busyRoomId, setBusyRoomId] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	if (groups === undefined || groups.length === 0) return null;

	return (
		<section className="flex flex-col gap-4 border-y py-5">
			<div className="flex flex-col gap-1">
				<h2 className="text-lg font-semibold">Play again</h2>
				<p className="text-sm text-muted-foreground">
					Start another session with people you have played with before.
				</p>
			</div>
			<ul className="flex flex-col divide-y border-y">
				{groups.map((group) => {
					const visibleMembers = group.members.slice(0, 3);
					const remaining = group.members.length - visibleMembers.length;
					return (
						<li
							key={group.roomId}
							className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center"
						>
							<div className="flex min-w-0 flex-1 items-center gap-3">
								<AvatarGroup className="shrink-0">
									{visibleMembers.map((member) => (
										<Avatar key={member.userId} size="lg">
											{member.image && (
												<AvatarImage src={member.image} alt="" />
											)}
											<AvatarFallback>
												{member.name.slice(0, 1).toUpperCase()}
											</AvatarFallback>
										</Avatar>
									))}
									{remaining > 0 && (
										<AvatarGroupCount>+{remaining}</AvatarGroupCount>
									)}
								</AvatarGroup>
								<div className="min-w-0">
									<p className="truncate text-sm font-semibold">
										{group.members.map((member) => member.name).join(" + ")}
									</p>
									<p className="text-xs text-muted-foreground">
										Last played{" "}
										{new Date(group.lastActivityAt).toLocaleDateString(
											undefined,
											{
												month: "short",
												day: "numeric",
											},
										)}
									</p>
								</div>
							</div>
							<Button
								className="h-11 w-full sm:w-auto sm:min-w-36"
								disabled={busyRoomId !== null}
								onClick={async () => {
									setError(null);
									setBusyRoomId(group.roomId);
									try {
										const { code } = await playAgain({ roomId: group.roomId });
										router.push(`/r/${code}`);
									} catch (caught) {
										const message = "Could not start this room. Try again.";
										setError(message);
										reportClientError(caught, {
											userMessage: message,
											context: "room.playAgain",
										});
									} finally {
										setBusyRoomId(null);
									}
								}}
							>
								{busyRoomId === group.roomId ? "Starting…" : "Play Contextus"}
							</Button>
						</li>
					);
				})}
			</ul>
			{error && <p className="text-sm text-destructive">{error}</p>}
		</section>
	);
}

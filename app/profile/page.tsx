import type { Id } from "@/convex/_generated/dataModel";
import { ProfileClient } from "./_components/ProfileClient";

export default async function ProfilePage({
	searchParams,
}: {
	searchParams: Promise<{ userId?: string }>;
}) {
	const { userId } = await searchParams;

	return <ProfileClient viewedUserId={userId as Id<"users"> | null} />;
}

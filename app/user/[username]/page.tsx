import { ProfileClient } from "./_components/ProfileClient";

export default async function UserProfilePage({
	params,
}: {
	params: Promise<{ username: string }>;
}) {
	const { username } = await params;

	return <ProfileClient username={decodeURIComponent(username)} />;
}

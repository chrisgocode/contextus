import { notFound } from "next/navigation";
import { ProfileClient } from "./_components/ProfileClient";

export default async function UserProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;

  let decodedUsername: string;
  try {
    decodedUsername = decodeURIComponent(username);
  } catch {
    // A malformed escape like `%E0%A4%A` can't name any user.
    notFound();
  }

  return <ProfileClient username={decodedUsername} />;
}

// Where the next join of a Room came from, for analytics, when its URL can't
// say. The friends panel records a Friend's Room before its Join link
// navigates there, and the Room page takes it once when it joins.
let friendStatusCode: string | null = null;

export function markFriendStatusJoin(code: string) {
  friendStatusCode = code.toUpperCase();
}

export function takeJoinSource(code: string): "friend_status" | undefined {
  if (friendStatusCode !== code.toUpperCase()) return undefined;
  friendStatusCode = null;
  return "friend_status";
}

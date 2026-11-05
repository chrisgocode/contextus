// Where the next join of a Room came from, for analytics, when its URL can't
// say. The friends panel records a Friend's Room before its Join link
// navigates there, and the Room page takes it once when it joins.
let friendStatusCode: string | null = null;

export function markFriendStatusJoin(code: string) {
  friendStatusCode = code.toUpperCase();
}

export function peekJoinSource(code: string): "friend_status" | undefined {
  return friendStatusCode === code.toUpperCase() ? "friend_status" : undefined;
}

export function takeJoinSource(code: string): "friend_status" | undefined {
  const matches = friendStatusCode === code.toUpperCase();
  friendStatusCode = null;
  return matches ? "friend_status" : undefined;
}

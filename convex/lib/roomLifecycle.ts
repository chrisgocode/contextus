import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

// Room status and membership `active` flags move together: an ended Room
// holds no active memberships, and reactivating one restores them all.

// Returns the memberships it deactivated.
export async function closeRoom(
  ctx: Pick<MutationCtx, "db">,
  roomId: Id<"rooms">,
): Promise<Doc<"roomMembers">[]> {
  await ctx.db.patch("rooms", roomId, { status: "ended" });
  const members = await ctx.db
    .query("roomMembers")
    .withIndex("by_room_user", (q) => q.eq("roomId", roomId))
    .collect();
  for (const member of members) {
    await ctx.db.patch("roomMembers", member._id, { active: false });
  }
  return members;
}

export async function reopenRoom(
  ctx: Pick<MutationCtx, "db">,
  roomId: Id<"rooms">,
  next: { code: string; hostUserId: Id<"users"> },
  members: Doc<"roomMembers">[],
): Promise<void> {
  await ctx.db.patch("rooms", roomId, { ...next, status: "active" });
  for (const member of members) {
    await ctx.db.patch("roomMembers", member._id, { active: true });
  }
}

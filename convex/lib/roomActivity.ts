import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export async function upsertRoomActivity(
	ctx: Pick<MutationCtx, "db">,
	roomId: Id<"rooms">,
	now: number,
): Promise<void> {
	const existing = await ctx.db
		.query("roomActivity")
		.withIndex("by_room", (q) => q.eq("roomId", roomId))
		.unique();
	if (existing === null) {
		await ctx.db.insert("roomActivity", { roomId, lastActivityAt: now });
	} else {
		await ctx.db.patch(existing._id, { lastActivityAt: now });
	}
}

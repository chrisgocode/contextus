import { v } from "convex/values";
import { query } from "./_generated/server";
import { requireUser } from "./auth_helpers";
import { assertMember } from "./games";

export const listPending = query({
  args: { gameId: v.id("games") },
  handler: async (ctx, { gameId }) => {
    const userId = await requireUser(ctx);
    const game = await ctx.db.get(gameId);
    if (game === null) return [];
    await assertMember(ctx, game.roomId, userId);
    const room = await ctx.db.get(game.roomId);
    if (room === null) return [];
    const isHost = room.hostUserId === userId;
    const rowsRaw = await ctx.db
      .query("pendingRequests")
      .withIndex("by_game_status", (q) =>
        q.eq("gameId", gameId).eq("status", "pending"),
      )
      .collect();
    const rows = isHost
      ? rowsRaw
      : rowsRaw.filter((r) => r.requesterUserId === userId);
    const hydrated = await Promise.all(
      rows.map(async (r) => {
        const u = await ctx.db.get(r.requesterUserId);
        return {
          ...r,
          requesterName: u?.name ?? null,
          requesterImage: u?.image ?? null,
        };
      }),
    );
    return hydrated;
  },
});

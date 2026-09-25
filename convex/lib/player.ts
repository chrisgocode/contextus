import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

type PlayerCtx = Pick<QueryCtx, "db" | "storage">;

export async function playerFromUser(
  ctx: PlayerCtx,
  id: Id<"users">,
  user: Doc<"users"> | null,
) {
  const uploadedImage = user?.avatarStorageId
    ? await ctx.storage.getUrl(user.avatarStorageId)
    : null;
  return {
    id,
    name: user?.name ?? user?.displayUsername ?? "Player",
    image: uploadedImage ?? user?.image ?? null,
    isGuest: user?.isAnonymous === true,
    exists: user !== null,
  };
}

export async function loadPlayers(ctx: PlayerCtx, ids: Id<"users">[]) {
  const uniqueIds = [...new Set(ids)];
  const players = await Promise.all(
    uniqueIds.map(async (id) =>
      playerFromUser(ctx, id, await ctx.db.get("users", id)),
    ),
  );
  return new Map(uniqueIds.map((id, index) => [id, players[index]]));
}

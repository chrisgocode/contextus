import { expect, test } from "vitest";
import { api } from "../convex/_generated/api";
import { asUser, seedUser, setupTest } from "./helpers";

test("heartbeat silently no-ops for ex-member after leaving room", async () => {
  const t = setupTest();
  const host = await seedUser(t, { name: "Host" });
  const other = await seedUser(t, { name: "Other" });
  const { roomId, code } = await asUser(t, host).mutation(
    api.rooms.create,
    {},
  );
  await asUser(t, other).mutation(api.rooms.join, { code });
  await asUser(t, other).mutation(api.rooms.leave, { roomId });
  await expect(
    asUser(t, other).mutation(api.presence.heartbeat, {
      roomId,
      userId: other,
      sessionId: "s1",
      interval: 10000,
    }),
  ).resolves.not.toThrow();
});

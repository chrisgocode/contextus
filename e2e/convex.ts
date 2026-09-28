import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { withoutDeployKey } from "../scripts/local-convex-env.mjs";

function convexUrl() {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!url) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  return url;
}

export function convexClient() {
  return new ConvexHttpClient(convexUrl());
}

// The Convex Auth access token the app stored for this browser context, or
// null when it is signed out. The cookie gets a `__Host-` prefix off localhost.
export async function authToken(context: BrowserContext) {
  const cookies = await context.cookies();
  return (
    cookies.find((cookie) => cookie.name.endsWith("__convexAuthJWT"))?.value ??
    null
  );
}

// A client that calls Convex as the user signed in to this browser context.
export async function clientFor(context: BrowserContext) {
  const token = await authToken(context);
  if (token === null) return null;
  const client = convexClient();
  client.setAuth(token);
  return client;
}

// Internal, so it runs through the CLI's admin access. Never with a deploy key,
// which could aim it at production.
export async function purgeAccount(email: string) {
  await promisify(execFile)(
    "npx",
    ["convex", "run", "e2eCleanup:purgeAccount", JSON.stringify({ email })],
    { env: withoutDeployKey() },
  );
}

// Ends every room this context's user hosts, so a failed test can't leave
// rooms active.
export async function endHostedRooms(context: BrowserContext) {
  const client = await clientFor(context);
  if (client === null) return;
  const [user, rooms] = await Promise.all([
    client.query(api.users.getUser, {}),
    client.query(api.rooms.listMine, {}),
  ]);
  if (user === null) return;
  await Promise.all(
    rooms
      .filter((room) => room.hostUserId === user._id)
      .map((room) => client.mutation(api.rooms.endRoom, { roomId: room._id })),
  );
}

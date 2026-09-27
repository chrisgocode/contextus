import type { BrowserContext } from "@playwright/test";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { createRoom, expect, test } from "./fixtures";

// A guest's access token stays valid for up to an hour after expiry cleanup
// deletes its session. The backend must treat it as signed out, and the page
// must drop it instead of showing an error.

async function accessToken(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies.find((c) => c.name === "__convexAuthJWT")?.value;
}

test("rejects a guest's token after expiry cleanup and signs the page out", async ({
  context,
  page,
}) => {
  await createRoom(page);
  const token = await accessToken(context);
  if (!token) throw new Error("Missing guest access token");

  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  await client.mutation(api.e2eCleanup.expireCurrentGuest, {});

  await expect(client.mutation(api.rooms.create, {})).rejects.toMatchObject({
    data: "Not authenticated",
  });

  await page.goto("/");
  await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
  await expect.poll(() => accessToken(context)).not.toBe(token);
  await expect(page.getByText("Your active rooms")).toBeHidden();
});

import type { BrowserContext, Page } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { authToken, clientFor } from "./convex";
import { createRoom, endRoom, expect, test } from "./fixtures";

// Signing in covers the password branch of `auth:store` only. The Google
// branch, which production uses, is covered by convex/tests/auth.test.ts.

async function playAsGuest(page: Page) {
  const roomUrl = await createRoom(page);
  await page.getByRole("button", { name: "Start game" }).click();
  await page.getByPlaceholder("Type a word…").fill("house");
  await page.getByRole("button", { name: "Guess" }).click();
  await expect(page.getByText("house", { exact: true })).toHaveCount(2);
  return roomUrl;
}

async function expectGuestDataKept(
  context: BrowserContext,
  page: Page,
  email: string,
  roomUrl: string,
) {
  const account = await clientFor(context);
  if (account === null) throw new Error("Signed out after sign-in");
  // The merge runs in scheduled batches after sign-in.
  await expect
    .poll(async () => {
      const [user, graph] = await Promise.all([
        account.query(api.users.getUser, {}),
        account.query(api.users.getActivityGraph, {}),
      ]);
      return {
        email: user?.email,
        played: graph?.days.reduce((sum, day) => sum + day.count, 0),
      };
    })
    .toEqual({ email, played: 1 });

  await page.goto(roomUrl);
  await expect(page.getByText("house", { exact: true })).toHaveCount(2);
  await endRoom(page);
}

test("a Guest who signs in with a password keeps their room and activity", async ({
  context,
  page,
  registerContext,
}) => {
  const roomUrl = await test.step("play as a Guest", () => playAsGuest(page));
  const guestToken = await authToken(context);

  const { email } =
    await test.step("sign up from the Guest's browser", async () => {
      // Leave the app as a Google redirect would. A Guest tab left open signs
      // out once the merge deletes the Guest, and the shared cookie would take
      // the new account's session with it (#139).
      await page.goto("about:blank");
      const user = await registerContext(context);
      expect(await authToken(context)).not.toBe(guestToken);
      return user;
    });

  await test.step("the account keeps the Guest's room and activity", () =>
    expectGuestDataKept(context, page, email, roomUrl));
});

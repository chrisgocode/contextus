import type { BrowserContext, Page } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { e2eAccountEmail } from "./accounts";
import { authToken, clientFor, purgeAccount } from "./convex";
import { createRoom, endRoom, expect, test } from "./fixtures";

// Production signs in with Google, which runs the `userOAuth` branch of
// `auth:store`; e2e runs point it at `e2e/oidc-mock.mjs`. Password sign-in
// runs the `signIn` branch instead.

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

test("a Guest who signs in with Google keeps their room and activity", async ({
  context,
  page,
}) => {
  const issuer = process.env.E2E_GOOGLE_ISSUER;
  test.skip(issuer === undefined, "Needs E2E_GOOGLE_ISSUER");
  // A fresh account, as `registerContext` gives the password test. Global
  // teardown purges it.
  const email = e2eAccountEmail(test.info().parallelIndex, 0);
  await purgeAccount(email);
  const roomUrl = await test.step("play as a Guest", () => playAsGuest(page));
  const guestToken = await authToken(context);

  await test.step("sign in with Google", async () => {
    // The page refreshes its token on load, and that response clears the
    // OAuth verifier cookie. Signing in before it lands fails (#144).
    const refreshed = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/auth") &&
        (res.request().postData()?.includes('"refreshToken"') ?? false),
    );
    await page.goto("/signin");
    await refreshed;
    await page.getByRole("button", { name: "Continue with Google" }).click();
    // The mock signs in whichever account is typed, as `${account}@example.com`.
    await page.getByLabel("Account").fill(email.split("@")[0]);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");
    expect(await authToken(context)).not.toBe(guestToken);
  });

  await test.step("the account keeps the Guest's room and activity", () =>
    expectGuestDataKept(context, page, email, roomUrl));
});

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

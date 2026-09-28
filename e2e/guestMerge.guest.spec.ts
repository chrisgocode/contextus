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

// Another tab left open as the Guest. Once the merge deletes the Guest it
// must pick up the new account, not sign out the session the shared cookie
// now holds (#139).
async function openGuestTab(context: BrowserContext) {
  const tab = await context.newPage();
  await tab.goto("/");
  await expect(tab.getByText("Your active rooms")).toBeVisible();
  return tab;
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

async function expectSignedIn(
  context: BrowserContext,
  tabs: Page[],
  email: string,
) {
  for (const tab of tabs) {
    await expect(tab.getByRole("button", { name: "Profile" })).toBeVisible();
  }
  const account = await clientFor(context);
  expect((await account?.query(api.users.getUser, {}))?.email).toBe(email);
}

for (const { authorize, returning } of [
  { authorize: "after a login page", returning: false },
  // The page that started sign-in stays loaded through the redirects.
  { authorize: "straight back", returning: true },
]) {
  test(`a Guest who signs in with Google keeps their room and activity (redirect ${authorize})`, async ({
    context,
    page,
  }) => {
    const issuer = process.env.E2E_GOOGLE_ISSUER;
    test.skip(issuer === undefined, "Needs E2E_GOOGLE_ISSUER");
    // A fresh account, as `registerContext` gives the password test. Global
    // teardown purges it.
    const email = e2eAccountEmail(test.info().parallelIndex, 0);
    const name = email.split("@")[0];
    await purgeAccount(email);
    const roomUrl = await test.step("play as a Guest", () => playAsGuest(page));
    const guestToken = await authToken(context);
    const otherTab = await openGuestTab(context);

    await test.step("sign in with Google", async () => {
      // The mock signs in whichever account is typed or set in its `account`
      // cookie, as `${account}@example.com`.
      if (returning) {
        await context.addCookies([
          { name: "account", value: name, url: issuer },
        ]);
      }
      let releaseRefresh!: () => void;
      let refreshReady!: () => void;
      const held = new Promise<void>((resolve) => (releaseRefresh = resolve));
      const ready = new Promise<void>((resolve) => (refreshReady = resolve));
      await page.route("**/api/auth", async (route) => {
        if (route.request().postDataJSON()?.args?.refreshToken === undefined) {
          return route.continue();
        }
        const response = await route.fetch();
        refreshReady();
        await held;
        await route.fulfill({ response });
      });
      await page.goto("/signin");
      await ready;
      const refreshResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth") &&
          response.request().postDataJSON()?.args?.refreshToken !== undefined,
      );
      const signInResponse = page.waitForResponse(
        (response) =>
          response.url().endsWith("/api/auth") &&
          response.request().postDataJSON()?.args?.provider === "google",
      );
      const click = page
        .getByRole("button", { name: "Continue with Google" })
        .click();
      try {
        await signInResponse;
      } finally {
        releaseRefresh();
      }
      await refreshResponse;
      await click;
      if (!returning) {
        await page.getByLabel("Account").fill(name);
        await page.getByRole("button", { name: "Sign in" }).click();
      }
      await page.waitForURL("/");
      expect(await authToken(context)).not.toBe(guestToken);
    });

    await test.step("the account keeps the Guest's room and activity", () =>
      expectGuestDataKept(context, page, email, roomUrl));

    await test.step("both tabs stay signed in to the account", () =>
      expectSignedIn(context, [page, otherTab], email));
  });
}

test("a Guest who signs in with a password keeps their room and activity", async ({
  context,
  page,
  registerContext,
}) => {
  const roomUrl = await test.step("play as a Guest", () => playAsGuest(page));
  const guestToken = await authToken(context);
  const otherTab = await openGuestTab(context);

  const { email } =
    await test.step("sign up from the Guest's browser", async () => {
      const user = await registerContext(context);
      expect(await authToken(context)).not.toBe(guestToken);
      return user;
    });

  await test.step("the account keeps the Guest's room and activity", () =>
    expectGuestDataKept(context, page, email, roomUrl));

  await test.step("the Guest's other tab stays signed in to the account", () =>
    expectSignedIn(context, [otherTab], email));
});

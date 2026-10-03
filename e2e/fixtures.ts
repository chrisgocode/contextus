import {
  expect,
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";
import { api } from "../convex/_generated/api";
import { e2eAccountEmail, REGISTERED_USERS_PER_TEST } from "./accounts";
import { clientFor, endHostedRooms, purgeAccount } from "./convex";

type RegisteredUser = {
  email: string;
  name: string;
  page: Page;
};

type Fixtures = {
  createRegisteredUser: (
    options?: BrowserContextOptions,
  ) => Promise<RegisteredUser>;
  // Signs up a fresh registered account in an existing browser context, such
  // as a Guest's, through the app's /api/auth proxy.
  registerContext: (
    context: BrowserContext,
  ) => Promise<Omit<RegisteredUser, "page">>;
};

export const test = base.extend<Fixtures>({
  context: async ({ context }, provide) => {
    await provide(context);
    await endHostedRooms(context);
  },

  registerContext: async ({}, provide, testInfo) => {
    const emails: string[] = [];

    await provide(async (context) => {
      if (emails.length >= REGISTERED_USERS_PER_TEST) {
        throw new Error(
          `Each test supports at most ${REGISTERED_USERS_PER_TEST} registered users; raise E2E_REGISTERED_USERS_PER_TEST`,
        );
      }
      const email = e2eAccountEmail(testInfo.parallelIndex, emails.length);
      emails.push(email);
      // Teardown purges too, but one that never ran would leave the account.
      await purgeAccount(email);
      await signInWithPassword(context, email, "signUp");

      const client = await clientFor(context);
      const user = await client?.query(api.users.getUser, {});
      if (!user) throw new Error(`Sign-up left ${email} signed out`);
      return { email, name: user.player.name };
    });

    await Promise.all(emails.map(purgeAccount));
  },

  createRegisteredUser: async (
    { browser, registerContext },
    provide,
    testInfo,
  ) => {
    const contexts: BrowserContext[] = [];

    await provide(async (options = {}) => {
      // A new context doesn't inherit the project's device, so pass it on.
      const {
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
      } = testInfo.project.use;
      const context = await browser.newContext({
        baseURL,
        viewport,
        userAgent,
        deviceScaleFactor,
        isMobile,
        hasTouch,
        ...options,
      });
      contexts.push(context);
      const user = await registerContext(context);
      return { ...user, page: await context.newPage() };
    });

    for (const context of contexts) {
      await endHostedRooms(context);
      await context.close();
    }
  },
});

export async function signInWithPassword(
  context: BrowserContext,
  email: string,
  flow: "signIn" | "signUp",
) {
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error("Missing E2E_PASSWORD");
  const response = await context.request.post("/api/auth", {
    data: {
      action: "auth:signIn",
      args: { provider: "password", params: { flow, email, password } },
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function createRoom(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  return page.url();
}

export async function endRoom(page: Page) {
  await page.getByRole("button", { name: "Room menu" }).click();
  await page.getByRole("menuitem", { name: "End room" }).click();
  await expect(page).toHaveURL("/");
}

export async function leaveRoom(page: Page) {
  await page.getByRole("button", { name: "Room menu" }).click();
  await page.getByRole("menuitem", { name: "Leave room" }).click();
}

// Opens the sheet with the hint and give-up controls and the Host's requests.
export async function openAssist(page: Page) {
  await page.getByRole("button", { name: /^Hints and give up/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

export function roomMemberItems(page: Page) {
  return page
    .getByRole("complementary")
    .getByRole("list")
    .first()
    .getByRole("listitem");
}

export { expect } from "@playwright/test";

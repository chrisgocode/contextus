import { randomUUID } from "node:crypto";
import {
  expect,
  test as base,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from "@playwright/test";

type RegisteredUser = {
  context: BrowserContext;
  email: string;
  page: Page;
};

type Fixtures = {
  createRegisteredUser: (
    options?: BrowserContextOptions,
  ) => Promise<RegisteredUser>;
};

export const test = base.extend<Fixtures>({
  createRegisteredUser: async ({ browser }, provide, testInfo) => {
    const contexts: BrowserContext[] = [];

    await provide(async (options = {}) => {
      const password = process.env.E2E_PASSWORD;
      if (!password) throw new Error("Missing E2E_PASSWORD");

      const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        ...options,
      });
      contexts.push(context);
      // ponytail: test users persist in the dev deployment; add a guarded cleanup endpoint if CI volume makes that material.
      const email = `contextus-e2e-${testInfo.parallelIndex}-${randomUUID()}@example.com`;
      const response = await context.request.post("/api/auth", {
        data: {
          action: "auth:signIn",
          args: {
            provider: "password",
            params: { flow: "signUp", email, password },
          },
        },
      });
      expect(response.ok(), await response.text()).toBeTruthy();

      return { context, email, page: await context.newPage() };
    });

    for (const context of contexts) await context.close();
  },
});

export async function createRoom(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  return page.url();
}

export async function endRoom(page: Page) {
  await page.getByRole("button", { name: /^End( room)?$/ }).click();
  await expect(page).toHaveURL("/");
}

export function roomMemberItems(page: Page) {
  return page
    .getByRole("complementary")
    .getByRole("list")
    .first()
    .getByRole("listitem");
}

export { expect } from "@playwright/test";

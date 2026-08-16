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
    let accountIndex = 0;

    await provide(async (options = {}) => {
      const password = process.env.E2E_PASSWORD;
      if (!password) throw new Error("Missing E2E_PASSWORD");
      if (accountIndex > 1) {
        throw new Error("Each test supports at most two registered users");
      }

      const context = await browser.newContext({
        baseURL: testInfo.project.use.baseURL,
        ...options,
      });
      contexts.push(context);
      const namespace = (process.env.E2E_ACCOUNT_NAMESPACE ?? "local")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
      const email = `contextus-e2e-${namespace}-w${testInfo.parallelIndex}-u${accountIndex++}@example.com`;
      const authenticate = (flow: "signIn" | "signUp") =>
        context.request.post("/api/auth", {
          data: {
            action: "auth:signIn",
            args: {
              provider: "password",
              params: { flow, email, password },
            },
          },
        });
      let response = await authenticate("signIn");
      if (!response.ok()) response = await authenticate("signUp");
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

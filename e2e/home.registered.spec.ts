import { expect, test } from "@playwright/test";

test("loads as a registered user", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
});

test("plays again with the same registered group", async ({
  browser,
  page,
}) => {
  const password = process.env.E2E_PASSWORD;
  if (!password) throw new Error("Missing E2E_PASSWORD");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  const originalUrl = page.url();

  const partner = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
  });
  try {
    const email = `contextus-e2e-${Date.now()}@example.com`;
    const response = await partner.request.post("/api/auth", {
      data: {
        action: "auth:signIn",
        args: {
          provider: "password",
          params: { flow: "signUp", email, password },
        },
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();

    const partnerPage = await partner.newPage();
    await partnerPage.goto(originalUrl);
    const members = page
      .getByRole("heading", { name: "Members" })
      .locator("..")
      .getByRole("listitem");
    await expect(members).toHaveCount(2);

    await page.getByRole("button", { name: "End" }).click();
    await expect(page).toHaveURL("/");
    await expect(partnerPage).toHaveURL("/");

    await page.getByRole("button", { name: "Play Contextus" }).first().click();
    await expect(page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
    expect(page.url()).not.toBe(originalUrl);

    await partnerPage.getByRole("link", { name: "Join" }).first().click();
    await expect(partnerPage).toHaveURL(page.url());
    await expect(members).toHaveCount(2);

    await page.getByRole("button", { name: "End" }).click();
  } finally {
    await partner.close();
  }
});

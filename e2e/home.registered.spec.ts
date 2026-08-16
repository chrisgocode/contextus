import { expect, test } from "@playwright/test";

test("loads as a registered user", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
});

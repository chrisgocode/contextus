import { expect, test } from "@playwright/test";

test("creates a room as a guest", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();

	await expect(page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  await expect(page.getByText("Room", { exact: true })).toBeVisible();
});

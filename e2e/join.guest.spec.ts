import { expect, test } from "./fixtures";

// Stands in for a visitor who submits before hydration: the form posts to
// app/join/route.ts through the proxy.ts matcher instead of the client router.
test.use({ javaScriptEnabled: false });

test("joins a room by code before hydration", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("ABCDEF").fill("abc234");
  await page.getByRole("button", { name: "Join", exact: true }).click();

  await expect(page).toHaveURL("/r/ABC234");
});

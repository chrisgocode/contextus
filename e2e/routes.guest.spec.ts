import { expect, test } from "./fixtures";

// Most of these routes skip the auth middleware via the proxy.ts matcher, so a
// matcher change could break them without any other spec noticing.

test("serves the deployed version", async ({ request }) => {
  const response = await request.get("/api/version");

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  expect(await response.json()).toEqual({ version: expect.any(String) });
});

test("serves robots.txt and the sitemap", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(robots.status()).toBe(200);
  expect(robots.headers()["content-type"]).toContain("text/plain");
  expect(await robots.text()).toContain("Sitemap:");

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.status()).toBe(200);
  expect(sitemap.headers()["content-type"]).toContain("application/xml");
  expect(await sitemap.text()).toContain("<urlset");
});

test("renders the static content pages", async ({ page }) => {
  await page.goto("/privacy");
  await expect(
    page.getByRole("heading", { level: 1, name: "Privacy" }),
  ).toBeVisible();

  await page.goto("/how-to-play");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "How to play Contexto with friends",
    }),
  ).toBeVisible();
});

test("shows a missing profile", async ({ page }) => {
  await page.goto("/user/doesnotexist");

  await expect(page.getByText("Profile not found.")).toBeVisible();
});

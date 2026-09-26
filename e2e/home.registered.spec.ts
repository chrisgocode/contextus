import { createRoom, endRoom, expect, roomMemberItems, test } from "./fixtures";

test("makes Home inert while a room opens", async ({
  createRegisteredUser,
}) => {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  const convexHost = new URL(convexUrl).host;
  const { page } = await createRegisteredUser();
  let createRequestBlocked = false;
  await page.routeWebSocket(
    (url) => url.host === convexHost,
    (webSocket) => {
      const server = webSocket.connectToServer();
      webSocket.onMessage((message) => {
        if (message.toString().includes("rooms:create")) {
          createRequestBlocked = true;
          return;
        }
        server.send(message);
      });
    },
  );
  await page.goto("/");

  const createButton = page
    .locator("button")
    .filter({ hasText: "Create room" });
  await createButton.focus();
  await page.keyboard.press("Enter");

  await expect(
    page.getByRole("status", { name: "Opening room" }),
  ).toBeVisible();
  await expect.poll(() => createRequestBlocked).toBe(true);
  await expect(page).toHaveURL("/");
  const inertHome = page.locator("main > [inert]");
  await expect(inertHome).toHaveCount(1);
  await expect
    .poll(() =>
      inertHome.evaluate((home) => !home.contains(document.activeElement)),
    )
    .toBe(true);
});

test("plays again with the same registered group", async ({
  createRegisteredUser,
}) => {
  const host = await createRegisteredUser({
    viewport: { width: 390, height: 844 },
  });
  const partner = await createRegisteredUser({
    viewport: { width: 390, height: 844 },
  });

  const originalUrl = await createRoom(host.page);

  await partner.page.goto(originalUrl);
  const members = roomMemberItems(host.page);
  await expect(members).toHaveCount(2);

  await endRoom(host.page);
  await expect(partner.page).toHaveURL("/");

  await host.page
    .getByRole("button", { name: "Play Contextus" })
    .first()
    .click();
  await expect(host.page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  expect(host.page.url()).not.toBe(originalUrl);

  await partner.page.getByRole("link", { name: "Join" }).click();
  await expect(partner.page).toHaveURL(host.page.url());
  await expect(members).toHaveCount(2);

  await endRoom(host.page);
});

test("stays signed in across the static How to play page", async ({
  createRegisteredUser,
}) => {
  const { page } = await createRegisteredUser();
  const profileButton = page.getByRole("button", { name: "Profile" });

  await page.goto("/");
  await expect(profileButton).toBeVisible();

  await page.getByRole("link", { name: "Learn how to play" }).click();
  await expect(page).toHaveURL("/how-to-play");
  await page.getByRole("link", { name: "← Back to Contextus" }).click();
  await expect(page).toHaveURL("/");
  await expect(profileButton).toBeVisible();

  await page.goto("/how-to-play");
  await page.getByRole("link", { name: "← Back to Contextus" }).click();
  await expect(page).toHaveURL("/");
  await expect(profileButton).toBeVisible();
});

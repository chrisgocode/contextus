import { createRoom, endRoom, expect, roomMemberItems, test } from "./fixtures";

test("makes Home inert while a room opens", async ({
  createRegisteredUser,
}) => {
  const { page } = await createRegisteredUser();
  let createRequestBlocked = false;
  await page.routeWebSocket(/convex\.cloud/, (webSocket) => {
    const server = webSocket.connectToServer();
    webSocket.onMessage((message) => {
      if (message.toString().includes("rooms:create")) {
        createRequestBlocked = true;
        return;
      }
      server.send(message);
    });
  });
  await page.goto("/");

  const createButton = page.locator("button").filter({ hasText: "Create room" });
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

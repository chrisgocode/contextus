import { createRoom, endRoom, expect, roomMemberItems, test } from "./fixtures";

test("loads as a registered user", async ({ createRegisteredUser }) => {
  const { page } = await createRegisteredUser();
  await page.goto("/");

  await expect(page.getByRole("button", { name: "Profile" })).toBeVisible();
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

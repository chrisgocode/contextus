import {
  createRoom,
  endRoom,
  expect,
  leaveRoom,
  roomMemberItems,
  test,
} from "./fixtures";

test("creates a room as a guest", async ({ page }) => {
  await createRoom(page);

  await expect(page.getByText("Room", { exact: true })).toBeVisible();
  await endRoom(page);
});

test("shows an error for an unknown room code", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("ABCDEF").fill("IIIIII");
  await page.getByRole("button", { name: "Join", exact: true }).click();

  await expect(page).toHaveURL("/r/IIIIII");
  await expect(page.getByText("Room not found.")).toBeVisible();
});

test("joins another player's room as a guest", async ({
  createRegisteredUser,
  page,
}) => {
  const host = await createRegisteredUser();
  await createRoom(host.page);

  await page.goto(host.page.url());
  await page.getByRole("button", { name: "Join as guest" }).click();
  await expect(page.getByRole("button", { name: "Room menu" })).toBeVisible();

  const members = roomMemberItems(host.page);
  await expect(members).toHaveCount(2);

  await leaveRoom(page);
  await expect(page).toHaveURL("/");
  await expect(members).toHaveCount(1);
});

import {
  createRoom,
  expect,
  leaveRoom,
  openAssist,
  roomMemberItems,
  test,
} from "./fixtures";

test("the partner becomes Host live when the Host leaves mid-game", async ({
  createRegisteredUser,
}) => {
  const host = await createRegisteredUser();
  const partner = await createRegisteredUser();

  await createRoom(host.page);
  await partner.page.goto(host.page.url());
  await expect(roomMemberItems(host.page)).toHaveCount(2);
  await host.page.getByRole("button", { name: "Start game" }).click();
  await expect(
    partner.page.getByRole("button", { name: "Hints and give up" }),
  ).toBeVisible();
  await expect(
    partner.page.getByRole("status", { name: "Requests" }),
  ).toHaveCount(0);
  // Survives only if the partner's page never reloads.
  await partner.page.evaluate(() => {
    document.documentElement.dataset.e2eNoReload = "1";
  });

  await leaveRoom(host.page);
  await expect(host.page).toHaveURL("/");

  const members = roomMemberItems(partner.page);
  await expect(members).toHaveCount(1);
  await expect(
    members
      .filter({ hasText: partner.name })
      .getByText("host", { exact: true }),
  ).toBeVisible();
  await openAssist(partner.page);
  await expect(
    partner.page.getByRole("button", { name: "Get hint" }),
  ).toBeVisible();
  await expect(
    partner.page.getByRole("button", { name: "Give up", exact: true }),
  ).toBeVisible();
  await partner.page.keyboard.press("Escape");
  await expect(
    partner.page.getByRole("status", { name: "Requests" }),
  ).toBeAttached();
  await expect(partner.page.locator("html")).toHaveAttribute(
    "data-e2e-no-reload",
    "1",
  );
});

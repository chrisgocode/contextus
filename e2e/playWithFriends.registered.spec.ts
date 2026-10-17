import { expect, roomMemberItems, test } from "./fixtures";

test("a Friend invited with Play with friends joins from the Invite toast", async ({
  createRegisteredUser,
}) => {
  const a = await createRegisteredUser();
  const b = await createRegisteredUser();

  await b.page.goto("/");
  await b.page.getByRole("button", { name: "Profile" }).click();
  await expect(b.page).toHaveURL(/\/user\/[a-z0-9]+$/);
  const bUsername = new URL(b.page.url()).pathname.split("/").pop()!;

  await a.page.goto("/");
  await a.page.getByRole("button", { name: "Friends" }).click();
  await a.page.getByRole("textbox", { name: "Username" }).fill(bUsername);
  await a.page.getByRole("button", { name: "Add friend" }).click();
  await expect(a.page.getByText("Friend request sent.")).toBeVisible();
  await a.page.keyboard.press("Escape");

  await b.page.goto("/");
  await b.page
    .getByRole("button", { name: /^Friends, 1 friend request/ })
    .click();
  await b.page
    .getByRole("region", { name: "Requests" })
    .getByRole("button", { name: "Accept" })
    .click();
  await expect(
    b.page.getByRole("region", { name: "Friends" }).getByText(a.name),
  ).toBeVisible();
  await b.page.keyboard.press("Escape");

  await a.page.getByRole("button", { name: "Play with friends" }).click();
  await a.page.getByRole("checkbox", { name: `Invite ${b.name}` }).check();
  await a.page
    .getByRole("button", { name: "Create room and invite 1" })
    .click();
  await expect(a.page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  const code = new URL(a.page.url()).pathname.split("/").pop()!;

  const toast = b.page
    .getByRole("status")
    .filter({ hasText: `${a.name} invited you to room ${code}` });
  await toast.getByRole("button", { name: `Join room ${code}` }).click();
  await expect(b.page).toHaveURL(`/r/${code}`);

  for (const page of [a.page, b.page]) {
    const members = roomMemberItems(page);
    await expect(members).toHaveCount(2);
    await expect(members.filter({ hasText: a.name })).toHaveCount(1);
    await expect(members.filter({ hasText: b.name })).toHaveCount(1);
  }
});

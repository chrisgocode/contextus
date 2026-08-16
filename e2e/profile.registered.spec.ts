import { expect, test } from "./fixtures";

test("updates a profile and exposes only its public fields", async ({
  createRegisteredUser,
  page: publicPage,
}) => {
  const user = await createRegisteredUser();
  const username = `e2e${Date.now().toString(36)}`;

  await user.page.goto("/");
  await user.page.getByRole("button", { name: "Profile" }).click();
  await expect(user.page).toHaveURL(/\/user\/[a-z0-9]+$/);

  await user.page.getByRole("button", { name: "Edit Profile" }).click();
  await user.page.getByLabel("Name", { exact: true }).fill("E2E Player");
  await user.page.getByLabel("Username").fill(username);
  await expect(user.page.getByLabel("Email")).toHaveValue(user.email);
  await expect(user.page.getByLabel("Email")).toBeDisabled();
  await user.page.getByRole("button", { name: "Save" }).click();

  await expect(user.page).toHaveURL(`/user/${username}`);
  await expect(
    user.page.getByRole("heading", { name: "E2E Player" }),
  ).toBeVisible();

  await publicPage.goto(`/user/${username}`);
  await expect(
    publicPage.getByRole("heading", { name: "E2E Player" }),
  ).toBeVisible();
  await expect(publicPage.getByText(`@${username}`)).toBeVisible();
  await expect(publicPage.getByText(user.email)).toHaveCount(0);
  await expect(
    publicPage.getByRole("button", { name: "Edit Profile" }),
  ).toHaveCount(0);
});

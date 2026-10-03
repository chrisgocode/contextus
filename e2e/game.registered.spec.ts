import { createRoom, expect, roomMemberItems, test } from "./fixtures";

test("two registered players complete a cooperative game", async ({
  createRegisteredUser,
}) => {
  const host = await createRegisteredUser();
  const partner = await createRegisteredUser();

  const roomUrl = await test.step("join the same room", async () => {
    const url = await createRoom(host.page);

    await partner.page.goto(host.page.url());
    await expect(roomMemberItems(host.page)).toHaveCount(2);
    return url;
  });

  await test.step("start a game and share guesses live", async () => {
    await expect(
      partner.page.getByText("Waiting for the host to start a game."),
    ).toBeVisible();
    await host.page.getByRole("button", { name: "Start game" }).click();
    await expect(partner.page.getByPlaceholder("Type a word…")).toBeVisible();

    await partner.page.getByPlaceholder("Type a word…").fill("house");
    await partner.page.getByRole("button", { name: "Guess" }).click();
    await expect(host.page.getByText("house", { exact: true })).toHaveCount(2);
    await expect(partner.page.getByText("house", { exact: true })).toHaveCount(
      2,
    );

    await partner.page.getByPlaceholder("Type a word…").fill("house");
    await partner.page.getByRole("button", { name: "Guess" }).click();
    await expect(
      partner.page.getByRole("status", { name: "Already guessed" }),
    ).toContainText("already guessed");
    await expect(
      partner.page.getByRole("status", { name: "Already guessed" }),
    ).toContainText(/\d+/);
    await expect(
      partner.page
        .getByText("All guesses (closest first)")
        .locator("..")
        .getByText("house", { exact: true })
        .locator("../.."),
    ).toHaveClass(/ring-foreground/);
  });

  await test.step("leave and resume the active puzzle", async () => {
    await partner.page.getByRole("button", { name: "Leave" }).click();
    await expect(partner.page).toHaveURL("/");
    await expect(roomMemberItems(host.page)).toHaveCount(1);

    await partner.page.goto(roomUrl);
    await expect(partner.page.getByPlaceholder("Type a word…")).toBeVisible();
    await expect(partner.page.getByText("house", { exact: true })).toHaveCount(
      2,
    );
    await expect(roomMemberItems(host.page)).toHaveCount(2);
  });

  await test.step("deny one request and approve game completion", async () => {
    await partner.page.getByRole("button", { name: "Request hint" }).click();
    await expect(partner.page.getByText("Incoming hint")).toBeVisible();
    await expect(host.page.getByText("wants a hint")).toBeVisible();
    await host.page.getByRole("button", { name: "Deny" }).click();
    await expect(partner.page.getByText("Hint declined")).toBeVisible();
    await expect(
      partner.page.getByRole("button", { name: "Request hint" }),
    ).toBeEnabled();

    await partner.page.getByRole("button", { name: "Request hint" }).click();
    await expect(host.page.getByText("wants a hint")).toBeVisible();
    await host.page.getByRole("button", { name: "Give hint" }).click();
    await expect(partner.page.getByText("Hint approved")).toBeVisible();
    await expect(
      host.page
        .getByText("All guesses (closest first)")
        .locator("..")
        .getByText("hint", { exact: true }),
    ).toHaveCount(1);

    await partner.page.getByRole("button", { name: "Request give up" }).click();
    await expect(host.page.getByText("wants to give up")).toBeVisible();
    await host.page
      .getByRole("status", { name: "Requests" })
      .getByRole("button", { name: "Give up" })
      .click();
    await expect(
      host.page.getByRole("heading", { name: "Game given up" }),
    ).toBeVisible();
    await expect(
      partner.page.getByRole("heading", { name: "Game given up" }),
    ).toBeVisible();
    await expect(
      partner.page.getByText(/^The answer was [^?\s]+$/),
    ).toBeVisible();
  });
});

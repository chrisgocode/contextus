import type { Page } from "@playwright/test";
import { api } from "../convex/_generated/api";
import { clientFor } from "./convex";
import { createRoom, expect, roomMemberItems, test } from "./fixtures";

// The E2E word oracle makes "wordN" score distance N and "word0" every
// puzzle's answer. The Host is a Guest, so achievements start from zero.
test("a guest wins a game and keeps the win on their profile", async ({
  createRegisteredUser,
  page: guest,
}) => {
  const partner = await createRegisteredUser();

  await test.step("start a game together", async () => {
    await createRoom(guest);
    await partner.page.goto(guest.url());
    await expect(roomMemberItems(guest)).toHaveCount(2);
    await guest.getByRole("button", { name: "Start game" }).click();
    await expect(guest.getByPlaceholder("Type a word…")).toBeVisible();
    await expect(partner.page.getByPlaceholder("Type a word…")).toBeVisible();
  });

  await test.step("reject an unknown word", async () => {
    await guess(guest, "abc1");
    await expect(
      guest
        .getByRole("alert")
        .filter({ hasText: "I'm sorry, I don't know this word" }),
    ).toBeVisible();
  });

  await test.step("rank a known word", async () => {
    await guess(partner.page, "word5");
    // Ranks count from 1, so distance 5 is rank 6.
    await expect(guessRow(guest, "word5")).toHaveText(/^word5.*6$/);
  });

  await test.step("win for both players", async () => {
    await guess(guest, "word0");
    for (const page of [guest, partner.page]) {
      await expect(
        page.getByRole("heading", { name: "Congrats!" }),
      ).toBeVisible();
      await expect(page.getByText("The answer was word0")).toBeVisible();
    }
    await expect(guest.getByText(/achievement unlocked:/)).toBeAttached();
  });

  await test.step("show the win on the guest's profile", async () => {
    const client = await clientFor(guest.context());
    const user = await client?.query(api.users.getUser, {});
    if (!user?.username) throw new Error("Guest has no username");

    await guest.goto(`/user/${user.username}`);
    await expect(guest.getByText("1 Games")).toBeVisible();
    await expect(
      guest.getByRole("progressbar", { name: "Bullseye progress 100%" }),
    ).toBeVisible();
  });
});

async function guess(page: Page, word: string) {
  await page.getByPlaceholder("Type a word…").fill(word);
  await page.getByRole("button", { name: "Guess" }).click();
}

function guessRow(page: Page, lemma: string) {
  return page.getByText(lemma, { exact: true }).first().locator("..");
}

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { createRoom, expect, roomMemberItems, test } from "./fixtures";

// Serious or critical violations that already existed when these scans were
// added. Each entry matches one rule on specific elements, so the same rule
// failing anywhere else still fails. Delete an entry once it is fixed.
const KNOWN_VIOLATIONS: { id: string; target: RegExp }[] = [
  // Guess rows put white lemma text over the green, orange or red distance
  // bar, which is below 4.5:1 for green.
  {
    id: "color-contrast",
    target: /bg-neutral-900\\\/60.*font-semibold\.truncate$/,
  },
  // The profile's contribution graph scrolls sideways on narrow screens but
  // can't take keyboard focus.
  { id: "scrollable-region-focusable", target: /^\.overflow-y-hidden$/ },
];

async function seriousViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page }).analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      id: v.id,
      help: v.help,
      targets: v.nodes
        .map((node) => node.target.join(" "))
        .filter(
          (target) =>
            !KNOWN_VIOLATIONS.some(
              (known) => known.id === v.id && known.target.test(target),
            ),
        ),
    }))
    .filter((v) => v.targets.length > 0);
}

test("Home, an active game and a profile have no serious a11y violations", async ({
  createRegisteredUser,
}) => {
  const host = await createRegisteredUser();
  const partner = await createRegisteredUser();

  await host.page.goto("/");
  await expect(
    host.page.getByRole("button", { name: "Create room" }),
  ).toBeVisible();
  expect(await seriousViolations(host.page)).toEqual([]);

  await createRoom(host.page);
  await partner.page.goto(host.page.url());
  await expect(roomMemberItems(host.page)).toHaveCount(2);
  await host.page.getByRole("button", { name: "Start game" }).click();
  await host.page.getByPlaceholder("Type a word…").fill("word5");
  await host.page.getByRole("button", { name: "Guess" }).click();
  await expect(host.page.getByText("word5", { exact: true })).toHaveCount(2);
  expect(await seriousViolations(host.page)).toEqual([]);

  await host.page.goto("/");
  await host.page.getByRole("button", { name: "Profile" }).click();
  await expect(host.page.getByText(/^\d+ Games$/)).toBeVisible();
  expect(await seriousViolations(host.page)).toEqual([]);
});

import { expect, test } from "@playwright/test";

test("guests can preview all six styles, keep their choice across pages and reloads, and restore Classic", async ({
  page,
}) => {
  await page.goto("/");
  const appearance = page.getByRole("button", { name: "Appearance" });
  await appearance.click();
  await expect(page.getByRole("radio")).toHaveCount(6);
  await expect(page.getByRole("radio", { name: /Classic/ })).toBeChecked();
  const classicBackground = await page
    .locator("body")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  const classicButton = await page
    .getByRole("button", { name: "Create room" })
    .evaluate((el) => getComputedStyle(el).backgroundColor);

  for (const name of ["Midnight", "Forest", "Plum", "Espresso", "Slate"]) {
    await page.getByTitle(name).click();
    await expect(page.getByRole("radio", { name })).toBeChecked();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toHaveCSS(
      "background-color",
      classicBackground,
    );
    await expect(
      page.getByRole("button", { name: "Create room" }),
    ).not.toHaveCSS("background-color", classicButton);
  }
  const selectedBackground = await page
    .locator("body")
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  await page.keyboard.press("Escape");
  await expect(appearance).toBeFocused();
  await page.getByRole("link", { name: "Learn how to play" }).click();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    selectedBackground,
  );
  await page.reload();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    selectedBackground,
  );
  await page.goto("/");
  await appearance.click();
  await expect(page.getByRole("radio", { name: /Slate/ })).toBeChecked();
  await page.getByRole("radio", { name: /Slate/ }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: /Classic/ })).toBeChecked();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    classicBackground,
  );
  await page.reload();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    classicBackground,
  );
});

test("a storage write failure does not prevent changing colors", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === "contextus:color-style") throw new Error("Storage full");
      return setItem.call(this, key, value);
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Appearance" }).click();
  await page.getByTitle("Forest").click();
  await expect(page.getByRole("radio", { name: /Forest/ })).toBeChecked();
  await expect(page.getByRole("status")).toHaveText(
    "Applied for now. Your browser couldn’t save this choice.",
  );
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(16, 37, 30)",
  );
});

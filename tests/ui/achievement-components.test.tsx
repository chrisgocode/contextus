// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { AchievementUnlockQueue } from "@/app/_components/AchievementUnlockQueue";
import {
  achievementGroups,
  achievements,
  getAchievementById,
  getAchievementGroup,
  getUnlockedAchievementMetadata,
} from "@/app/_components/achievement-metadata";
import { Achievements } from "@/app/user/[username]/_components/Achievements";
import { ActivityGraph } from "@/app/user/[username]/_components/ActivityGraph";
import { render, screen, userEvent } from "./test-utils";

afterEach(() => vi.useRealTimers());

describe("achievement metadata", () => {
  it("resolves known, hidden, and missing achievement metadata", () => {
    expect(getAchievementById("bullseye")?.name).toBe("Bullseye");
    expect(getAchievementById("missing")).toBeNull();
    expect(getAchievementGroup("bronze").label).toBe("Bronze");
    expect(getUnlockedAchievementMetadata("missing")).toBeNull();
    expect(getUnlockedAchievementMetadata("so_close")?.trophy).toBe(
      achievementGroups.find((group) => group.category === "hidden")
        ?.unlockedImage,
    );
  });
});

describe("Achievements", () => {
  it("switches categories and masks locked hidden achievements", async () => {
    const user = userEvent.setup();
    render(
      <Achievements
        achievementState={{
          achievements: [
            {
              achievementId: "bullseye",
              hidden: false,
              masked: false,
              progress: null,
              target: 1,
              unlocked: true,
              unlockedAt: Date.UTC(2026, 0, 2),
            },
            {
              achievementId: "so_close",
              hidden: true,
              masked: true,
              progress: { current: 0, target: 1 },
              target: 1,
              unlocked: false,
              unlockedAt: null,
            },
          ],
          isCurrentUser: true,
          unlockedCount: 1,
        }}
      />,
    );

    expect(screen.getByRole("tab", { name: "Bronze1" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("Bullseye")).toBeVisible();
    expect(
      screen.getByRole("progressbar", { name: "Bullseye progress 100%" }),
    ).toHaveAttribute("aria-valuetext", "100% complete");

    await user.click(screen.getByRole("tab", { name: "Hidden0" }));
    expect(screen.getAllByText("Hidden Achievement").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Unlock this achievement to reveal its details.")
        .length,
    ).toBeGreaterThan(0);
  });

  it("reports the complete catalog size", () => {
    render(
      <Achievements
        achievementState={{
          achievements: [],
          isCurrentUser: false,
          unlockedCount: 0,
        }}
      />,
    );
    expect(
      screen.getByText(`0 of ${achievements.length} unlocked`),
    ).toBeVisible();
  });
});

describe("AchievementUnlockQueue", () => {
  it("announces the first queued item and advances after its display time", () => {
    vi.useFakeTimers();
    const onItemDone = vi.fn();
    const bronze = achievementGroups[0];

    render(
      <AchievementUnlockQueue
        items={[
          {
            achievementName: "Bullseye",
            category: "bronze",
            categoryLabel: bronze.label,
            key: "bullseye",
            trophy: bronze.image,
            trophyAlt: "Bronze trophy",
          },
        ]}
        onItemDone={onItemDone}
      />,
    );

    expect(
      screen.getByText("Bronze achievement unlocked: Bullseye"),
    ).toBeVisible();
    vi.runAllTimers();
    expect(onItemDone).toHaveBeenCalledOnce();
  });
});

it("summarizes profile activity for the current year", () => {
  const today = new Date().toISOString().slice(0, 10);
  render(<ActivityGraph days={[{ count: 2, date: today, level: 2 }]} />);
  expect(screen.getByText("Activity")).toBeVisible();
  expect(screen.getByText("2 Games")).toBeVisible();
});

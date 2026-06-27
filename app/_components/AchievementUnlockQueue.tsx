"use client";

import type { StaticImageData } from "next/image";
import { useEffect } from "react";
import { AchievementUnlockWidget } from "./AchievementUnlockWidget";
import type { AchievementCategory } from "./achievement-metadata";

export const ACHIEVEMENT_UNLOCK_DISPLAY_MS = 4200;

export type AchievementUnlockQueueItem = {
  key: string;
  achievementName: string;
  category: AchievementCategory;
  categoryLabel: string;
  trophy: StaticImageData;
  trophyAlt: string;
};

export function AchievementUnlockQueue({
  items,
  onItemDone,
}: {
  items: AchievementUnlockQueueItem[];
  onItemDone: () => void;
}) {
  const current = items[0] ?? null;

  useEffect(() => {
    if (current === null) return;
    const timeout = window.setTimeout(
      onItemDone,
      ACHIEVEMENT_UNLOCK_DISPLAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [current, onItemDone]);

  if (current === null) return null;

  return (
    <div className="achievement-unlock-queue" aria-live="polite">
      <AchievementUnlockWidget
        key={current.key}
        achievementName={current.achievementName}
        category={current.category}
        categoryLabel={current.categoryLabel}
        trophy={current.trophy}
        trophyAlt={current.trophyAlt}
      />
      <style>{`
				.achievement-unlock-queue {
					position: fixed;
					right: max(16px, env(safe-area-inset-right));
					bottom: calc(18px + env(safe-area-inset-bottom));
					left: max(16px, env(safe-area-inset-left));
					z-index: 60;
					display: flex;
					justify-content: center;
					pointer-events: none;
				}
			`}</style>
    </div>
  );
}

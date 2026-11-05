"use client";

import type { StaticImageData } from "next/image";
import { useEffect, useEffectEvent } from "react";
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

  const headKey = current?.key ?? null;
  const advance = useEffectEvent(onItemDone);

  // A head starts one display clock. Appending items or replacing the callback
  // does not restart it; replacing/removing the head cancels its advance event.
  useEffect(() => {
    if (headKey === null) return;
    const timeout = window.setTimeout(
      () => advance(),
      ACHIEVEMENT_UNLOCK_DISPLAY_MS,
    );
    return () => window.clearTimeout(timeout);
  }, [headKey]);

  // The live region stays mounted so screen readers pick up each unlock
  // inserted into it.
  return (
    <div className="achievement-unlock-queue" aria-live="polite">
      {current !== null && (
        <AchievementUnlockWidget
          key={current.key}
          achievementName={current.achievementName}
          category={current.category}
          categoryLabel={current.categoryLabel}
          trophy={current.trophy}
          trophyAlt={current.trophyAlt}
        />
      )}
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

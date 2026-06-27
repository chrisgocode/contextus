"use client";

import Image, { type StaticImageData } from "next/image";
import type { AchievementCategory } from "./achievement-metadata";

type AchievementUnlockWidgetProps = {
  achievementName: string;
  category: AchievementCategory;
  categoryLabel: string;
  trophy: StaticImageData;
  trophyAlt: string;
};

export function AchievementUnlockWidget({
  achievementName,
  category,
  categoryLabel,
  trophy,
  trophyAlt,
}: AchievementUnlockWidgetProps) {
  return (
    <div
      className="achievement-unlock-widget"
      data-category={category}
      aria-live="polite"
    >
      <div className="achievement-unlock-panel" aria-hidden="true" />
      <div className="achievement-unlock-text">
        <p>Achievement Unlocked</p>
        <h2>{achievementName}</h2>
      </div>
      <div className="achievement-unlock-badge">
        <Image src={trophy} alt={trophyAlt} width={46} height={46} priority />
      </div>
      <span className="sr-only">
        {categoryLabel} achievement unlocked: {achievementName}
      </span>

      <style>{`
				.achievement-unlock-widget {
					position: relative;
					width: min(100%, 360px);
					height: 88px;
					isolation: isolate;
					--badge-size: 72px;
					--badge-start: calc(50% - (var(--badge-size) / 2));
					--badge-end: 0px;
					--panel-start: calc(50% - 8px);
					--panel-end: 48px;
					--accent-border: rgb(202 138 4 / 0.58);
					--accent-panel-border: rgb(250 204 21 / 0.32);
					--accent-fill: rgb(113 63 18 / 0.26);
					--accent-glow: rgb(234 179 8 / 0.2);
					--accent-label: rgb(250 204 21 / 0.78);
					--accent-radial: rgb(250 204 21 / 0.28);
					--accent-bg-a: rgb(113 63 18 / 0.82);
				}

				.achievement-unlock-widget[data-category="bronze"] {
					--accent-border: rgb(154 81 36 / 0.58);
					--accent-panel-border: rgb(234 88 12 / 0.32);
					--accent-fill: rgb(124 45 18 / 0.26);
					--accent-glow: rgb(234 88 12 / 0.2);
					--accent-label: rgb(253 186 116 / 0.82);
					--accent-radial: rgb(251 146 60 / 0.28);
					--accent-bg-a: rgb(124 45 18 / 0.84);
				}

				.achievement-unlock-widget[data-category="silver"] {
					--accent-border: rgb(148 163 184 / 0.58);
					--accent-panel-border: rgb(203 213 225 / 0.32);
					--accent-fill: rgb(71 85 105 / 0.28);
					--accent-glow: rgb(203 213 225 / 0.18);
					--accent-label: rgb(226 232 240 / 0.82);
					--accent-radial: rgb(226 232 240 / 0.24);
					--accent-bg-a: rgb(71 85 105 / 0.86);
				}

				.achievement-unlock-widget[data-category="diamond"] {
					--accent-border: rgb(34 211 238 / 0.58);
					--accent-panel-border: rgb(103 232 249 / 0.32);
					--accent-fill: rgb(8 145 178 / 0.24);
					--accent-glow: rgb(34 211 238 / 0.2);
					--accent-label: rgb(165 243 252 / 0.86);
					--accent-radial: rgb(103 232 249 / 0.28);
					--accent-bg-a: rgb(14 116 144 / 0.82);
				}

				.achievement-unlock-widget[data-category="hidden"] {
					--accent-border: rgb(88 28 135 / 0.7);
					--accent-panel-border: rgb(168 85 247 / 0.3);
					--accent-fill: rgb(49 46 129 / 0.28);
					--accent-glow: rgb(168 85 247 / 0.18);
					--accent-label: rgb(221 214 254 / 0.86);
					--accent-radial: rgb(168 85 247 / 0.24);
					--accent-bg-a: rgb(39 39 42 / 0.92);
				}

				.achievement-unlock-badge {
					position: absolute;
					left: var(--badge-start);
					top: 8px;
					z-index: 2;
					display: flex;
					width: var(--badge-size);
					height: var(--badge-size);
					align-items: center;
					justify-content: center;
					border-radius: 9999px;
					border: 1px solid var(--accent-border);
					background:
						radial-gradient(circle at 35% 30%, var(--accent-radial), transparent 36px),
						linear-gradient(135deg, var(--accent-bg-a), rgb(24 24 27 / 0.96));
					box-shadow:
						0 0 0 1px rgb(255 255 255 / 0.08) inset,
						0 18px 48px var(--accent-glow);
					animation: achievement-badge-orbit 4.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
				}

				.achievement-unlock-panel {
					position: absolute;
					left: var(--panel-start);
					top: 14px;
					z-index: 1;
					width: calc(100% - var(--panel-end));
					height: 60px;
					border: 1px solid var(--accent-panel-border);
					background:
						linear-gradient(90deg, var(--accent-fill), rgb(39 39 42 / 0.92) 42%, rgb(24 24 27 / 0.96)),
						linear-gradient(180deg, rgb(255 255 255 / 0.06), transparent);
					box-shadow: 0 16px 44px rgb(0 0 0 / 0.28);
					transform: scaleX(0);
					transform-origin: left center;
					animation: achievement-panel-grow 4.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
				}

				.achievement-unlock-text {
					position: absolute;
					left: 96px;
					top: 23px;
					z-index: 3;
					width: calc(100% - 116px);
					opacity: 0;
					transform: translateX(-8px);
					animation: achievement-text-reveal 4.2s cubic-bezier(0.22, 1, 0.36, 1) forwards;
				}

				.achievement-unlock-text p {
					margin: 0 0 3px;
					color: var(--accent-label);
					font-size: 11px;
					font-weight: 700;
					letter-spacing: 0;
					line-height: 1.1;
					text-transform: uppercase;
				}

				.achievement-unlock-text h2 {
					margin: 0;
					overflow: hidden;
					color: white;
					font-size: 20px;
					font-weight: 800;
					letter-spacing: 0;
					line-height: 1.15;
					text-overflow: ellipsis;
					white-space: nowrap;
				}

				@keyframes achievement-badge-orbit {
					0%,
					8% {
						left: var(--badge-start);
						transform: rotate(0deg);
					}
					48%,
					100% {
						left: var(--badge-end);
						transform: rotate(-360deg);
					}
				}

				@keyframes achievement-panel-grow {
					0%,
					13% {
						left: var(--panel-start);
						opacity: 0;
						transform: scaleX(0);
					}
					48%,
					100% {
						left: var(--panel-end);
						opacity: 1;
						transform: scaleX(1);
					}
				}

				@keyframes achievement-text-reveal {
					0%,
					30% {
						opacity: 0;
						transform: translateX(-8px);
					}
					48%,
					100% {
						opacity: 1;
						transform: translateX(0);
					}
				}

				@media (prefers-reduced-motion: reduce) {
					.achievement-unlock-badge,
					.achievement-unlock-panel,
					.achievement-unlock-text {
						animation: none;
					}

					.achievement-unlock-badge {
						left: var(--badge-end);
						transform: none;
					}

					.achievement-unlock-panel {
						left: var(--panel-end);
						opacity: 1;
						transform: scaleX(1);
					}

					.achievement-unlock-text {
						opacity: 1;
						transform: none;
					}
				}
			`}</style>
    </div>
  );
}

"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { AchievementCard } from "./AchievementCard";
import {
	type AchievementCategory,
	achievementGroups,
	achievements,
} from "./achievement-constants";

const unlockedAchievementCount = 0;

export function Achievements() {
	const [activeCategory, setActiveCategory] =
		useState<AchievementCategory>("bronze");
	const activeGroup =
		achievementGroups.find((group) => group.category === activeCategory) ??
		achievementGroups[0];
	const activeAchievements = achievements.filter(
		(achievement) => achievement.category === activeGroup.category,
	);

	return (
		<section className="mt-6 border-y py-4">
			<div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 className="font-semibold text-lg">Achievements</h2>
					<p className="text-muted-foreground text-sm">
						{unlockedAchievementCount} of {achievements.length} unlocked
					</p>
				</div>
			</div>

			<div className="flex flex-col gap-3">
				<div
					aria-label="Achievement categories"
					className="flex gap-1 overflow-x-auto border-b pb-2"
					role="tablist"
				>
					{achievementGroups.map((group) => {
						const isActive = group.category === activeGroup.category;

						return (
							<Button
								key={group.category}
								aria-controls={`achievements-${group.category}`}
								aria-selected={isActive}
								className="h-10 shrink-0 gap-2 px-3"
								id={`achievements-${group.category}-tab`}
								onClick={() => setActiveCategory(group.category)}
								role="tab"
								type="button"
								variant={isActive ? "secondary" : "ghost"}
							>
								<Image
									src={group.image}
									alt=""
									width={20}
									height={20}
									className="opacity-65 grayscale"
								/>
								<span>{group.label}</span>
								{/* this will be the users earned tropy count per group */}
								<span className="text-muted-foreground text-xs">0</span>
							</Button>
						);
					})}
				</div>

				<div
					aria-labelledby={`achievements-${activeGroup.category}-tab`}
					id={`achievements-${activeGroup.category}`}
					role="tabpanel"
				>
					<div className="mb-2 flex items-center justify-between gap-3">
						<div className="flex items-center gap-2">
							<Image
								src={activeGroup.image}
								alt=""
								width={28}
								height={28}
								className="opacity-55 grayscale"
							/>
							<h3 className="font-medium text-sm">{activeGroup.label}</h3>
						</div>
						<span className="text-muted-foreground text-xs">
							0 / {activeAchievements.length}
						</span>
					</div>

					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{activeAchievements.map((achievement) => (
							<AchievementCard
								key={achievement.id}
								achievement={achievement}
								badgeClassName={activeGroup.badgeClassName}
								categoryLabel={activeGroup.label}
								image={activeGroup.image}
							/>
						))}
					</div>
				</div>
			</div>
		</section>
	);
}

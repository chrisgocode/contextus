"use client";

import Image from "next/image";
import { useState } from "react";
import {
	type AchievementCategory,
	achievementGroups,
	achievements,
} from "@/app/_components/achievement-metadata";
import { Button } from "@/components/ui/button";
import { AchievementCard } from "./AchievementCard";

export type ProfileAchievementState = {
	isCurrentUser: boolean;
	unlockedCount: number;
	achievements: Array<{
		achievementId: string;
		hidden: boolean;
		masked: boolean;
		unlocked: boolean;
		unlockedAt: number | null;
		progress: { current: number; target: number } | null;
		target: number;
	}>;
};

export function Achievements({
	achievementState,
}: {
	achievementState: ProfileAchievementState;
}) {
	const [activeCategory, setActiveCategory] =
		useState<AchievementCategory>("bronze");
	const activeGroup =
		achievementGroups.find((group) => group.category === activeCategory) ??
		achievementGroups[0];
	const achievementById = new Map(
		achievementState.achievements.map((achievement) => [
			achievement.achievementId,
			achievement,
		]),
	);
	const activeAchievements = achievements.filter(
		(achievement) => achievement.category === activeGroup.category,
	);
	const unlockedByCategory = new Map(
		achievementGroups.map((group) => [
			group.category,
			achievements
				.filter((achievement) => achievement.category === group.category)
				.filter((achievement) => achievementById.get(achievement.id)?.unlocked)
				.length,
		]),
	);
	const activeUnlockedCount = activeAchievements.filter(
		(achievement) => achievementById.get(achievement.id)?.unlocked,
	).length;

	return (
		<section className=" py-4">
			<div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
				<div>
					<h2 className="font-semibold text-lg">Achievements</h2>
					<p className="text-muted-foreground text-sm">
						{achievementState.unlockedCount} of {achievements.length} unlocked
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
								<span className="text-muted-foreground text-xs">
									{unlockedByCategory.get(group.category) ?? 0}
								</span>
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
							{activeUnlockedCount} / {activeAchievements.length}
						</span>
					</div>

					<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
						{activeAchievements.map((achievement) => {
							const state = achievementById.get(achievement.id);
							const isUnlocked = state?.unlocked ?? false;
							const isMasked = state?.masked ?? false;
							const image =
								activeGroup.category === "hidden" &&
								isUnlocked &&
								activeGroup.unlockedImage
									? activeGroup.unlockedImage
									: activeGroup.image;
							const progressValue = isUnlocked
								? 100
								: state?.progress
									? Math.floor(
											Math.min(
												100,
												(state.progress.current / state.progress.target) * 100,
											),
										)
									: 0;

							return (
								<AchievementCard
									key={achievement.id}
									achievement={achievement}
									badgeClassName={activeGroup.badgeClassName}
									categoryLabel={activeGroup.label}
									image={image}
									isMasked={isMasked}
									isUnlocked={isUnlocked}
									progressValue={progressValue}
									unlockedAt={state?.unlockedAt ?? null}
								/>
							);
						})}
					</div>
				</div>
			</div>
		</section>
	);
}

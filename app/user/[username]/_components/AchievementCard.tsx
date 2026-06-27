"use client";

import Image, { type StaticImageData } from "next/image";
import type { Achievement } from "@/app/_components/achievement-metadata";
import { Badge } from "@/components/ui/badge";
import { Field, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import ProgressLabel from "./ProgressLabel";

export function AchievementCard({
  achievement,
  badgeClassName,
  categoryLabel,
  image,
  isMasked,
  isUnlocked,
  progressValue,
  unlockedAt,
}: {
  achievement: Achievement;
  badgeClassName: string;
  categoryLabel: string;
  image: StaticImageData;
  isMasked: boolean;
  isUnlocked: boolean;
  progressValue: number;
  unlockedAt: number | null;
}) {
  const progressId = `achievement-progress-${achievement.id}`;
  const name = isMasked ? "Hidden Achievement" : achievement.name;
  const description = isMasked
    ? "Unlock this achievement to reveal its details."
    : achievement.description;
  const unlockedDate =
    unlockedAt === null
      ? null
      : new Intl.DateTimeFormat(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(unlockedAt));

  return (
    <article
      className={cn(
        "flex min-h-50 border bg-muted/20 p-3",
        isUnlocked ? "bg-background" : "opacity-75",
      )}
    >
      <div className="flex w-full flex-col justify-between gap-3">
        <div className="flex flex-row gap-2.5">
          <div className="flex w-14 shrink-0 flex-col">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center border bg-background">
              <Image
                src={image}
                alt=""
                width={44}
                height={44}
                className={isUnlocked ? "" : "opacity-60 grayscale"}
              />
            </div>
            <Badge
              variant="outline"
              className={cn(
                "mt-1 h-5 min-w-14 justify-center rounded-none px-1 text-[10px]",
                badgeClassName,
              )}
            >
              {categoryLabel}
            </Badge>
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h4 className="font-extrabold text-sm leading-tight">{name}</h4>
              {unlockedDate && (
                <span className="text-muted-foreground text-[11px]">
                  {unlockedDate}
                </span>
              )}
            </div>
            <p className="text-foreground/70 text-xs leading-snug">
              {description}
            </p>
          </div>
        </div>

        <div>
          <Field className="relative w-full">
            <FieldLabel htmlFor={progressId} className="sr-only">
              {achievement.name} progress {progressValue}%
            </FieldLabel>
            <ProgressLabel
              id={progressId}
              value={progressValue}
              aria-valuetext={`${progressValue}% complete`}
            />
          </Field>
        </div>
      </div>
    </article>
  );
}

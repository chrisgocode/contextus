"use client";

import { eachDayOfInterval, endOfYear, formatISO, startOfYear } from "date-fns";
import {
	type Activity,
	ContributionGraph,
	ContributionGraphBlock,
	ContributionGraphCalendar,
	ContributionGraphFooter,
	ContributionGraphLegend,
	ContributionGraphTotalCount,
} from "@/components/kibo-ui/contribution-graph";
import { Badge } from "@/components/ui/badge";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const maxLevel = 4;

export function ActivityGraph({ days }: { days: Activity[] }) {
	const now = new Date();
	const activityByDate = new Map(days.map((day) => [day.date, day]));
	const graphDays = eachDayOfInterval({
		start: startOfYear(now),
		end: endOfYear(now),
	});
	const data = graphDays.map((date) => {
		const dateKey = formatISO(date, { representation: "date" });
		const count = activityByDate.get(dateKey)?.count ?? 0;

		return {
			date: dateKey,
			count,
			level: Math.min(count, maxLevel),
		};
	});

	return (
		<TooltipProvider>
			<div className="py-4">
				<div className="mb-3 flex items-center justify-between gap-4">
					<span className="text-muted-foreground">Activity</span>
				</div>
				<ContributionGraph className="w-full text-xs" data={data} fontSize={12}>
					<ContributionGraphCalendar>
						{({ activity, dayIndex, weekIndex }) => (
							<Tooltip>
								<TooltipTrigger asChild>
									<g>
										<ContributionGraphBlock
											activity={activity}
											className={cn(
												"cursor-pointer",
												'data-[level="0"]:fill-[#ebedf0] dark:data-[level="0"]:fill-[#212124]',
												'data-[level="1"]:fill-[#ffd6d6] dark:data-[level="1"]:fill-[#3a0f12]',
												'data-[level="2"]:fill-[#ff8a8a] dark:data-[level="2"]:fill-[#6b1118]',
												'data-[level="3"]:fill-[#ff4d4d] dark:data-[level="3"]:fill-[#a3121f]',
												'data-[level="4"]:fill-[#b30000] dark:data-[level="4"]:fill-[#ff2d2d]',
											)}
											dayIndex={dayIndex}
											weekIndex={weekIndex}
										/>
									</g>
								</TooltipTrigger>
								<TooltipContent className="flex flex-col p-1.5 gap-0">
									<p className="font-semibold">{activity.date}</p>
									<p>{activity.count} games</p>
								</TooltipContent>
							</Tooltip>
						)}
					</ContributionGraphCalendar>
					<ContributionGraphFooter>
						<ContributionGraphTotalCount>
							{({ totalCount, year }) => (
								<div className="flex items-center gap-2">
									<span className="text-muted-foreground text-sm">
										Year {year}:
									</span>
									<Badge variant="secondary">
										{totalCount.toLocaleString()} Games
									</Badge>
								</div>
							)}
						</ContributionGraphTotalCount>
						<ContributionGraphLegend>
							{({ level }) => (
								<div
									className="group relative flex h-3 w-3 items-center justify-center"
									data-level={level}
								>
									<div
										className={`h-full w-full rounded-sm border border-border ${
											level === 0 ? "bg-[#ebedf0] dark:bg-[#212124]" : ""
										} ${level === 1 ? "bg-[#ffd6d6] dark:bg-[#3a0f12]" : ""} ${
											level === 2 ? "bg-[#ff8a8a] dark:bg-[#6b1118]" : ""
										} ${level === 3 ? "bg-[#ff4d4d] dark:bg-[#a3121f]" : ""} ${
											level === 4 ? "bg-[#b30000] dark:bg-[#ff2d2d]" : ""
										}`}
									/>
									<span className="-top-8 absolute hidden rounded bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md group-hover:block">
										Level {level}
									</span>
								</div>
							)}
						</ContributionGraphLegend>
					</ContributionGraphFooter>
				</ContributionGraph>
			</div>
		</TooltipProvider>
	);
}

import type { ComponentProps } from "react";
import { Progress } from "@/components/ui/progress";

type ProgressLabelProps = ComponentProps<typeof Progress> & {
	value: number;
};

const ProgressLabel = ({ value, className, ...props }: ProgressLabelProps) => {
	return (
		<div className="relative w-full">
			<Progress value={value} className={className ?? "h-4"} {...props} />
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 flex items-center justify-center font-medium text-primary-foreground text-xs"
			>
				{value}%
			</div>
		</div>
	);
};

export default ProgressLabel;

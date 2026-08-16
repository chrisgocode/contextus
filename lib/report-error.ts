import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";

export function reportClientError(
	err: unknown,
	opts: {
		userMessage: string;
		context?: string;
		tags?: Record<string, string>;
		showToast?: boolean;
	},
): void {
	Sentry.captureException(err, {
		tags: { surface: opts.context ?? "unknown", ...opts.tags },
	});
	if (opts.showToast !== false) toast.error(opts.userMessage);
}

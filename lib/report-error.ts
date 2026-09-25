import * as Sentry from "@sentry/nextjs";
import { toast } from "sonner";
import { expectedClientErrorMessage } from "./client-errors";

export function reportClientError(
  err: unknown,
  opts: {
    userMessage: string;
    context?: string;
    tags?: Record<string, string>;
    showToast?: boolean;
  },
): void {
  const expectedMessage = expectedClientErrorMessage(err, opts.context);
  if (expectedMessage === null)
    Sentry.captureException(err, {
      tags: { surface: opts.context ?? "unknown", ...opts.tags },
    });
  if (opts.showToast !== false)
    toast.error(expectedMessage ?? opts.userMessage);
}

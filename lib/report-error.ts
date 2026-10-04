import { type ErrorContext, expectedClientErrorMessage } from "./client-errors";
import { captureException } from "./sentry-client";
import { lazyToast } from "./toast";

/**
 * Works out what to tell the user about `err`: the message `context` expects
 * for it, or `userMessage`. Unexpected errors go to Sentry. Toasts the
 * message unless `showToast` is false, for callers that show it inline.
 */
export function reportClientError(
  err: unknown,
  opts: {
    userMessage: string;
    context: ErrorContext;
    showToast?: boolean;
  },
): string {
  const expectedMessage = expectedClientErrorMessage(err, opts.context);
  if (expectedMessage === null)
    captureException(err, { tags: { surface: opts.context } });
  const message = expectedMessage ?? opts.userMessage;
  if (opts.showToast !== false) lazyToast((toast) => toast.error(message));
  return message;
}

export type Reported<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

/**
 * Runs a mutation or action, reporting a failure like `reportClientError`
 * with `fallback` as the message for unexpected errors. Callers only show the
 * returned `message`.
 */
export async function runMutation<T>(
  fn: () => Promise<T>,
  opts: { context: ErrorContext; fallback: string; showToast?: boolean },
): Promise<Reported<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (err) {
    const message = reportClientError(err, {
      userMessage: opts.fallback,
      context: opts.context,
      showToast: opts.showToast,
    });
    return { ok: false, message };
  }
}

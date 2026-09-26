type Toast = typeof import("sonner").toast;

/**
 * Shows a toast without putting sonner in the initial bundle. The Toaster
 * loads it right after hydration (see LazyToaster), so by the time anything
 * calls this the import is already resolved.
 */
export function lazyToast(show: (toast: Toast) => void): void {
  void import("sonner").then(({ toast }) => show(toast));
}

// react-day-picker is most of the game setup calendar's weight and only
// hosts between games see it, so it loads separately. This module holds just
// the import so pages can start fetching it early without pulling it in.
export const loadCalendar = () =>
  import("@/components/ui/calendar").then((mod) => mod.Calendar);

export function preloadCalendar() {
  loadCalendar().catch(() => {
    // Best-effort: next/dynamic retries when the calendar actually renders.
  });
}

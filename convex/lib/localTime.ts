// Local calendar time for a player, from an epoch instant and an IANA time
// zone. Day keys are "YYYY-MM-DD" strings, so they sort chronologically.

export const DEFAULT_TIME_ZONE = "UTC";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type LocalTime = {
  dayKey: string;
  minuteOfDay: number;
};

// Returns the canonical IANA name for `timeZone`, or null if the runtime does
// not recognize it.
export function canonicalTimeZone(timeZone: string): string | null {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions()
      .timeZone;
  } catch {
    return null;
  }
}

export function localTime(epochMs: number, timeZone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: canonicalTimeZone(timeZone) ?? DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epochMs);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  return {
    dayKey: `${part("year")}-${part("month")}-${part("day")}`,
    minuteOfDay: Number(part("hour")) * 60 + Number(part("minute")),
  };
}

export function utcDayKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export function addDays(dayKey: string, days: number): string {
  return utcDayKey(Date.parse(`${dayKey}T00:00:00Z`) + days * MS_PER_DAY);
}

// Length of the run of consecutive days in `days` ending on `dayKey`.
export function streakEndingOn(dayKey: string, days: Set<string>): number {
  let streak = 0;
  while (days.has(addDays(dayKey, -streak))) streak += 1;
  return streak;
}

export function longestStreak(days: Set<string>): number {
  let longest = 0;
  for (const day of days) {
    if (days.has(addDays(day, 1))) continue;
    longest = Math.max(longest, streakEndingOn(day, days));
  }
  return longest;
}

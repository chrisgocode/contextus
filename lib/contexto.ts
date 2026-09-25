// Contexto rolls over to the next puzzle at the player's local midnight, so
// the dates here are local calendar days.
const LAUNCH_DAY_UTC = Date.UTC(2022, 8, 19);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function contextoGameIdForDate(d: Date): number {
  const day = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.floor((day - LAUNCH_DAY_UTC) / MS_PER_DAY) + 1;
}

export function launchDate(): Date {
  return new Date(2022, 8, 19);
}

export function todayLocalMidnight(): Date {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

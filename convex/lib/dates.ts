export const LAUNCH_DATE_UTC = Date.UTC(2022, 8, 19);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function contextoGameIdForDate(d: Date): number {
  const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const days = Math.floor((utc - LAUNCH_DATE_UTC) / MS_PER_DAY);
  return days + 1;
}

export function dateForContextoGameId(n: number): Date {
  return new Date(LAUNCH_DATE_UTC + (n - 1) * MS_PER_DAY);
}

const LAUNCH_DATE_UTC = Date.UTC(2022, 8, 19);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function dateForContextoGameId(n: number): Date {
  return new Date(LAUNCH_DATE_UTC + (n - 1) * MS_PER_DAY);
}

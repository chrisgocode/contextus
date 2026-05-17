export const LAUNCH_DATE_UTC = Date.UTC(2022, 8, 19);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function contextoGameIdForDate(d: Date): number {
	const utc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
	return Math.floor((utc - LAUNCH_DATE_UTC) / MS_PER_DAY) + 1;
}

export function dateForContextoGameId(n: number): Date {
	return new Date(LAUNCH_DATE_UTC + (n - 1) * MS_PER_DAY);
}

export function launchDate(): Date {
	return new Date(LAUNCH_DATE_UTC);
}

export function todayLocalMidnight(): Date {
	const n = new Date();
	return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

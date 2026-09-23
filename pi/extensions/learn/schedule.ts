// Spaced-review scheduling. Gaps follow Cepeda et al. (2008): about 1, 11 and 21
// days, then months for skills that must last years.

export const INTERVAL_DAYS = [1, 11, 21, 90, 180] as const;
export type Outcome = "again" | "good" | "easy";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Schedule {
	/** Index into INTERVAL_DAYS of the gap that produced `due`. */
	step: number;
	/** ISO timestamp of the next review. */
	due: string;
}

function at(step: number, now: Date): Schedule {
	return { step, due: new Date(now.getTime() + INTERVAL_DAYS[step] * DAY_MS).toISOString() };
}

/** Schedule for a newly added item: first review one day later. */
export function firstSchedule(now: Date): Schedule {
	return at(0, now);
}

/** Next schedule after a review. `again` restarts, `good` advances one gap, `easy` skips one. */
export function nextSchedule(step: number, outcome: Outcome, now: Date): Schedule {
	const last = INTERVAL_DAYS.length - 1;
	if (outcome === "again") return at(0, now);
	return at(Math.min(step + (outcome === "easy" ? 2 : 1), last), now);
}

export function isDue(due: string, now: Date): boolean {
	return Date.parse(due) <= now.getTime();
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { firstSchedule, isDue, nextSchedule } from "./schedule.ts";

const now = new Date("2026-01-01T00:00:00.000Z");
const days = (iso: string) => (Date.parse(iso) - now.getTime()) / 86_400_000;

test("new items are due one day later", () => {
	const s = firstSchedule(now);
	assert.equal(s.step, 0);
	assert.equal(days(s.due), 1);
});

test("good walks the 1/11/21/90/180 day gaps and stays at the last", () => {
	let step = 0;
	const gaps: number[] = [];
	for (let i = 0; i < 5; i++) {
		const s = nextSchedule(step, "good", now);
		step = s.step;
		gaps.push(days(s.due));
	}
	assert.deepEqual(gaps, [11, 21, 90, 180, 180]);
});

test("again resets to one day, easy skips one step", () => {
	assert.deepEqual(nextSchedule(3, "again", now), { step: 0, due: "2026-01-02T00:00:00.000Z" });
	assert.equal(days(nextSchedule(0, "easy", now).due), 21);
	assert.equal(days(nextSchedule(3, "easy", now).due), 180);
});

test("isDue compares against now", () => {
	assert.equal(isDue("2025-12-31T23:59:59.000Z", now), true);
	assert.equal(isDue(now.toISOString(), now), true);
	assert.equal(isDue("2026-01-01T00:00:01.000Z", now), false);
});

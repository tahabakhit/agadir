// Review queue and learning log, stored outside any session.

import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { firstSchedule, isDue, nextSchedule, type Outcome } from "./schedule.ts";

export interface ReviewItem {
	id: string;
	topic: string;
	prompt: string;
	answer: string;
	misconception?: string;
	created: string;
	step: number;
	due: string;
	reviews: number;
	lastOutcome?: Outcome;
	lastReviewed?: string;
}

export interface ReviewData {
	version: 1;
	items: ReviewItem[];
}

export function learnDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.AGADIR_LEARN_DIR || join(homedir(), ".local", "share", "agadir", "learn");
}

export const reviewsPath = (dir: string) => join(dir, "reviews.json");
export const logPath = (dir: string) => join(dir, "log.md");

export async function loadReviews(dir: string): Promise<ReviewData> {
	const file = reviewsPath(dir);
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, items: [] };
		throw error;
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`${file} is not valid JSON. Fix or move it; it was left untouched.`);
	}
	if (!data || typeof data !== "object" || !Array.isArray((data as ReviewData).items)) {
		throw new Error(`${file} has no "items" array. Fix or move it; it was left untouched.`);
	}
	return data as ReviewData;
}

/** Write via a temp file and rename so a crash never leaves a half-written queue. */
export async function saveReviews(dir: string, data: ReviewData): Promise<void> {
	await mkdir(dir, { recursive: true });
	const file = reviewsPath(dir);
	const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
	await rename(temp, file);
}

export function addItem(
	data: ReviewData,
	input: { topic: string; prompt: string; answer: string; misconception?: string },
	now: Date,
): ReviewItem {
	let id: string;
	do id = `r${randomBytes(3).toString("hex")}`;
	while (data.items.some((item) => item.id === id));
	const item: ReviewItem = {
		id,
		topic: input.topic.trim(),
		prompt: input.prompt.trim(),
		answer: input.answer.trim(),
		...(input.misconception?.trim() ? { misconception: input.misconception.trim() } : {}),
		created: now.toISOString(),
		...firstSchedule(now),
		reviews: 0,
	};
	data.items.push(item);
	return item;
}

export function dueItems(data: ReviewData, now: Date, limit = Infinity): ReviewItem[] {
	return data.items
		.filter((item) => isDue(item.due, now))
		.sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
		.slice(0, limit);
}

export function gradeItem(data: ReviewData, id: string, outcome: Outcome, now: Date): ReviewItem {
	const item = data.items.find((candidate) => candidate.id === id);
	if (!item) throw new Error(`No review item with id "${id}".`);
	Object.assign(item, nextSchedule(item.step, outcome, now), {
		reviews: item.reviews + 1,
		lastOutcome: outcome,
		lastReviewed: now.toISOString(),
	});
	return item;
}

export function listItems(data: ReviewData, topic?: string): ReviewItem[] {
	const needle = topic?.trim().toLowerCase();
	return data.items
		.filter((item) => !needle || item.topic.toLowerCase().includes(needle))
		.sort((a, b) => a.topic.localeCompare(b.topic) || Date.parse(a.due) - Date.parse(b.due));
}

export interface LogEntry {
	topic: string;
	learned: string;
	misconceptions?: string;
	next?: string;
}

export function formatLogEntry(entry: LogEntry, now: Date): string {
	const lines = [`## ${now.toISOString().slice(0, 10)} ${entry.topic.trim()}`, "", `**Learned:** ${entry.learned.trim()}`];
	if (entry.misconceptions?.trim()) lines.push("", `**Misconceptions:** ${entry.misconceptions.trim()}`);
	if (entry.next?.trim()) lines.push("", `**Next:** ${entry.next.trim()}`);
	return `${lines.join("\n")}\n\n`;
}

export async function appendLog(dir: string, entry: LogEntry, now: Date): Promise<string> {
	await mkdir(dir, { recursive: true });
	await appendFile(logPath(dir), formatLogEntry(entry, now));
	return logPath(dir);
}

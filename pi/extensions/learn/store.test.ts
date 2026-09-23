import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { addItem, appendLog, dueItems, gradeItem, learnDir, listItems, loadReviews, reviewsPath, saveReviews } from "./store.ts";

const now = new Date("2026-01-01T00:00:00.000Z");
const later = (d: number) => new Date(now.getTime() + d * 86_400_000);
const tempDir = () => mkdtemp(join(tmpdir(), "learn-store-"));

test("learnDir honours AGADIR_LEARN_DIR", () => {
	assert.equal(learnDir({ AGADIR_LEARN_DIR: "/x" }), "/x");
	assert.match(learnDir({}), /\.local\/share\/agadir\/learn$/);
});

test("missing file loads as an empty queue", async () => {
	assert.deepEqual(await loadReviews(join(await tempDir(), "nope")), { version: 1, items: [] });
});

test("corrupt file is rejected and left untouched", async () => {
	const dir = await tempDir();
	await writeFile(reviewsPath(dir), "{not json");
	await assert.rejects(loadReviews(dir), /not valid JSON/);
	await writeFile(reviewsPath(dir), '{"version":1}');
	await assert.rejects(loadReviews(dir), /no "items" array/);
	assert.equal(await readFile(reviewsPath(dir), "utf8"), '{"version":1}');
});

test("save creates directories, writes atomically and round-trips", async () => {
	const dir = join(await tempDir(), "a", "b");
	const data = { version: 1 as const, items: [] };
	addItem(data, { topic: "Rust", prompt: "What does & borrow?", answer: "A shared reference" }, now);
	await saveReviews(dir, data);
	assert.deepEqual(await readdir(dir), ["reviews.json"]);
	assert.deepEqual(await loadReviews(dir), data);
});

test("due, grade and list", () => {
	const data = { version: 1 as const, items: [] };
	const a = addItem(data, { topic: "Go", prompt: "p1", answer: "a1", misconception: " m " }, now);
	const b = addItem(data, { topic: "Rust", prompt: "p2", answer: "a2" }, later(1));
	assert.equal(a.misconception, "m");
	assert.equal("misconception" in b, false);
	assert.deepEqual(dueItems(data, now), []);
	assert.deepEqual(dueItems(data, later(3)).map((i) => i.id), [a.id, b.id]);
	assert.deepEqual(dueItems(data, later(3), 1).map((i) => i.id), [a.id]);

	const graded = gradeItem(data, a.id, "good", later(1));
	assert.equal(graded.reviews, 1);
	assert.equal(graded.lastOutcome, "good");
	assert.equal(graded.due, later(12).toISOString());
	assert.throws(() => gradeItem(data, "missing", "good", now), /No review item/);

	assert.deepEqual(listItems(data, "rus").map((i) => i.id), [b.id]);
	assert.deepEqual(listItems(data).map((i) => i.topic), ["Go", "Rust"]);
});

test("log appends dated markdown entries", async () => {
	const dir = join(await tempDir(), "new");
	const path = await appendLog(dir, { topic: "Go channels", learned: "Unbuffered sends block", misconceptions: "close wakes senders" }, now);
	await appendLog(dir, { topic: "Go select", learned: "Random choice among ready cases", next: "Timeouts" }, later(1));
	const text = await readFile(path, "utf8");
	assert.match(text, /^## 2026-01-01 Go channels\n\n\*\*Learned:\*\* Unbuffered sends block\n\n\*\*Misconceptions:\*\* close wakes senders\n\n## 2026-01-02 Go select/);
	assert.match(text, /\*\*Next:\*\* Timeouts\n\n$/);
});

test("withReviewLock serializes concurrent updates across callers", async () => {
	const { withReviewLock } = await import("./store.ts");
	const dir = await tempDir();
	await saveReviews(dir, { version: 1, items: [] });
	const now = new Date("2026-01-01T00:00:00Z");
	await Promise.all(
		Array.from({ length: 5 }, (_, i) =>
			withReviewLock(dir, async () => {
				const data = await loadReviews(dir);
				await new Promise((resolve) => setTimeout(resolve, 5));
				addItem(data, { topic: "t", prompt: `p${i}`, answer: "a" }, now);
				await saveReviews(dir, data);
			}),
		),
	);
	assert.equal((await loadReviews(dir)).items.length, 5);
});

test("withReviewLock removes a stale lock", async () => {
	const { withReviewLock } = await import("./store.ts");
	const dir = await tempDir();
	const { mkdir: mk, utimes } = await import("node:fs/promises");
	await mk(join(dir, "reviews.lock"));
	const old = new Date(Date.now() - 60_000);
	await utimes(join(dir, "reviews.lock"), old, old);
	assert.equal(await withReviewLock(dir, async () => "ran"), "ran");
});

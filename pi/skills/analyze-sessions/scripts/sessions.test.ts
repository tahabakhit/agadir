import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { discover, parseWhen, readEntries, summarize, UsageError } from "./lib.ts";

const here = import.meta.dirname;
const fixtures = join(here, "..", "fixtures", "root");
const ROOT = ["--no-default-roots", "--root", fixtures];
const ALL = [...ROOT, "--since", "2026-01-01"];

function run(script: string, args: string[]) {
	const result = spawnSync(process.execPath, [join(here, script), ...args], {
		encoding: "utf8",
		env: { ...process.env, TZ: "UTC" },
	});
	return { code: result.status, out: result.stdout, err: result.stderr };
}

function costJson(args: string[]) {
	const r = run("cost.ts", [...args, "--json"]);
	assert.equal(r.code, 0, r.err);
	return JSON.parse(r.out);
}

describe("lib", () => {
	it("parses relative, date, and ISO windows", () => {
		const now = new Date("2026-03-10T12:00:00Z");
		assert.equal(parseWhen("7d", "--since", false, now).toISOString(), "2026-03-03T12:00:00.000Z");
		assert.equal(parseWhen("2h", "--since", false, now).toISOString(), "2026-03-10T10:00:00.000Z");
		assert.equal(parseWhen("2026-03-01T05:00:00Z", "--since").toISOString(), "2026-03-01T05:00:00.000Z");
		const day = parseWhen("2026-03-01", "--until", true);
		assert.equal(day.getDate(), 2); // --until with a date includes that whole day
		assert.throws(() => parseWhen("yesterday", "--since"), UsageError);
	});

	it("summarizes a session and ignores files without a header", () => {
		const files = discover([fixtures]);
		const summaries = files.map((f) => summarize(f, readEntries(f.file).entries));
		assert.equal(summaries.filter(Boolean).length, 5);
		const junk = files.find((f) => f.file.includes("ffff6666"))!;
		assert.equal(readEntries(junk.file).malformed, 1);
		assert.equal(summarize(junk, readEntries(junk.file).entries), null);

		const a = summaries.find((s) => s?.id.startsWith("aaaa"))!;
		assert.equal(a.name, "Fix login");
		assert.equal(a.kind, "human");
		assert.equal(a.subagent, false);
		assert.equal(a.toolErrors, 1);
		assert.equal(a.toolCalls, 1);
		assert.equal(a.userMessages, 2);
		assert.ok(Math.abs(a.cost.total - 0.75) < 1e-9);

		const kinds = Object.fromEntries(summaries.filter(Boolean).map((s) => [s!.id.slice(0, 4), [s!.kind, s!.subagent]]));
		assert.deepEqual(kinds, {
			aaaa: ["human", false],
			bbbb: ["helper", true], // launched by a subagent tool, flat layout
			cccc: ["human", false],
			dddd: ["human", true], // nested two levels below the root
			eeee: ["memory", false],
		});
	});
});

describe("cost.ts", () => {
	it("totals everything including subagents, with a malformed-line warning", () => {
		const r = run("cost.ts", ALL);
		assert.equal(r.code, 0, r.err);
		assert.match(r.err, /skipped 2 malformed line\(s\) in 2 file\(s\)/);
		assert.match(r.out, /Total cost: \$4\.23/);
		assert.match(r.out, /3 top-level, 2 subagent/);
	});

	it("groups by day chronologically", () => {
		const j = costJson([...ALL, "--by", "day"]);
		assert.deepEqual(
			j.groups.map((g: any) => [g.key, Number(g.cost.toFixed(2)), g.sessions]),
			[
				["2026-01-10", 0.85, 2],
				["2026-01-11", 3.36, 2],
				["2026-01-12", 0.02, 1],
			],
		);
	});

	it("credits each message, usage entry, and compaction to its model", () => {
		const j = costJson([...ALL, "--by", "model"]);
		const byKey = Object.fromEntries(j.groups.map((g: any) => [g.key, Number(g.cost.toFixed(2))]));
		assert.deepEqual(byKey, { "anthropic/claude-x": 2.83, "openai/gpt-z": 1.3, "OpenAI-Codex/gpt-y": 0.1 });
		assert.equal(j.groups[0].key, "anthropic/claude-x"); // sorted by cost
	});

	it("groups by project, respects --limit, and filters by provider case-insensitively", () => {
		const j = costJson([...ALL, "--by", "project", "--limit", "1"]);
		assert.deepEqual(j.groups.map((g: any) => g.key), ["/work/proj-b"]);
		assert.equal(Number(costJson([...ALL, "--provider", "codex"]).total_cost.toFixed(2)), 0.1);
		assert.equal(costJson([...ALL, "--no-subagents"]).total_sessions, 3);
		assert.equal(costJson([...ALL, "--errors-only"]).total_sessions, 1);
		assert.equal(costJson([...ALL, "--cwd", "PROJ-B"]).total_sessions, 2);
	});

	it("defaults to the last 7 days and reports no matches on stderr", () => {
		const r = run("cost.ts", ROOT);
		assert.equal(r.code, 0);
		assert.equal(r.out, "");
		assert.match(r.err, /No sessions matched\./);
	});

	it("keeps only sessions inside a relative --since window", () => {
		const dir = mkdtempSync(join(tmpdir(), "analyze-sessions-"));
		after(() => rmSync(dir, { recursive: true, force: true }));
		mkdirSync(join(dir, "--p--"));
		for (const [id, daysAgo] of [
			["recent", 2],
			["old", 10],
		] as const) {
			const ts = new Date(Date.now() - daysAgo * 86400e3).toISOString();
			const lines = [
				{ type: "session", version: 3, id, timestamp: ts, cwd: "/p" },
				{ type: "message", message: { role: "assistant", model: "m", usage: { cost: { total: 1 } }, content: [] } },
			];
			writeFileSync(join(dir, "--p--", `${id}.jsonl`), lines.map((l) => JSON.stringify(l)).join("\n"));
		}
		const j = costJson(["--no-default-roots", "--root", dir, "--since", "7d"]);
		assert.equal(j.total_sessions, 1);
	});

	it("rejects bad flags cleanly before scanning", () => {
		for (const args of [["--by", "week"], ["--bogus"], ["--since", "soon"], ["--since"], ["--limit", "x"]]) {
			const r = run("cost.ts", [...ROOT, ...args]);
			assert.equal(r.code, 2, args.join(" "));
			assert.match(r.err, /^error: /m);
			assert.doesNotMatch(r.err, /at .*\.ts:\d+/); // no stack trace
		}
	});
});

describe("prompts.ts", () => {
	it("emits only human top-level prompts by default", () => {
		const r = run("prompts.ts", [...ROOT, "--format", "jsonl"]);
		assert.equal(r.code, 0, r.err);
		const rows = r.out.trim().split("\n").map((l) => JSON.parse(l));
		assert.deepEqual(rows.map((p) => p.text).sort(), ["Please fix the login bug", "Write docs for search", "thanks"]);
		assert.deepEqual(Object.keys(rows[0]), ["session_id", "cwd", "timestamp", "text"]);
		assert.match(r.err, /3 prompt\(s\) from 2 session\(s\)/);
	});

	it("drops prompts outside the length bounds and can include generated sessions", () => {
		const short = run("prompts.ts", [...ROOT, "--format", "jsonl", "--min-chars", "10"]);
		assert.equal(short.out.trim().split("\n").length, 2);
		const gen = run("prompts.ts", [...ROOT, "--format", "jsonl", "--include-generated", "--include-subagents"]);
		assert.equal(gen.out.trim().split("\n").length, 6);
	});

	it("renders markdown grouped by project, newest first", () => {
		const r = run("prompts.ts", ROOT);
		assert.ok(r.out.indexOf("## /work/proj-b") < r.out.indexOf("## /work/proj-a"));
		assert.match(r.out, /> Please fix the login bug/);
		assert.equal(run("prompts.ts", [...ROOT, "--format", "csv"]).code, 2);
		assert.match(run("prompts.ts", [...ROOT, "--grep", "nothing-like-this"]).err, /No prompts matched\./);
	});
});

describe("show.ts", () => {
	it("renders metadata and transcript for a session prefix", () => {
		const r = run("show.ts", [...ROOT, "aaaa"]);
		assert.equal(r.code, 0, r.err);
		for (const expected of [
			"# Session aaaa1111-0000: Fix login",
			"**Tool errors:** 1",
			"## User · 12:00",
			"<summary>thinking</summary>",
			"**→ bash** command=ls timeout=10",
			"**← bash (error)**",
			"Fixed the LOGIN flow.",
		]) {
			assert.ok(r.out.includes(expected), expected);
		}
		assert.doesNotMatch(r.err, /sessions matched/);
	});

	it("appends launched and nested subagent transcripts on request", () => {
		assert.match(run("show.ts", [...ROOT, "aaaa", "--include-subagents-content"]).out, /# Subagent bbbb2222/);
		assert.match(run("show.ts", [...ROOT, "cccc", "--include-subagents-content"]).out, /# Subagent dddd4444/);
	});

	it("truncates tool output, omits thinking, and warns on ambiguity", () => {
		const r = run("show.ts", [...ROOT, "aaaa", "--max-tool-output", "2", "--max-thinking=-1"]);
		assert.match(r.out, /bo\n… \[2 more characters\]/);
		assert.doesNotMatch(r.out, /thinking/);
		assert.match(run("show.ts", ROOT).err, /3 sessions matched/);
		const none = run("show.ts", [...ROOT, "--session", "zzz"]);
		assert.equal(none.code, 1);
		assert.match(none.err, /No matching session\./);
	});
});

describe("search.ts", () => {
	it("finds case-insensitive plain matches in user and assistant text", () => {
		const r = run("search.ts", [...ROOT, "login", "--session", "aaaa"]);
		assert.equal(r.code, 0, r.err);
		assert.match(r.out, /\[user line 1\]\n {4}Please fix the login bug/);
		assert.match(r.out, /\[assistant line 1\]/);
		assert.match(r.out, /show\.ts --session aaaa1111-0000-0000-0000-000000000001/);
		assert.match(r.err, /2 match\(es\) in 1 session\(s\)/);
	});

	it("uses smart-case regex, scopes, and thinking hits", () => {
		assert.match(run("search.ts", [...ROOT, "--regex", "LOGIN"]).err, /^1 match/m);
		assert.match(run("search.ts", [...ROOT, "--regex", "log.n"]).err, /^3 match/m);
		assert.match(run("search.ts", [...ROOT, "login", "--in", "user"]).err, /^2 match/m);
		assert.match(run("search.ts", [...ROOT, "token refresh"]).out, /\[thinking line 1\]/);
		assert.match(run("search.ts", [...ROOT, "boom"]).err, /^0 match/m); // tool output is never searched
	});

	it("reports invalid regex and a missing pattern", () => {
		const bad = run("search.ts", [...ROOT, "--regex", "("]);
		assert.equal(bad.code, 2);
		assert.match(bad.err, /invalid regex:/);
		assert.equal(run("search.ts", ROOT).code, 2);
	});
});

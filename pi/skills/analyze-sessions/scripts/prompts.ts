#!/usr/bin/env node
// Extracts the user's own prompts from past sessions, for mining habits and preferences.

import {
	commonHelp,
	intFlag,
	loadSessions,
	localTime,
	oneOf,
	parseCli,
	readEntries,
	runMain,
	shortId,
	textOf,
	tildify,
	toFilters,
	warnMalformed,
} from "./lib.ts";
import type { Session } from "./lib.ts";

const HELP = `Usage: node prompts.ts [--format md|jsonl] [--min-chars N] [--max-chars N] [--include-generated] [filters]

Prints user prompts (text parts only), grouped by project and session. Excludes subagent
transcripts, helper sessions, and memory sessions by default.

  --format F            md (default) or jsonl ({session_id, cwd, timestamp, text} per line)
  --min-chars N         drop prompts shorter than N characters (default 1)
  --max-chars N         drop prompts longer than N characters (default 2000; 0 = no cap)
  --include-generated   keep helper and memory sessions

${commonHelp}
`;

interface Prompt {
	session: Session;
	timestamp: string;
	text: string;
}

function main(): number {
	const { values } = parseCli(process.argv.slice(2), {
		format: { type: "string" },
		"min-chars": { type: "string" },
		"max-chars": { type: "string" },
		"include-generated": { type: "boolean" },
	});
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}
	const format = oneOf(values.format, "--format", ["md", "jsonl"] as const, "md");
	const minChars = intFlag(values["min-chars"], "--min-chars", 1);
	const maxChars = intFlag(values["max-chars"], "--max-chars", 2000);
	const filters = toFilters(values, false);

	const loaded = loadSessions(filters);
	warnMalformed(loaded);
	let sessions = loaded.sessions;
	if (!values["include-generated"]) sessions = sessions.filter((s) => s.kind === "human");
	if (filters.limit) sessions = sessions.slice(0, filters.limit);

	const prompts: Prompt[] = [];
	for (const session of sessions) {
		for (const entry of readEntries(session.file).entries) {
			if (entry.type !== "message" || entry.message?.role !== "user") continue;
			const text = textOf(entry.message.content).trim();
			if (text.length < minChars || (maxChars > 0 && text.length > maxChars)) continue;
			const ts = typeof entry.message.timestamp === "number" ? entry.message.timestamp : entry.timestamp;
			const date = new Date(ts);
			prompts.push({ session, timestamp: Number.isNaN(date.getTime()) ? "" : date.toISOString(), text });
		}
	}
	if (prompts.length === 0) {
		process.stderr.write("No prompts matched.\n");
		return 0;
	}

	const sessionCount = new Set(prompts.map((p) => p.session.id)).size;
	if (format === "jsonl") {
		for (const p of prompts) {
			const row = { session_id: p.session.id, cwd: p.session.cwd, timestamp: p.timestamp, text: p.text };
			process.stdout.write(`${JSON.stringify(row)}\n`);
		}
		process.stderr.write(`${prompts.length} prompt(s) from ${sessionCount} session(s)\n`);
		return 0;
	}

	// Markdown: projects ordered by their most recent session; sessions newest first.
	const byProject = new Map<string, Map<Session, Prompt[]>>();
	for (const p of prompts) {
		const project = byProject.get(p.session.cwd) ?? new Map<Session, Prompt[]>();
		byProject.set(p.session.cwd, project);
		const list = project.get(p.session) ?? [];
		project.set(p.session, list);
		list.push(p);
	}
	const out = ["# User prompts", "", `${prompts.length} prompt(s) from ${sessionCount} session(s) in ${byProject.size} project(s).`];
	for (const [cwd, project] of byProject) {
		out.push("", `## ${tildify(cwd)}`);
		for (const [session, list] of project) {
			out.push("", `### ${localTime(session.start)} · ${shortId(session.id)} · ${list.length} prompt(s)`);
			for (const p of list) out.push("", p.text.split("\n").map((line) => `> ${line}`.trimEnd()).join("\n"));
		}
	}
	process.stdout.write(`${out.join("\n")}\n`);
	return 0;
}

runMain(main);

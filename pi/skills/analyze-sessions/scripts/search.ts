#!/usr/bin/env node
// Full-text search over user and assistant text in past sessions.

import { join } from "node:path";
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
	scriptDir,
	textOf,
	tildify,
	toFilters,
	usd,
	UsageError,
	warnMalformed,
} from "./lib.ts";
import type { Session } from "./lib.ts";

const HELP = `Usage: node search.ts PATTERN [--regex] [--in user|assistant|both] [options] [filters]

Searches user prompts and assistant text/thinking (never tool output). Plain patterns are
case-insensitive substrings; --regex is smart-case (case-sensitive only if it has an uppercase
letter). Excludes subagent transcripts unless --include-subagents. --limit caps sessions shown.

  --regex                       treat PATTERN as a JavaScript regular expression
  --in SCOPE                    user, assistant, or both (default both)
  --context N                   lines of context around each hit (default 1)
  --max-matches-per-session N   default 5
  --snippet-chars N             default 300

${commonHelp}
`;

interface Hit {
	kind: "user" | "assistant" | "thinking";
	line: number;
	snippet: string;
}

function main(): number {
	const { values, positionals } = parseCli(
		process.argv.slice(2),
		{
			regex: { type: "boolean" },
			in: { type: "string" },
			context: { type: "string" },
			"max-matches-per-session": { type: "string" },
			"snippet-chars": { type: "string" },
		},
		true,
	);
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}
	if (positionals.length !== 1) throw new UsageError("expected exactly one PATTERN (quote multi-word patterns)");
	const pattern = positionals[0];
	const scope = oneOf(values.in, "--in", ["user", "assistant", "both"] as const, "both");
	const context = intFlag(values.context, "--context", 1);
	const maxHits = intFlag(values["max-matches-per-session"], "--max-matches-per-session", 5, 1);
	const snippetChars = intFlag(values["snippet-chars"], "--snippet-chars", 300, 20);

	let test: (line: string) => boolean;
	if (values.regex) {
		let re: RegExp;
		try {
			re = new RegExp(pattern, /[A-Z]/.test(pattern) ? "" : "i");
		} catch (error) {
			process.stderr.write(`invalid regex: ${(error as Error).message}\n`);
			return 2;
		}
		test = (line) => re.test(line);
	} else {
		const needle = pattern.toLowerCase();
		test = (line) => line.toLowerCase().includes(needle);
	}
	const filters = toFilters(values, false);
	const loaded = loadSessions(filters);
	warnMalformed(loaded);

	const results: { session: Session; hits: Hit[]; more: boolean }[] = [];
	let totalHits = 0;
	let searched = 0;
	for (const session of loaded.sessions) {
		if (filters.limit && results.length >= filters.limit) break;
		searched++;
		const hits: Hit[] = [];
		let more = false;
		scan: for (const entry of readEntries(session.file).entries) {
			const msg = entry.type === "message" ? entry.message : null;
			if (!msg) continue;
			const blocks: { kind: Hit["kind"]; text: string }[] = [];
			if (msg.role === "user" && scope !== "assistant") blocks.push({ kind: "user", text: textOf(msg.content) });
			if (msg.role === "assistant" && scope !== "user") {
				blocks.push({ kind: "assistant", text: textOf(msg.content) }, { kind: "thinking", text: textOf(msg.content, ["thinking"]) });
			}
			for (const { kind, text } of blocks) {
				if (!text) continue;
				const lines = text.split("\n");
				for (let i = 0; i < lines.length; i++) {
					if (!test(lines[i])) continue;
					if (hits.length >= maxHits) {
						more = true;
						break scan;
					}
					let snippet = lines.slice(Math.max(0, i - context), i + context + 1).join("\n").trim();
					if (snippet.length > snippetChars) snippet = `${snippet.slice(0, snippetChars - 1)}…`;
					hits.push({ kind, line: i + 1, snippet });
				}
			}
		}
		if (hits.length) {
			results.push({ session, hits, more });
			totalHits += hits.length;
		}
	}

	const showScript = join(scriptDir, "show.ts");
	const out: string[] = [];
	for (const { session, hits, more } of results) {
		out.push(
			`## ${localTime(session.start)} · ${shortId(session.id)} · ${usd(session.cost.total)} · ${tildify(session.cwd)}`,
			`node ${showScript} --session ${session.id}`,
		);
		for (const hit of hits) {
			out.push(`- [${hit.kind} line ${hit.line}]`, ...hit.snippet.split("\n").map((l) => `    ${l}`));
		}
		if (more) out.push(`- … more matches (raise --max-matches-per-session)`);
		out.push("");
	}
	if (out.length) process.stdout.write(out.join("\n"));
	process.stderr.write(`${totalHits} match(es) in ${results.length} session(s); ${searched} session(s) searched\n`);
	return 0;
}

runMain(main);

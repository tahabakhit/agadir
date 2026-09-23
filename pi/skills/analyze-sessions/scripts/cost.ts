#!/usr/bin/env node
// Spend report for past Pi sessions, grouped by day, project, model, session, root, or total.

import {
	commonHelp,
	count,
	localDay,
	localTime,
	loadSessions,
	oneLine,
	oneOf,
	parseCli,
	runMain,
	table,
	tildify,
	toFilters,
	usd,
	warnMalformed,
} from "./lib.ts";
import type { Session } from "./lib.ts";

const GROUPINGS = ["day", "project", "model", "session", "root", "total"] as const;
type Grouping = (typeof GROUPINGS)[number];

const HELP = `Usage: node cost.ts [--by day|project|model|session|root|total] [--json] [--show-subagents] [filters]

Sums assistant, tool, compaction, and usage-entry cost. Includes subagent transcripts by default.
Without --since/--until/--session the window is the last 7 days.

  --by G              grouping (default day; day rows are chronological and never limited)
  --json              machine-readable output
  --show-subagents    add a column with the subagent share of each group

${commonHelp}
`;

interface Group {
	key: string;
	cost: number;
	sessions: number;
	messages: number;
	errors: number;
	sub_cost: number;
	sub_sessions: number;
}

function groupSessions(sessions: Session[], by: Grouping): Group[] {
	const groups = new Map<string, Group>();
	const add = (key: string, s: Session, cost: number, messages: number, errors: number) => {
		let g = groups.get(key);
		if (!g) {
			g = { key, cost: 0, sessions: 0, messages: 0, errors: 0, sub_cost: 0, sub_sessions: 0 };
			groups.set(key, g);
		}
		g.cost += cost;
		g.sessions++;
		g.messages += messages;
		g.errors += errors;
		if (s.subagent) {
			g.sub_cost += cost;
			g.sub_sessions++;
		}
	};
	for (const s of sessions) {
		const messages = s.userMessages + s.assistantMessages;
		if (by === "model") {
			if (s.byModel.size === 0) add("(no model)", s, s.cost.total, messages, s.toolErrors);
			for (const [model, usage] of s.byModel) add(model, s, usage.cost, usage.messages, usage.errors);
			continue;
		}
		const key =
			by === "day"
				? localDay(s.start)
				: by === "project"
					? tildify(s.cwd)
					: by === "session"
						? `${s.id}  ${oneLine(s.name || s.firstPrompt, 50)}`
						: by === "root"
							? tildify(s.root)
							: "total";
		add(key, s, s.cost.total, messages, s.toolErrors);
	}
	const list = [...groups.values()];
	if (by === "day") list.sort((a, b) => a.key.localeCompare(b.key));
	else list.sort((a, b) => b.cost - a.cost);
	return list;
}

function main(): number {
	const { values } = parseCli(process.argv.slice(2), {
		by: { type: "string" },
		json: { type: "boolean" },
		"show-subagents": { type: "boolean" },
	});
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}
	const by = oneOf(values.by, "--by", GROUPINGS, "day");
	const filters = toFilters(values, true);
	if (!filters.since && !filters.until && !filters.session) filters.since = new Date(Date.now() - 7 * 86400e3);

	const loaded = loadSessions(filters);
	warnMalformed(loaded);
	const sessions = loaded.sessions;
	if (sessions.length === 0) {
		process.stderr.write("No sessions matched.\n");
		return 0;
	}

	let groups = groupSessions(sessions, by);
	if (by !== "day" && filters.limit) groups = groups.slice(0, filters.limit);
	const total = sessions.reduce((sum, s) => sum + s.cost.total, 0);
	const subagents = sessions.filter((s) => s.subagent).length;

	if (values.json) {
		const out = {
			grouping: by,
			since: filters.since?.toISOString() ?? null,
			until: filters.until?.toISOString() ?? null,
			total_cost: total,
			total_sessions: sessions.length,
			subagent_sessions: subagents,
			groups: by === "total" ? [] : groups,
		};
		process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
		return 0;
	}

	const sum = (pick: (s: Session) => number) => sessions.reduce((acc, s) => acc + pick(s), 0);
	const window = `${filters.since ? localTime(filters.since) : "beginning"} → ${filters.until ? localTime(filters.until) : "now"}`;
	const lines = [
		`Total cost: ${usd(total)}`,
		`Sessions:   ${sessions.length - subagents} top-level, ${subagents} subagent`,
		`Cache:      read ${usd(sum((s) => s.cost.cacheRead))}, write ${usd(sum((s) => s.cost.cacheWrite))}`,
		`Tokens:     ${count(sum((s) => s.tokens.input))} input, ${count(sum((s) => s.tokens.output))} output, ${count(sum((s) => s.tokens.cacheRead))} cache read`,
		`Window:     ${window}`,
	];
	if (by !== "total") {
		const showSub = Boolean(values["show-subagents"]);
		const headers = [by, "cost", "sessions", "messages", "errors", ...(showSub ? ["subagent cost"] : [])];
		const rows = groups.map((g) => [
			g.key,
			usd(g.cost),
			String(g.sessions),
			count(g.messages),
			String(g.errors),
			...(showSub ? [usd(g.sub_cost)] : []),
		]);
		lines.push("", table(headers, rows, [false, true, true, true, true, true]));
	}
	process.stdout.write(`${lines.join("\n")}\n`);
	return 0;
}

runMain(main);

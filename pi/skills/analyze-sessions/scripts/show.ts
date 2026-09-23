#!/usr/bin/env node
// Renders one past session as a readable Markdown transcript.

import {
	commonHelp,
	count,
	duration,
	intFlag,
	loadSessions,
	localTime,
	parseCli,
	readEntries,
	runMain,
	shortId,
	textOf,
	tildify,
	toFilters,
	UsageError,
	usd,
	warnMalformed,
} from "./lib.ts";
import type { Json, Session } from "./lib.ts";

const HELP = `Usage: node show.ts [ID] [--session ID] [--latest] [limits] [filters]

Renders the newest matching session (metadata, then the transcript). A positional ID is the
same as --session. Excludes subagent transcripts from matching unless --include-subagents.

  --latest                      render the newest match without the ambiguity warning
  --max-tool-output N           characters per tool result (default 2000; 0 = no cap)
  --max-thinking N              characters per thinking block (default 600; 0 = no cap; --max-thinking=-1 omits)
  --max-assistant-text N        characters per assistant text block (default 4000; 0 = no cap)
  --include-subagents-content   append transcripts of subagents launched by this session

${commonHelp}
`;

function clip(text: string, max: number): string {
	if (max <= 0 || text.length <= max) return text;
	return `${text.slice(0, max)}\n… [${count(text.length - max)} more characters]`;
}

function fence(text: string): string {
	const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
	const f = "`".repeat(longest + 1);
	return `${f}\n${text}\n${f}`;
}

function argSummary(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	const parts = Object.entries(args as Json)
		.slice(0, 3)
		.map(([k, v]) => {
			const value = typeof v === "string" ? v : JSON.stringify(v);
			const flat = String(value).replace(/\s+/g, " ").trim();
			return `${k}=${flat.length > 80 ? `${flat.slice(0, 79)}…` : flat}`;
		});
	return parts.join(" ");
}

interface Limits {
	tool: number;
	thinking: number;
	text: number;
}

function renderMetadata(s: Session): string[] {
	const out = [
		`- **Session:** \`${s.id}\`${s.name ? ` — ${s.name}` : ""}`,
		`- **File:** ${tildify(s.file)}`,
		`- **Cwd:** ${tildify(s.cwd)}`,
		`- **Started:** ${localTime(s.start)}`,
	];
	if (s.start && s.lastActivity) out.push(`- **Duration:** ${duration(s.lastActivity.getTime() - s.start.getTime())}`);
	out.push(
		`- **Models:** ${s.models.join(", ") || "(none)"}`,
		`- **Messages:** ${s.userMessages} user, ${s.assistantMessages} assistant, ${s.toolResults} tool results (${s.toolCalls} tool calls)`,
		`- **Cost:** ${usd(s.cost.total)} (input ${usd(s.cost.input)}, output ${usd(s.cost.output)}, cache read ${usd(s.cost.cacheRead)}, cache write ${usd(s.cost.cacheWrite)})`,
		`- **Tokens:** ${count(s.tokens.input)} input, ${count(s.tokens.output)} output, ${count(s.tokens.cacheRead)} cache read, ${count(s.tokens.cacheWrite)} cache write`,
	);
	if (s.subagent) out.push(`- **Subagent of:** \`${s.parentId ?? "unknown"}\``);
	if (s.toolErrors) out.push(`- **Tool errors:** ${s.toolErrors}`);
	return out;
}

function renderTranscript(entries: Json[], limits: Limits): string[] {
	const out: string[] = [];
	const time = (ms: unknown, iso: unknown) => {
		const d = new Date(typeof ms === "number" ? ms : String(iso));
		return Number.isNaN(d.getTime()) ? "" : localTime(d).slice(11);
	};
	for (const entry of entries) {
		if (entry.type === "model_change") {
			out.push("", `> _Model changed to ${entry.provider ? `${entry.provider}/` : ""}${entry.modelId}_`);
		} else if (entry.type === "compaction") {
			out.push("", `> _Context compacted (${count(entry.tokensBefore ?? 0)} tokens summarized)_`);
		} else if (entry.type === "branch_summary") {
			out.push("", "> _Switched branch; summary of abandoned branch:_", "", clip(String(entry.summary ?? ""), limits.text));
		} else if (entry.type === "message") {
			const msg = entry.message ?? {};
			if (msg.role === "user") {
				out.push("", `## User · ${time(msg.timestamp, entry.timestamp)}`, "", textOf(msg.content) || "_(no text)_");
			} else if (msg.role === "assistant") {
				const model = msg.model ? `${msg.model}` : "assistant";
				const cost = msg.usage?.cost?.total;
				out.push("", `## Assistant · ${model} · ${time(msg.timestamp, entry.timestamp)}${typeof cost === "number" ? ` · ${usd(cost)}` : ""}`);
				for (const block of Array.isArray(msg.content) ? msg.content : []) {
					if (block?.type === "thinking" && limits.thinking >= 0 && block.thinking?.trim()) {
						out.push("", "<details><summary>thinking</summary>", "", clip(block.thinking.trim(), limits.thinking), "", "</details>");
					} else if (block?.type === "text" && block.text?.trim()) {
						out.push("", clip(block.text.trim(), limits.text));
					} else if (block?.type === "toolCall") {
						out.push("", `**→ ${block.name}** ${argSummary(block.arguments)}`.trimEnd());
					}
				}
				if (msg.errorMessage) out.push("", `> _Error: ${msg.errorMessage}_`);
			} else if (msg.role === "toolResult") {
				const text = textOf(msg.content);
				out.push("", `**← ${msg.toolName ?? "tool"}${msg.isError ? " (error)" : ""}**`, "", fence(clip(text || "(no text output)", limits.tool)));
			}
		}
	}
	return out;
}

function main(): number {
	const { values, positionals } = parseCli(
		process.argv.slice(2),
		{
			latest: { type: "boolean" },
			"max-tool-output": { type: "string" },
			"max-thinking": { type: "string" },
			"max-assistant-text": { type: "string" },
			"include-subagents-content": { type: "boolean" },
		},
		true,
	);
	if (values.help) {
		process.stdout.write(HELP);
		return 0;
	}
	if (positionals.length > 1) throw new UsageError("expected at most one session id");
	if (positionals[0]) {
		if (values.session && values.session !== positionals[0]) throw new UsageError("pass the session id once");
		values.session = positionals[0];
	}
	const limits: Limits = {
		tool: intFlag(values["max-tool-output"], "--max-tool-output", 2000),
		thinking: intFlag(values["max-thinking"], "--max-thinking", 600, -1),
		text: intFlag(values["max-assistant-text"], "--max-assistant-text", 4000),
	};
	const filters = toFilters(values, false);

	const loaded = loadSessions(filters);
	warnMalformed(loaded);
	const [target] = loaded.sessions;
	if (!target) {
		process.stderr.write("No matching session.\n");
		return 1;
	}
	if (loaded.sessions.length > 1 && !values.latest && !values.session) {
		process.stderr.write(
			`warning: ${loaded.sessions.length} sessions matched; showing the newest (${shortId(target.id)}). Use --session or --latest.\n`,
		);
	}

	const out = [`# Session ${shortId(target.id)}: ${target.name || target.firstPrompt.split("\n")[0].slice(0, 80) || "(untitled)"}`, ""];
	out.push(...renderMetadata(target), "", "---", ...renderTranscript(readEntries(target.file).entries, limits));

	if (values["include-subagents-content"]) {
		// Children start after the parent, so only files from then on need reading.
		const all = loadSessions({ ...filters, since: target.start ?? undefined, until: undefined, session: undefined, subagents: true });
		const children = all.all
			.filter((s) => s.subagent && s.parentId && target.id.startsWith(s.parentId))
			.sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
		for (const child of children) {
			out.push("", "---", "", `# Subagent ${shortId(child.id)}: ${child.name || "(untitled)"}`, "", ...renderMetadata(child));
			out.push(...renderTranscript(readEntries(child.file).entries, limits));
		}
		if (children.length === 0) out.push("", "_No subagent transcripts found for this session._");
	}
	process.stdout.write(`${out.join("\n")}\n`);
	return 0;
}

runMain(main);

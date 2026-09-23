// Shared session loading, filtering, and formatting for the analyze-sessions scripts.
// Read-only: nothing here writes to disk. Standard library only.

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, sep } from "node:path";
import { parseArgs } from "node:util";
import type { ParseArgsConfig } from "node:util";

// ---------------------------------------------------------------------------
// Types

export type Json = Record<string, any>;

export interface Money {
	total: number;
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface Tokens {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export interface ModelUsage {
	cost: number;
	messages: number;
	errors: number;
}

export type SessionKind = "human" | "helper" | "memory";

export interface Session {
	id: string;
	file: string;
	root: string;
	cwd: string;
	name: string;
	kind: SessionKind;
	subagent: boolean;
	parentId: string | null;
	start: Date | null;
	lastActivity: Date | null;
	models: string[];
	providers: string[];
	userMessages: number;
	assistantMessages: number;
	toolResults: number;
	toolErrors: number;
	toolCalls: number;
	cost: Money;
	tokens: Tokens;
	byModel: Map<string, ModelUsage>;
	firstPrompt: string;
	userText: string;
}

export interface ReadResult {
	entries: Json[];
	malformed: number;
}

// ---------------------------------------------------------------------------
// Errors and small helpers

export class UsageError extends Error {}

export function fail(message: string, code = 2): never {
	process.stderr.write(`error: ${message}\n`);
	process.exit(code);
}

/** Runs a CLI main function, turning UsageError into a clean `error:` line and exit 2. */
export function runMain(main: () => number | void): void {
	try {
		const code = main();
		if (typeof code === "number" && code !== 0) process.exitCode = code;
	} catch (error) {
		if (error instanceof UsageError || (error as { code?: string })?.code?.startsWith?.("ERR_PARSE_ARGS")) {
			fail((error as Error).message);
		}
		throw error;
	}
}

const emptyMoney = (): Money => ({ total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
const emptyTokens = (): Tokens => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

export function textOf(content: unknown, types: string[] = ["text"]): string {
	if (typeof content === "string") return types.includes("text") ? content : "";
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object" || !types.includes(block.type)) continue;
		const value = block.type === "thinking" ? block.thinking : block.text;
		if (typeof value === "string") parts.push(value);
	}
	return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Roots and discovery

export function defaultRoots(): string[] {
	const roots = [process.env.PI_CODING_AGENT_SESSION_DIR || join(homedir(), ".pi", "agent", "sessions")];
	const learn = join(homedir(), ".pi", "learn", "sessions");
	if (existsSync(learn)) roots.push(learn);
	return roots;
}

export interface DiscoveredFile {
	file: string;
	root: string;
	/** Directory levels between the root and the file (0 = directly in root). */
	depth: number;
	/** First directory below the root, or "" for files directly in it. */
	topDir: string;
}

export function discover(roots: string[]): DiscoveredFile[] {
	const seen = new Set<string>();
	const found: DiscoveredFile[] = [];
	for (const root of roots) {
		if (!existsSync(root)) continue;
		const walk = (dir: string) => {
			let names: string[];
			try {
				names = readdirSync(dir);
			} catch {
				return;
			}
			for (const name of names) {
				const path = join(dir, name);
				let stat;
				try {
					stat = statSync(path);
				} catch {
					continue;
				}
				if (stat.isDirectory()) walk(path);
				else if (name.endsWith(".jsonl")) {
					let real = path;
					try {
						real = realpathSync(path);
					} catch {}
					if (seen.has(real)) continue;
					seen.add(real);
					const parts = relative(root, path).split(sep);
					found.push({ file: path, root, depth: parts.length - 1, topDir: parts.length > 1 ? parts[0] : "" });
				}
			}
		};
		walk(root);
	}
	return found;
}

/** Start time encoded in Pi's `<ISO-with-dashes>_<id>.jsonl` file names, if present. */
export function fileNameTime(file: string): Date | null {
	const m = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/.exec(basename(file));
	if (!m) return null;
	const date = new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`);
	return Number.isNaN(date.getTime()) ? null : date;
}

function fileNameId(file: string): string | null {
	const m = /_([^_]+)\.jsonl$/.exec(basename(file));
	return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Parsing

export function readEntries(file: string): ReadResult {
	let raw: string;
	try {
		raw = readFileSync(file, "utf8");
	} catch {
		return { entries: [], malformed: 1 };
	}
	const entries: Json[] = [];
	let malformed = 0;
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			const value = JSON.parse(line);
			if (value && typeof value === "object" && !Array.isArray(value)) entries.push(value);
			else malformed++;
		} catch {
			malformed++;
		}
	}
	return { entries, malformed };
}

const HELPER_NAME = /^\[[a-z][a-z0-9-]*\]/;
const LAUNCH_METADATA = /(^|[_.:-])launch[_.-]?metadata$/;

function classify(name: string, cwd: string, launched: boolean): SessionKind {
	if (name.startsWith("om-") || /[\\/]\.memory([\\/-]|$)/.test(cwd)) return "memory";
	if (launched || HELPER_NAME.test(name)) return "helper";
	return "human";
}

function addUsage(session: Session, usage: Json | undefined, model: string, countMessage: boolean): void {
	if (!usage || typeof usage !== "object") return;
	const cost = usage.cost ?? {};
	const total = num(cost.total) || num(cost.input) + num(cost.output) + num(cost.cacheRead) + num(cost.cacheWrite);
	session.cost.total += total;
	session.cost.input += num(cost.input);
	session.cost.output += num(cost.output);
	session.cost.cacheRead += num(cost.cacheRead);
	session.cost.cacheWrite += num(cost.cacheWrite);
	session.tokens.input += num(usage.input);
	session.tokens.output += num(usage.output);
	session.tokens.cacheRead += num(usage.cacheRead);
	session.tokens.cacheWrite += num(usage.cacheWrite);
	session.tokens.total +=
		num(usage.totalTokens) || num(usage.input) + num(usage.output) + num(usage.cacheRead) + num(usage.cacheWrite);
	const slot = modelSlot(session, model);
	slot.cost += total;
	if (countMessage) slot.messages++;
}

function modelSlot(session: Session, model: string): ModelUsage {
	let slot = session.byModel.get(model);
	if (!slot) {
		slot = { cost: 0, messages: 0, errors: 0 };
		session.byModel.set(model, slot);
	}
	return slot;
}

const modelKey = (provider: unknown, model: unknown): string =>
	typeof model === "string" && model ? (typeof provider === "string" && provider ? `${provider}/${model}` : model) : "";

/** Builds a summary from parsed entries. Returns null when there is no session header with an id. */
export function summarize(file: DiscoveredFile, entries: Json[]): Session | null {
	const header = entries.find((e) => e.type === "session");
	if (!header || typeof header.id !== "string" || !header.id) return null;
	const cwd = typeof header.cwd === "string" ? header.cwd : "";
	const start = parseTime(header.timestamp) ?? fileNameTime(file.file);
	const session: Session = {
		id: header.id,
		file: file.file,
		root: file.root,
		cwd,
		name: typeof header.name === "string" ? header.name : "",
		kind: "human",
		subagent: file.depth > 1,
		parentId: null,
		start,
		lastActivity: start,
		models: [],
		providers: [],
		userMessages: 0,
		assistantMessages: 0,
		toolResults: 0,
		toolErrors: 0,
		toolCalls: 0,
		cost: emptyMoney(),
		tokens: emptyTokens(),
		byModel: new Map(),
		firstPrompt: "",
		userText: "",
	};
	const models = new Set<string>();
	const providers = new Set<string>();
	const userTexts: string[] = [];
	let current = "";
	let launched = false;
	const note = (provider: unknown, model: unknown) => {
		const key = modelKey(provider, model);
		if (!key) return;
		current = key;
		if (typeof model === "string") models.add(model);
		if (typeof provider === "string" && provider) providers.add(provider);
	};
	const touch = (value: unknown) => {
		const t = typeof value === "number" ? new Date(value) : parseTime(value);
		if (t && !Number.isNaN(t.getTime()) && (!session.lastActivity || t > session.lastActivity)) session.lastActivity = t;
	};

	for (const entry of entries) {
		switch (entry.type) {
			case "model_change":
				note(entry.provider, entry.modelId);
				break;
			case "session_info":
				if (typeof entry.name === "string") session.name = entry.name;
				break;
			case "custom":
				if (typeof entry.customType === "string" && LAUNCH_METADATA.test(entry.customType)) launched = true;
				break;
			case "usage":
				addUsage(session, entry.usage, modelKey(entry.provider, entry.model) || current || "(unknown)", false);
				break;
			case "compaction":
			case "branch_summary":
				addUsage(session, entry.usage, current || "(unknown)", false);
				break;
			case "message": {
				const msg = entry.message;
				if (!msg || typeof msg !== "object") break;
				touch(msg.timestamp);
				if (msg.role === "user") {
					session.userMessages++;
					const text = textOf(msg.content);
					if (text) {
						if (!session.firstPrompt) session.firstPrompt = text;
						userTexts.push(text);
					}
				} else if (msg.role === "assistant") {
					session.assistantMessages++;
					note(msg.provider, msg.model);
					if (Array.isArray(msg.content)) session.toolCalls += msg.content.filter((b: Json) => b?.type === "toolCall").length;
					addUsage(session, msg.usage, modelKey(msg.provider, msg.model) || current || "(unknown)", true);
				} else if (msg.role === "toolResult") {
					session.toolResults++;
					if (msg.isError === true) {
						session.toolErrors++;
						modelSlot(session, current || "(unknown)").errors++;
					}
					addUsage(session, msg.usage, current || "(unknown)", false);
				}
				break;
			}
		}
	}

	session.models = [...models];
	session.providers = [...providers];
	session.userText = userTexts.join("\n\n");
	session.kind = classify(session.name, cwd, launched);
	if (session.subagent) {
		session.parentId = file.topDir.includes("_") ? file.topDir.slice(file.topDir.lastIndexOf("_") + 1) : file.topDir;
	} else if (launched) {
		session.subagent = true;
		session.parentId = typeof header.parentSession === "string" ? header.parentSession : null;
	}
	return session;
}

function parseTime(value: unknown): Date | null {
	if (typeof value !== "string" && typeof value !== "number") return null;
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? null : date;
}

// ---------------------------------------------------------------------------
// Time windows

/** Parses `7d`, `2w`, `12h`, `30m` (minutes), `YYYY-MM-DD` (local), or an ISO datetime. */
export function parseWhen(value: string, flag: string, endOfDay = false, now = new Date()): Date {
	const rel = /^(\d+)([dwhm])$/.exec(value.trim());
	if (rel) {
		const unit = { m: 60e3, h: 3600e3, d: 86400e3, w: 7 * 86400e3 }[rel[2] as "m" | "h" | "d" | "w"];
		return new Date(now.getTime() - Number(rel[1]) * unit);
	}
	const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
	if (day) {
		const date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
		if (!Number.isNaN(date.getTime())) {
			if (endOfDay) date.setDate(date.getDate() + 1);
			return date;
		}
	}
	const date = new Date(value);
	if (!value.trim() || Number.isNaN(date.getTime())) {
		throw new UsageError(`${flag}: cannot parse "${value}" (use 7d, 12h, 2w, 30m, YYYY-MM-DD, or an ISO datetime)`);
	}
	return date;
}

// ---------------------------------------------------------------------------
// CLI options

export const commonOptions = {
	root: { type: "string", multiple: true },
	"no-default-roots": { type: "boolean" },
	since: { type: "string" },
	until: { type: "string" },
	cwd: { type: "string", multiple: true },
	model: { type: "string", multiple: true },
	provider: { type: "string", multiple: true },
	session: { type: "string" },
	"include-subagents": { type: "boolean" },
	"no-subagents": { type: "boolean" },
	limit: { type: "string" },
	"min-cost": { type: "string" },
	"min-messages": { type: "string" },
	"errors-only": { type: "boolean" },
	grep: { type: "string" },
	help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsConfig["options"];

export const commonHelp = `Filters (shared):
  --since W / --until W   7d, 12h, 2w, 30m, YYYY-MM-DD (local; --until includes that day), or ISO time
  --cwd S                 cwd contains S (case-insensitive; repeatable, any match)
  --model S               a model id contains S (repeatable)
  --provider S            a provider id contains S (repeatable)
  --session ID            session id or id prefix
  --include-subagents     include nested/launched helper transcripts
  --no-subagents          exclude them
  --limit N               cap results (newest first)
  --min-cost USD          drop sessions cheaper than USD
  --min-messages N        drop sessions with fewer user+assistant messages
  --errors-only           keep sessions with at least one failed tool result
  --grep S                user prompts contain S (case-insensitive)
Roots:
  --root DIR              extra session root (repeatable)
  --no-default-roots      scan only --root dirs (defaults: $PI_CODING_AGENT_SESSION_DIR or
                          ~/.pi/agent/sessions, plus ~/.pi/learn/sessions if present)`;

export function parseCli<T extends ParseArgsConfig["options"]>(argv: string[], extra: T, allowPositionals = false) {
	return parseArgs({
		args: argv,
		options: { ...commonOptions, ...extra },
		allowPositionals,
		strict: true,
	});
}

export function intFlag(value: string | undefined, flag: string, fallback: number, min = 0): number {
	if (value === undefined) return fallback;
	const n = Number(value);
	if (!Number.isInteger(n) || n < min) throw new UsageError(`${flag} expects an integer >= ${min}, got "${value}"`);
	return n;
}

export function numFlag(value: string | undefined, flag: string): number | undefined {
	if (value === undefined) return undefined;
	const n = Number(value);
	if (!Number.isFinite(n)) throw new UsageError(`${flag} expects a number, got "${value}"`);
	return n;
}

export function oneOf<T extends string>(value: string | undefined, flag: string, choices: readonly T[], fallback: T): T {
	if (value === undefined) return fallback;
	if (!(choices as readonly string[]).includes(value)) {
		throw new UsageError(`${flag} must be one of ${choices.join(", ")}; got "${value}"`);
	}
	return value as T;
}

export interface Filters {
	roots: string[];
	since?: Date;
	until?: Date;
	cwd: string[];
	model: string[];
	provider: string[];
	session?: string;
	subagents: boolean;
	limit?: number;
	minCost?: number;
	minMessages?: number;
	errorsOnly: boolean;
	grep?: string;
}

/** Converts parsed flags into Filters. `subagentsDefault` is the script's default. */
export function toFilters(values: Json, subagentsDefault: boolean): Filters {
	if (values["include-subagents"] && values["no-subagents"]) {
		throw new UsageError("--include-subagents and --no-subagents are mutually exclusive");
	}
	const roots = [...(values["no-default-roots"] ? [] : defaultRoots()), ...(values.root ?? [])];
	if (roots.length === 0) throw new UsageError("no session roots: pass --root DIR");
	return {
		roots,
		since: values.since !== undefined ? parseWhen(values.since, "--since") : undefined,
		until: values.until !== undefined ? parseWhen(values.until, "--until", true) : undefined,
		cwd: (values.cwd ?? []).map((s: string) => s.toLowerCase()),
		model: (values.model ?? []).map((s: string) => s.toLowerCase()),
		provider: (values.provider ?? []).map((s: string) => s.toLowerCase()),
		session: values.session,
		// An explicit --session id may name a subagent transcript, so it is not hidden by default.
		subagents: values["include-subagents"] ? true : values["no-subagents"] ? false : values.session ? true : subagentsDefault,
		limit: values.limit !== undefined ? intFlag(values.limit, "--limit", 0, 1) : undefined,
		minCost: numFlag(values["min-cost"], "--min-cost"),
		minMessages: values["min-messages"] !== undefined ? intFlag(values["min-messages"], "--min-messages", 0) : undefined,
		errorsOnly: Boolean(values["errors-only"]),
		grep: values.grep?.toLowerCase(),
	};
}

// ---------------------------------------------------------------------------
// Loading

export interface Loaded {
	sessions: Session[];
	/** Every summary that was parsed, before filters (used to resolve parents). */
	all: Session[];
	malformedLines: number;
	malformedFiles: number;
	scanned: number;
}

const SLACK_MS = 10 * 60e3;

/** Loads, filters, and sorts sessions newest first. `limit` is NOT applied here. */
export function loadSessions(filters: Filters, options: { skipByFileName?: boolean } = {}): Loaded {
	const files = discover(filters.roots);
	const all: Session[] = [];
	let malformedLines = 0;
	let malformedFiles = 0;
	for (const file of files) {
		if (options.skipByFileName !== false) {
			const t = fileNameTime(file.file);
			if (t && filters.since && t.getTime() < filters.since.getTime() - SLACK_MS) continue;
			if (t && filters.until && t.getTime() > filters.until.getTime() + SLACK_MS) continue;
		}
		const { entries, malformed } = readEntries(file.file);
		if (malformed) {
			malformedLines += malformed;
			malformedFiles++;
		}
		const session = summarize(file, entries);
		if (session) all.push(session);
	}
	resolveParents(all);
	const sessions = all.filter((s) => matches(s, filters)).sort(newestFirst);
	return { sessions, all, malformedLines, malformedFiles, scanned: files.length };
}

/** Rewrites parentSession file paths into parent session ids where possible. */
function resolveParents(sessions: Session[]): void {
	const byFile = new Map<string, string>();
	for (const s of sessions) byFile.set(s.file, s.id);
	for (const s of sessions) {
		if (!s.parentId || !s.parentId.endsWith(".jsonl")) continue;
		s.parentId = byFile.get(s.parentId) ?? fileNameId(s.parentId) ?? s.parentId;
	}
}

export function newestFirst(a: Session, b: Session): number {
	return (b.start?.getTime() ?? 0) - (a.start?.getTime() ?? 0);
}

export function matches(s: Session, f: Filters): boolean {
	if (!f.subagents && s.subagent) return false;
	if (s.start && f.since && s.start < f.since) return false;
	if (s.start && f.until && s.start >= f.until) return false;
	if (f.session && !s.id.startsWith(f.session)) return false;
	const cwd = s.cwd.toLowerCase();
	if (f.cwd.length && !f.cwd.some((c) => cwd.includes(c))) return false;
	if (f.model.length && !s.models.some((m) => f.model.some((x) => m.toLowerCase().includes(x)))) return false;
	if (f.provider.length && !s.providers.some((p) => f.provider.some((x) => p.toLowerCase().includes(x)))) return false;
	if (f.minCost !== undefined && s.cost.total < f.minCost) return false;
	if (f.minMessages !== undefined && s.userMessages + s.assistantMessages < f.minMessages) return false;
	if (f.errorsOnly && s.toolErrors === 0) return false;
	if (f.grep && !s.userText.toLowerCase().includes(f.grep)) return false;
	return true;
}

export function warnMalformed(loaded: Loaded): void {
	if (loaded.malformedLines) {
		process.stderr.write(
			`warning: skipped ${loaded.malformedLines} malformed line(s) in ${loaded.malformedFiles} file(s)\n`,
		);
	}
}

// ---------------------------------------------------------------------------
// Formatting

export function usd(value: number): string {
	if (value !== 0 && Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
	return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function count(value: number): string {
	return Math.round(value).toLocaleString("en-US");
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function localDay(date: Date | null): string {
	if (!date) return "(unknown)";
	return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function localTime(date: Date | null): string {
	if (!date) return "(unknown)";
	return `${localDay(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function duration(ms: number): string {
	const minutes = Math.round(ms / 60e3);
	if (minutes < 60) return `${minutes}m`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function tildify(path: string): string {
	const home = homedir();
	return path === home || path.startsWith(home + sep) ? `~${path.slice(home.length)}` : path || "(unknown)";
}

export function oneLine(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export function table(headers: string[], rows: string[][], rightAlign: boolean[]): string {
	const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
	const fmt = (cells: string[]) =>
		cells
			.map((c, i) => (rightAlign[i] ? c.padStart(widths[i]) : c.padEnd(widths[i])))
			.join("  ")
			.trimEnd();
	return [fmt(headers), widths.map((w) => "-".repeat(w)).join("  "), ...rows.map(fmt)].join("\n");
}

export const scriptDir = dirname(new URL(import.meta.url).pathname);

/** Display id: 13 characters, enough to separate UUIDv7 ids created in the same minute. */
export const shortId = (id: string): string => id.slice(0, 13);

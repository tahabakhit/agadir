import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, Key, matchesKey, type TUI, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { activeSnippets, composeInput, loadSnippets, type Snippet, scrollToShow } from "./lib.ts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const BUNDLED_DIR = join(HERE, "snippets");
const USER_DIR = join(homedir(), ".config", "agadir", "snippets");
const ORCHESTRATOR_FILE = join(HERE, "orchestrator.md");

const WIDGET_KEY = "snippets";
const STATUS_KEY = "orchestrator-mode";
const ORCHESTRATOR_ENTRY = "agadir.orchestrator-mode";
const ORCHESTRATOR_EVENT = "agadir:orchestrator-mode";
const ORCHESTRATOR_SECTION = "orchestrator_mode";

const load = () => loadSnippets([BUNDLED_DIR, USER_DIR]);

export default function snippets(pi: ExtensionAPI) {
	let active = new Set<string>();
	let known: Snippet[] = [];
	let orchestrator = false;

	function updateWidget(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") return;
		const shown = activeSnippets(known, active);
		if (shown.length === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => ({
			render(width: number) {
				const parts = shown.map((s) => theme.fg(s.placement === "prepend" ? "accent" : "success", s.name));
				return [truncateToWidth(`${theme.fg("dim", "snippets:")} ${parts.join(theme.fg("dim", ", "))}`, width)];
			},
			invalidate() {},
		}));
	}

	function updateStatus(ctx: ExtensionContext) {
		ctx.ui.setStatus(STATUS_KEY, orchestrator ? "orchestrator" : undefined);
	}

	async function openMenu(ctx: ExtensionContext) {
		if (ctx.mode !== "tui") {
			ctx.ui.notify("The snippets menu needs the interactive TUI", "warning");
			return;
		}
		known = load();
		active = new Set([...active].filter((id) => known.some((s) => s.id === id)));
		if (known.length === 0) {
			ctx.ui.notify(`No snippets found in ${BUNDLED_DIR} or ${USER_DIR}`, "warning");
			updateWidget(ctx);
			return;
		}
		const list = known;
		const result = await ctx.ui.custom<Set<string> | undefined>((tui, theme, _kb, done) =>
			createMenu(tui, theme, list, new Set(active), done),
		);
		if (result) active = result;
		updateWidget(ctx);
	}

	function setOrchestrator(enabled: boolean, ctx: ExtensionContext) {
		if (enabled === orchestrator) {
			ctx.ui.notify(`Orchestrator mode is already ${enabled ? "on" : "off"}`, "info");
			return;
		}
		orchestrator = enabled;
		pi.appendEntry(ORCHESTRATOR_ENTRY, { enabled });
		pi.events.emit(ORCHESTRATOR_EVENT, enabled);
		updateStatus(ctx);
		ctx.ui.notify(`Orchestrator mode ${enabled ? "on" : "off"}`, "info");
	}

	pi.registerCommand("snippets", {
		description: "Toggle snippets for the next message",
		handler: async (_args, ctx) => openMenu(ctx),
	});

	pi.registerShortcut("alt+o", {
		description: "Toggle snippets for the next message",
		handler: async (ctx) => openMenu(ctx),
	});

	pi.registerCommand("orchestrator", {
		description: "Orchestrator mode: /orchestrator [on|off|status]",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "") setOrchestrator(!orchestrator, ctx);
			else if (arg === "on" || arg === "off") setOrchestrator(arg === "on", ctx);
			else if (arg === "status") ctx.ui.notify(`Orchestrator mode is ${orchestrator ? "on" : "off"}`, "info");
			else ctx.ui.notify("Usage: /orchestrator [on|off|status]", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		active = new Set();
		known = load();
		orchestrator = false;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type === "custom" && entry.customType === ORCHESTRATOR_ENTRY) {
				orchestrator = (entry.data as { enabled?: boolean } | undefined)?.enabled === true;
			}
		}
		updateWidget(ctx);
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		ctx.ui.setStatus(STATUS_KEY, undefined);
	});

	pi.on("before_agent_start", async (event) => {
		if (!orchestrator) return;
		const body = readFileSync(ORCHESTRATOR_FILE, "utf8").trim();
		if (body) event.systemPromptOptions.sections[ORCHESTRATOR_SECTION] = body;
	});

	pi.on("input", async (event, ctx) => {
		if (active.size === 0 || event.source === "extension") return { action: "continue" };
		known = load();
		const applied = activeSnippets(known, active);
		active = new Set();
		updateWidget(ctx);
		if (applied.length === 0) return { action: "continue" };
		return { action: "transform", text: composeInput(event.text, applied) };
	});
}

type Row = { kind: "header"; label: string } | { kind: "item"; snippet: Snippet };

function createMenu(
	tui: TUI,
	theme: Theme,
	snippets: Snippet[],
	selected: Set<string>,
	done: (result: Set<string> | undefined) => void,
): Component {
	const rows: Row[] = [];
	for (const placement of ["prepend", "append"] as const) {
		const group = snippets.filter((s) => s.placement === placement);
		if (group.length === 0) continue;
		rows.push({ kind: "header", label: placement === "prepend" ? "Prepend" : "Append" });
		for (const snippet of group) rows.push({ kind: "item", snippet });
	}
	const itemRows = rows.flatMap((row, index) => (row.kind === "item" ? [index] : []));

	let cursor = 0;
	let listScroll = 0;
	let previewing = false;
	let previewScroll = 0;

	const viewport = () => Math.max(5, tui.terminal.rows - 8);
	const refresh = () => tui.requestRender();
	const current = () => (rows[itemRows[cursor]] as { snippet: Snippet }).snippet;

	function frame(width: number, title: string, body: string[], hint: string): string[] {
		const line = (text: string) => truncateToWidth(` ${text}`, width);
		const rule = theme.fg("border", "─".repeat(Math.max(0, width - visibleWidth(title) - 3)));
		return [
			truncateToWidth(`${theme.fg("border", "─ ")}${theme.fg("accent", theme.bold(title))} ${rule}`, width),
			...body.map(line),
			line(theme.fg("dim", hint)),
			theme.fg("border", "─".repeat(width)),
		];
	}

	function clip(lines: string[], scroll: number, height: number): string[] {
		const above = scroll;
		const below = Math.max(0, lines.length - scroll - height);
		return [
			above > 0 ? theme.fg("dim", `↑ ${above} more`) : "",
			...lines.slice(scroll, scroll + height),
			below > 0 ? theme.fg("dim", `↓ ${below} more`) : "",
		];
	}

	function renderList(width: number): string[] {
		const height = viewport();
		const cursorRow = itemRows[cursor];
		const headerAbove = rows[cursorRow - 1]?.kind === "header" ? cursorRow - 1 : cursorRow;
		listScroll = scrollToShow(scrollToShow(listScroll, cursorRow, height, rows.length), headerAbove, height, rows.length);
		const lines = rows.map((row, index) => {
			if (row.kind === "header") return theme.fg("muted", theme.bold(row.label));
			const pointer = index === cursorRow ? theme.fg("accent", "›") : " ";
			const box = selected.has(row.snippet.id) ? theme.fg("success", "[x]") : theme.fg("dim", "[ ]");
			const name = index === cursorRow ? theme.fg("accent", row.snippet.name) : row.snippet.name;
			const description = row.snippet.description ? `  ${theme.fg("dim", row.snippet.description)}` : "";
			return `${pointer} ${box} ${name}${description}`;
		});
		return frame(
			width,
			"Snippets",
			clip(lines, listScroll, height),
			"↑↓ move · space toggle · tab preview · enter apply · esc cancel",
		);
	}

	function renderPreview(width: number): string[] {
		const snippet = current();
		const height = viewport();
		const lines = [
			theme.fg("dim", `${snippet.placement} · order ${snippet.order} · ${snippet.file}`),
			"",
			...snippet.body.split("\n").flatMap((line) => (line ? wrapTextWithAnsi(line, Math.max(1, width - 2)) : [""])),
		];
		previewScroll = Math.max(0, Math.min(previewScroll, lines.length - height));
		return frame(width, snippet.name, clip(lines, previewScroll, height), "↑↓ scroll · tab/esc back");
	}

	function handleInput(data: string) {
		if (previewing) {
			if (matchesKey(data, Key.up)) previewScroll = Math.max(0, previewScroll - 1);
			else if (matchesKey(data, Key.down)) previewScroll += 1;
			else if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) previewing = false;
			refresh();
			return;
		}
		if (matchesKey(data, Key.up)) cursor = (cursor - 1 + itemRows.length) % itemRows.length;
		else if (matchesKey(data, Key.down)) cursor = (cursor + 1) % itemRows.length;
		else if (matchesKey(data, Key.space)) {
			const id = current().id;
			if (selected.has(id)) selected.delete(id);
			else selected.add(id);
		} else if (matchesKey(data, Key.tab)) {
			previewing = true;
			previewScroll = 0;
		} else if (matchesKey(data, Key.enter)) return done(selected);
		else if (matchesKey(data, Key.escape)) return done(undefined);
		refresh();
	}

	return {
		render: (width: number) => (previewing ? renderPreview(width) : renderList(width)),
		handleInput,
		invalidate() {},
	};
}

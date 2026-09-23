import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type Placement = "prepend" | "append";

export interface Snippet {
	/** Filename without `.md`; user files override bundled files with the same id. */
	id: string;
	name: string;
	description: string;
	placement: Placement;
	order: number;
	body: string;
	file: string;
}

export const DEFAULT_ORDER = 9999;

/** Parse a snippet file. Returns undefined without a leading frontmatter block or with an empty body. */
export function parseSnippet(file: string, text: string): Snippet | undefined {
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	if (lines[0]?.trim() !== "---") return undefined;
	const close = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
	if (close < 0) return undefined;

	const meta = new Map<string, string>();
	for (const line of lines.slice(1, close)) {
		const match = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*?)\s*$/.exec(line);
		if (match) meta.set(match[1].toLowerCase(), unquote(match[2]));
	}

	const body = lines.slice(close + 1).join("\n").trim();
	if (!body) return undefined;

	const id = basename(file).replace(/\.md$/i, "");
	const order = Number.parseInt(meta.get("order") ?? "", 10);
	return {
		id,
		name: meta.get("name") || id,
		description: meta.get("description") ?? "",
		placement: meta.get("placement")?.toLowerCase() === "prepend" ? "prepend" : "append",
		order: Number.isNaN(order) ? DEFAULT_ORDER : order,
		body,
		file,
	};
}

function unquote(value: string): string {
	const first = value[0];
	if (value.length >= 2 && (first === '"' || first === "'") && value.endsWith(first)) return value.slice(1, -1);
	return value;
}

/** Prepend snippets first, then append; each group by order, then name. */
export function sortSnippets(snippets: Snippet[]): Snippet[] {
	const rank = (snippet: Snippet) => (snippet.placement === "prepend" ? 0 : 1);
	return [...snippets].sort(
		(a, b) => rank(a) - rank(b) || a.order - b.order || a.name.localeCompare(b.name),
	);
}

/** Merge snippet layers by id. Later layers override earlier ones. */
export function mergeSnippets(...layers: Snippet[][]): Snippet[] {
	const byId = new Map<string, Snippet>();
	for (const layer of layers) for (const snippet of layer) byId.set(snippet.id, snippet);
	return sortSnippets([...byId.values()]);
}

/** Read every valid `*.md` snippet in a directory. A missing directory or unreadable file is skipped. */
export function readSnippetDir(dir: string): Snippet[] {
	let names: string[];
	try {
		names = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".md"));
	} catch {
		return [];
	}
	const snippets: Snippet[] = [];
	for (const name of names) {
		const file = join(dir, name);
		try {
			const snippet = parseSnippet(file, readFileSync(file, "utf8"));
			if (snippet) snippets.push(snippet);
		} catch {
			// Unreadable files are skipped.
		}
	}
	return snippets;
}

/** Load snippets from directories in precedence order (later directories win). */
export function loadSnippets(dirs: string[]): Snippet[] {
	return mergeSnippets(...dirs.map(readSnippetDir));
}

/** The active snippets in display order. Ids that no longer exist are ignored. */
export function activeSnippets(snippets: Snippet[], active: ReadonlySet<string>): Snippet[] {
	return sortSnippets(snippets.filter((snippet) => active.has(snippet.id)));
}

/** Wrap the user's text with prepend and append snippet bodies, separated by blank lines. */
export function composeInput(text: string, applied: Snippet[]): string {
	const before = applied.filter((s) => s.placement === "prepend").map((s) => s.body);
	const after = applied.filter((s) => s.placement === "append").map((s) => s.body);
	return [...before, text, ...after].filter((part) => part.trim()).join("\n\n");
}

/** Smallest scroll offset change that keeps `row` inside a viewport of `height` rows. */
export function scrollToShow(scroll: number, row: number, height: number, total: number): number {
	const maxScroll = Math.max(0, total - height);
	let next = Math.min(scroll, maxScroll);
	if (row < next) next = row;
	if (row >= next + height) next = row - height + 1;
	return Math.max(0, Math.min(next, maxScroll));
}

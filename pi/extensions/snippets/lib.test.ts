import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	activeSnippets,
	composeInput,
	DEFAULT_ORDER,
	loadSnippets,
	mergeSnippets,
	parseSnippet,
	readSnippetDir,
	type Snippet,
	scrollToShow,
	sortSnippets,
} from "./lib.ts";

const md = (meta: string, body: string) => `---\n${meta}\n---\n${body}\n`;

function snippet(id: string, placement: "prepend" | "append", order = DEFAULT_ORDER, body = `${id} body`): Snippet {
	return { id, name: id, description: "", placement, order, body, file: `${id}.md` };
}

test("parses frontmatter with case-insensitive keys and quoted values", () => {
	const parsed = parseSnippet(
		"/x/check.md",
		md(`Name: "Check it"\nDESCRIPTION: 'Look first'\nplacement: Prepend\norder: 5`, "\n  Do the thing.  \n"),
	);
	assert.deepEqual(parsed, {
		id: "check",
		name: "Check it",
		description: "Look first",
		placement: "prepend",
		order: 5,
		body: "Do the thing.",
		file: "/x/check.md",
	});
});

test("applies defaults for missing or invalid keys", () => {
	const parsed = parseSnippet("plain.md", md("placement: sideways\norder: soon", "Body"));
	assert.equal(parsed?.name, "plain");
	assert.equal(parsed?.description, "");
	assert.equal(parsed?.placement, "append");
	assert.equal(parsed?.order, DEFAULT_ORDER);
});

test("handles CRLF line endings", () => {
	const parsed = parseSnippet("crlf.md", "---\r\nname: crlf\r\norder: 3\r\n---\r\nline one\r\nline two\r\n");
	assert.equal(parsed?.order, 3);
	assert.equal(parsed?.body, "line one\nline two");
});

test("ignores files without frontmatter, unclosed frontmatter, or an empty body", () => {
	assert.equal(parseSnippet("a.md", "Just text"), undefined);
	assert.equal(parseSnippet("b.md", "---\nname: b\nno close"), undefined);
	assert.equal(parseSnippet("c.md", md("name: c", "   \n")), undefined);
});

test("sorts prepend before append, then by order, then by name", () => {
	const sorted = sortSnippets([
		snippet("zeta", "append", 1),
		snippet("beta", "prepend", 20),
		snippet("alpha", "append", 1),
		snippet("gamma", "prepend", 10),
		snippet("omega", "append"),
	]);
	assert.deepEqual(
		sorted.map((s) => s.id),
		["gamma", "beta", "alpha", "zeta", "omega"],
	);
});

test("later layers override earlier ones by id", () => {
	const merged = mergeSnippets(
		[snippet("shared", "append", 10, "bundled"), snippet("only-bundled", "append", 20)],
		[snippet("shared", "prepend", 5, "user"), snippet("only-user", "append", 30)],
	);
	assert.deepEqual(
		merged.map((s) => [s.id, s.body]),
		[
			["shared", "user"],
			["only-bundled", "only-bundled body"],
			["only-user", "only-user body"],
		],
	);
});

test("loads directories with user files overriding bundled ones and skips a missing directory", () => {
	const root = mkdtempSync(join(tmpdir(), "snippets-test-"));
	const bundled = join(root, "bundled");
	const user = join(root, "user");
	mkdirSync(bundled);
	mkdirSync(user);
	writeFileSync(join(bundled, "ask.md"), md("order: 10", "bundled ask"));
	writeFileSync(join(bundled, "check.md"), md("order: 20", "bundled check"));
	writeFileSync(join(bundled, "notes.txt"), md("order: 1", "not markdown"));
	writeFileSync(join(user, "ask.md"), md("order: 10", "user ask"));
	writeFileSync(join(user, "broken.md"), "no frontmatter");

	assert.equal(readSnippetDir(join(root, "missing")).length, 0);
	const loaded = loadSnippets([bundled, user, join(root, "missing")]);
	assert.deepEqual(
		loaded.map((s) => [s.id, s.body]),
		[
			["ask", "user ask"],
			["check", "bundled check"],
		],
	);
});

test("composes prepend bodies, user text, then append bodies with blank lines", () => {
	const all = [
		snippet("late", "append", 20),
		snippet("intro", "prepend", 10),
		snippet("early", "append", 10),
		snippet("unused", "append", 5),
	];
	const applied = activeSnippets(all, new Set(["late", "early", "intro", "deleted"]));
	assert.deepEqual(
		applied.map((s) => s.id),
		["intro", "early", "late"],
	);
	assert.equal(composeInput("Fix the bug.", applied), "intro body\n\nFix the bug.\n\nearly body\n\nlate body");
});

test("leaves text unchanged when nothing applies", () => {
	assert.equal(composeInput("hello", activeSnippets([snippet("a", "append")], new Set(["gone"]))), "hello");
});

test("scrollToShow keeps a row inside the viewport", () => {
	assert.equal(scrollToShow(0, 3, 5, 20), 0);
	assert.equal(scrollToShow(0, 7, 5, 20), 3);
	assert.equal(scrollToShow(10, 4, 5, 20), 4);
	assert.equal(scrollToShow(18, 19, 5, 20), 15);
	assert.equal(scrollToShow(4, 1, 5, 3), 0);
});

test("bundled snippets all parse", () => {
	const bundled = readSnippetDir(new URL("./snippets", import.meta.url).pathname);
	assert.deepEqual(
		bundled.map((s) => s.id).sort(),
		["ask-questions", "diagnose-report", "session-kickoff", "verify-not-assume"],
	);
});

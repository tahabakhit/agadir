// Merge a few owned keys into a config file that its application also writes.
//
// chezmoi runs this as a `modify_` script: the current file arrives on stdin and
// the merged file goes to stdout. Everything not named in the spec is kept as is,
// including key order. When nothing changes, the input is echoed byte for byte so
// chezmoi reports no difference.
//
//   node merge-config.ts json <base64 spec>
//   node merge-config.ts toml <base64 spec>
//
// JSON spec: [{ "op": "set" | "union" | "unset", "path": ["a", "b"], "value": ... }]
//   set    replaces the value at path, creating parent objects.
//   union  appends array items that are missing (deep equality), keeping existing ones.
//   unset  removes the key at path.
// TOML spec: { "key": "string" | number | boolean } for top-level scalar keys only.

import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JsonOp =
	| { op: "set"; path: string[]; value: Json }
	| { op: "union"; path: string[]; value: Json[] }
	| { op: "unset"; path: string[] };
export type TomlSpec = Record<string, string | number | boolean>;

function isObject(value: unknown): value is { [key: string]: Json } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parentOf(root: { [key: string]: Json }, path: string[], create: boolean) {
	let node: { [key: string]: Json } = root;
	for (const key of path.slice(0, -1)) {
		if (!isObject(node[key])) {
			if (!create) return undefined;
			node[key] = {};
		}
		node = node[key] as { [key: string]: Json };
	}
	return node;
}

export function mergeJson(text: string, ops: JsonOp[]): string {
	const original = text.trim() === "" ? {} : (JSON.parse(text) as Json);
	if (!isObject(original)) throw new Error("top-level JSON value must be an object");
	const merged = structuredClone(original);
	for (const op of ops) {
		if (op.path.length === 0) throw new Error("empty path");
		const key = op.path[op.path.length - 1];
		if (op.op === "unset") {
			const parent = parentOf(merged, op.path, false);
			if (parent) delete parent[key];
			continue;
		}
		const parent = parentOf(merged, op.path, true)!;
		if (op.op === "set") {
			parent[key] = structuredClone(op.value);
		} else {
			const current = Array.isArray(parent[key]) ? (parent[key] as Json[]) : [];
			const missing = op.value.filter((item) => !current.some((have) => isDeepStrictEqual(have, item)));
			parent[key] = [...current, ...structuredClone(missing)];
		}
	}
	if (text.trim() !== "" && isDeepStrictEqual(original, merged)) return text;
	return `${JSON.stringify(merged, null, 2)}\n`;
}

function tomlValue(value: string | number | boolean): string {
	return typeof value === "string" ? JSON.stringify(value) : String(value);
}

export function mergeToml(text: string, spec: TomlSpec): string {
	const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
	let firstTable = lines.findIndex((line) => /^\s*\[/.test(line));
	if (firstTable === -1) firstTable = lines.length;
	let changed = false;
	for (const [key, value] of Object.entries(spec)) {
		if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new Error(`unsupported TOML key: ${key}`);
		const wanted = `${key} = ${tomlValue(value)}`;
		const pattern = new RegExp(`^\\s*${key}\\s*=`);
		const index = lines.slice(0, firstTable).findIndex((line) => pattern.test(line));
		if (index === -1) {
			let insertAt = firstTable;
			while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt--;
			lines.splice(insertAt, 0, wanted);
			firstTable++;
			changed = true;
		} else if (lines[index].trim() !== wanted) {
			lines[index] = wanted;
			changed = true;
		}
	}
	return changed ? `${lines.join("\n")}\n` : text;
}

function main(argv: string[]): void {
	const [format, encoded] = argv;
	if ((format !== "json" && format !== "toml") || !encoded) {
		process.stderr.write("usage: merge-config.ts json|toml <base64 spec>\n");
		process.exit(2);
	}
	const spec = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
	const input = readFileSync(0, "utf8");
	process.stdout.write(format === "json" ? mergeJson(input, spec) : mergeToml(input, spec));
}

if (import.meta.main) main(process.argv.slice(2));

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { mergeJson, mergeToml } from "./merge-config.ts";

test("json set keeps other keys and their order", () => {
	const input = '{\n  "z": 1,\n  "packages": ["old"],\n  "a": {"b": 2}\n}\n';
	const out = mergeJson(input, [{ op: "set", path: ["packages"], value: ["new"] }]);
	assert.deepEqual(Object.keys(JSON.parse(out)), ["z", "packages", "a"]);
	assert.deepEqual(JSON.parse(out).packages, ["new"]);
	assert.equal(JSON.parse(out).a.b, 2);
});

test("json returns the input unchanged when nothing changes", () => {
	const input = '{"packages":["x"],   "keep": true}';
	assert.equal(mergeJson(input, [{ op: "set", path: ["packages"], value: ["x"] }]), input);
});

test("json set creates parents, union adds only missing items, unset removes", () => {
	const input = '{"permissions": {"deny": ["Read(.env)", "mine"]}, "gone": 1}';
	const out = JSON.parse(
		mergeJson(input, [
			{ op: "set", path: ["env", "DISABLE_TELEMETRY"], value: "1" },
			{ op: "union", path: ["permissions", "deny"], value: ["Read(.env)", "Read(**/.ssh/**)"] },
			{ op: "unset", path: ["gone"] },
		]),
	);
	assert.deepEqual(out.env, { DISABLE_TELEMETRY: "1" });
	assert.deepEqual(out.permissions.deny, ["Read(.env)", "mine", "Read(**/.ssh/**)"]);
	assert.equal("gone" in out, false);
});

test("json starts from an empty object when the file is missing", () => {
	assert.equal(mergeJson("", [{ op: "set", path: ["a"], value: 1 }]), '{\n  "a": 1\n}\n');
});

test("json rejects a non-object document", () => {
	assert.throws(() => mergeJson("[]", []), /must be an object/);
});

test("toml replaces or inserts top-level keys and leaves tables alone", () => {
	const input = '# comment\nmodel = "x"\npersonality = "friendly"\n\n[projects."/a"]\npersonality = "keep"\n';
	const out = mergeToml(input, { personality: "pragmatic", model_reasoning_summary: "concise" });
	assert.equal(
		out,
		'# comment\nmodel = "x"\npersonality = "pragmatic"\nmodel_reasoning_summary = "concise"\n\n[projects."/a"]\npersonality = "keep"\n',
	);
	assert.equal(mergeToml(out, { personality: "pragmatic" }), out);
});

test("toml works on an empty file", () => {
	assert.equal(mergeToml("", { personality: "pragmatic" }), 'personality = "pragmatic"\n');
});

test("cli reads stdin and writes the merge", () => {
	const spec = Buffer.from(JSON.stringify([{ op: "set", path: ["a"], value: 2 }])).toString("base64");
	const result = spawnSync(process.execPath, [new URL("./merge-config.ts", import.meta.url).pathname, "json", spec], {
		input: '{"a": 1, "b": 0}',
		encoding: "utf8",
	});
	assert.equal(result.status, 0, result.stderr);
	assert.deepEqual(JSON.parse(result.stdout), { a: 2, b: 0 });
});

test("json upsert matches packages by source and keeps user additions", () => {
	const input = JSON.stringify({ packages: ["npm:mine", "npm:a", { source: "/repo", skills: ["old/*"] }] });
	const out = JSON.parse(
		mergeJson(input, [{ op: "upsert", path: ["packages"], value: ["npm:a", "npm:b", { source: "/repo", skills: ["pi/skills/*"] }] }]),
	);
	assert.deepEqual(out.packages, ["npm:mine", "npm:a", { source: "/repo", skills: ["pi/skills/*"] }, "npm:b"]);
});

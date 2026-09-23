import assert from "node:assert/strict";
import { test } from "node:test";
import { MODE_ENTRY, parseModeArg, resolveMode, savedMode, toolsFor } from "./mode.ts";

const entry = (enabled: boolean) => ({ type: "custom", customType: MODE_ENTRY, data: { enabled } });

test("savedMode reads the last learn-mode entry on the branch", () => {
	assert.equal(savedMode([]), undefined);
	assert.equal(savedMode([{ type: "message" }, { type: "custom", customType: "other", data: { enabled: true } }]), undefined);
	assert.equal(savedMode([entry(true), { type: "message" }, entry(false)]), false);
	assert.equal(savedMode([entry(false), entry(true), { type: "message" }]), true);
});

test("resolveMode: flag wins at startup and on fresh branches, saved state otherwise", () => {
	assert.equal(resolveMode(false, true, "startup"), true);
	assert.equal(resolveMode(undefined, true, "new"), true);
	assert.equal(resolveMode(false, true, "reload"), false);
	assert.equal(resolveMode(true, false, "resume"), true);
	assert.equal(resolveMode(undefined, false, "startup"), false);
});

test("toolsFor preserves other tools and avoids duplicates", () => {
	assert.deepEqual(toolsFor(["read", "bash", "quiz"], true), ["read", "bash", "quiz", "review"]);
	assert.deepEqual(toolsFor(["read", "quiz", "bash", "review"], false), ["read", "bash"]);
});

test("parseModeArg", () => {
	assert.equal(parseModeArg(" ON ", false), true);
	assert.equal(parseModeArg("off", true), false);
	assert.equal(parseModeArg("status", true), "status");
	assert.equal(parseModeArg("", true), false);
	assert.throws(() => parseModeArg("maybe", false), /Unknown argument "maybe"/);
});

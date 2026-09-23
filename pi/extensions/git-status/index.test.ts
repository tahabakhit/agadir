import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

import gitStatus, {
	formatGitStatus,
	parseGitStatus,
	readGitStatus,
} from "./index.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function makeDirtyRepo(): { root: string; indexBefore: Buffer; fsmonitorMarker: string } {
	const root = mkdtempSync(join(tmpdir(), "agadir-git-status."));
	try {
		execFileSync("git", ["init", "--quiet", root]);
		writeFileSync(join(root, "tracked.txt"), "baseline\n");
		execFileSync("git", ["-C", root, "add", "tracked.txt"]);
		execFileSync("git", [
			"-C",
			root,
			"-c",
			"user.name=git-status test",
			"-c",
			"user.email=git-status@example.invalid",
			"commit",
			"--quiet",
			"--message=baseline",
		]);
		execFileSync("git", ["-C", root, "mv", "tracked.txt", "renamed.txt"]);
		writeFileSync(join(root, "untracked.txt"), "new\n");
		const indexBefore = readFileSync(join(root, ".git/index"));
		const fsmonitorMarker = join(root, ".git", "fsmonitor-was-run");
		const fsmonitorHook = join(root, ".git", "fsmonitor-hook.sh");
		writeFileSync(fsmonitorHook, `#!/bin/sh\nprintf called > "${fsmonitorMarker}"\n`);
		chmodSync(fsmonitorHook, 0o700);
		execFileSync("git", ["-C", root, "config", "core.fsmonitor", fsmonitorHook]);
		return { root, indexBefore, fsmonitorMarker };
	} catch (error) {
		rmSync(root, { recursive: true, force: true });
		throw error;
	}
}

test("parses porcelain v2 branch, change, conflict, and upstream records", () => {
	const output = [
		"# branch.oid abc123",
		"# branch.head feature/footer",
		"# branch.upstream origin/feature/footer",
		"# branch.ab +2 -1",
		"1 M. N... 100644 100644 100644 abc abc staged.txt",
		"2 .M N... 100644 100644 100644 abc abc R100 renamed.txt",
		"old-name.txt",
		"u UU N... 100644 100644 100644 100644 abc abc abc conflict.txt",
		"? untracked.txt",
		"",
	].join("\0");

	const status = parseGitStatus(output);
	assert.deepEqual(status, {
		branch: "feature/footer",
		trackedChanges: 3,
		untrackedEntries: 1,
		conflicts: 1,
		ahead: 2,
		behind: 1,
	});
	const text = formatGitStatus(status!);
	assert.match(text, /Git feature\/footer/);
	assert.match(text, /2 changed · 1 conflict · 1 untracked/);
	assert.match(text, /↑2↓1/);
	assert.ok(Array.from(text).length <= 64);
});

test("reports a clean branch and omits unavailable upstream data", () => {
	const status = parseGitStatus("# branch.oid abc123\0# branch.head main\0");
	assert.deepEqual(status, {
		branch: "main",
		trackedChanges: 0,
		untrackedEntries: 0,
		conflicts: 0,
		ahead: undefined,
		behind: undefined,
	});
	assert.equal(formatGitStatus(status!), "Git main · clean");
	assert.equal(parseGitStatus("not porcelain output\0"), undefined);
});

test("reads a temporary worktree without changing it", async () => {
	const { root, indexBefore, fsmonitorMarker } = makeDirtyRepo();
	try {
		const status = await readGitStatus(root);
		assert.ok(status);
		assert.ok(status.branch);
		assert.equal(status.trackedChanges, 1);
		assert.equal(status.untrackedEntries, 1);
		assert.equal(status.conflicts, 0);
		assert.deepEqual(readFileSync(join(root, ".git/index")), indexBefore);
		assert.equal(existsSync(fsmonitorMarker), false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("publishes Git state to the TUI footer and clears it at shutdown", async () => {
	const { root } = makeDirtyRepo();
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
	const pi = {
		on(event: string, handler: (event: any, ctx: ExtensionContext) => void) {
			handlers.set(event, handler);
		},
	} as unknown as ExtensionAPI;
	gitStatus(pi);

	const writes: Array<[string, string | undefined]> = [];
	const ctx = {
		mode: "tui",
		hasUI: true,
		cwd: root,
		ui: {
			setStatus: (key: string, text: string | undefined) => writes.push([key, text]),
			theme: { fg: (_color: string, text: string) => text },
		},
	} as unknown as ExtensionContext;
	const sessionStart = handlers.get("session_start");
	const sessionShutdown = handlers.get("session_shutdown");
	assert.ok(sessionStart);
	assert.ok(sessionShutdown);

	try {
		sessionStart({ type: "session_start" }, ctx);
		const deadline = Date.now() + 2_000;
		while (writes.length === 0 && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		assert.equal(writes.length, 1);
		assert.equal(writes[0][0], "agadir-git-status");
		assert.match(writes[0][1] ?? "", /Git .+1 changed · 1 untracked/);
	} finally {
		sessionShutdown({ type: "session_shutdown" }, ctx);
		rmSync(root, { recursive: true, force: true });
	}
	assert.deepEqual(writes.at(-1), ["agadir-git-status", undefined]);
});

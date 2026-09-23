import { execFile } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_ID = "agadir-git-status";
const POLL_INTERVAL_MS = 10_000;
const GIT_TIMEOUT_MS = 2_000;
const MAX_STATUS_CHARACTERS = 64;

export interface GitStatusSummary {
	branch: string;
	trackedChanges: number;
	untrackedEntries: number;
	conflicts: number;
	ahead?: number;
	behind?: number;
}

/** Parse `git status --porcelain=v2 --branch -z` without interpreting file paths. */
export function parseGitStatus(output: string): GitStatusSummary | undefined {
	let branch: string | undefined;
	let ahead: number | undefined;
	let behind: number | undefined;
	let trackedChanges = 0;
	let untrackedEntries = 0;
	let conflicts = 0;

	const records = output.split("\0");
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record) continue;

		if (record.startsWith("# branch.head ")) {
			branch = record.slice("# branch.head ".length);
			if (branch === "(detached)") branch = "detached";
			continue;
		}

		if (record.startsWith("# branch.ab ")) {
			const match = record.match(/^# branch\.ab \+(\d+) -(\d+)$/);
			if (match) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
			continue;
		}

		if (record.startsWith("? ")) {
			untrackedEntries++;
			continue;
		}

		const kind = record[0];
		if (kind === "1" || kind === "2" || kind === "u") {
			trackedChanges++;
			if (kind === "u") conflicts++;
			// Porcelain v2 rename/copy records are followed by the original path.
			if (kind === "2") index++;
		}
	}

	if (!branch) return undefined;
	return { branch, trackedChanges, untrackedEntries, conflicts, ahead, behind };
}

/** Keep status text compact enough to coexist with Pi's built-in footer. */
export function formatGitStatus(status: GitStatusSummary): string {
	const branch = truncateLabel(status.branch, 24);
	const parts = [`Git ${branch}`];
	const ordinaryChanges = Math.max(0, status.trackedChanges - status.conflicts);
	if (ordinaryChanges > 0) parts.push(`${ordinaryChanges} changed`);
	if (status.conflicts > 0) {
		parts.push(`${status.conflicts} conflict${status.conflicts === 1 ? "" : "s"}`);
	}
	if (status.untrackedEntries > 0) parts.push(`${status.untrackedEntries} untracked`);
	if (ordinaryChanges === 0 && status.conflicts === 0 && status.untrackedEntries === 0) {
		parts.push("clean");
	}
	const divergence =
		`${status.ahead ? `↑${status.ahead}` : ""}${status.behind ? `↓${status.behind}` : ""}`;
	if (divergence) parts.push(divergence);
	return truncateLabel(parts.join(" · "), MAX_STATUS_CHARACTERS);
}

function truncateLabel(value: string, maxCharacters: number): string {
	const characters = Array.from(value);
	if (characters.length <= maxCharacters) return value;
	return `${characters.slice(0, maxCharacters - 1).join("")}…`;
}

/** Run Git without a shell or optional index writes; failure means no footer status. */
export function readGitStatus(cwd: string): Promise<GitStatusSummary | undefined> {
	return new Promise((resolve) => {
		execFile(
			"git",
			[
				"--no-optional-locks",
				"-c",
				"core.fsmonitor=false",
				"-c",
				"core.untrackedCache=false",
				"status",
				"--porcelain=v2",
				"--branch",
				"-z",
				"--untracked-files=normal",
			],
			{
				cwd,
				encoding: "utf8",
				timeout: GIT_TIMEOUT_MS,
				maxBuffer: 256 * 1024,
				windowsHide: true,
			},
			(error, stdout) =>
				resolve(error || typeof stdout !== "string" ? undefined : parseGitStatus(stdout)),
		);
	});
}

function hasLocalChanges(status: GitStatusSummary): boolean {
	return status.trackedChanges > 0 || status.untrackedEntries > 0;
}

export default function (pi: ExtensionAPI) {
	let generation = 0;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let lastPublishedStatus: string | undefined;
	const inFlight = new Set<number>();

	function publish(ctx: ExtensionContext, text: string | undefined): void {
		if (text === lastPublishedStatus) return;
		lastPublishedStatus = text;
		ctx.ui.setStatus(STATUS_ID, text);
	}

	async function refresh(ctx: ExtensionContext, currentGeneration: number): Promise<void> {
		if (
			ctx.mode !== "tui" ||
			!ctx.hasUI ||
			currentGeneration !== generation ||
			inFlight.has(currentGeneration)
		) {
			return;
		}
		inFlight.add(currentGeneration);
		try {
			const status = await readGitStatus(ctx.cwd);
			if (currentGeneration !== generation) return;
			if (!status) {
				publish(ctx, undefined);
				return;
			}

			const isOutOfSync = Boolean(status.ahead || status.behind);
			let color: "error" | "warning" | "success" = "success";
			if (status.conflicts > 0) color = "error";
			else if (hasLocalChanges(status) || isOutOfSync) color = "warning";
			publish(ctx, ctx.ui.theme.fg(color, formatGitStatus(status)));
		} catch {
			if (currentGeneration === generation) publish(ctx, undefined);
		} finally {
			inFlight.delete(currentGeneration);
		}
	}

	function start(ctx: ExtensionContext): void {
		generation++;
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
		if (ctx.mode !== "tui" || !ctx.hasUI) return;

		const currentGeneration = generation;
		void refresh(ctx, currentGeneration);
		pollTimer = setInterval(() => void refresh(ctx, currentGeneration), POLL_INTERVAL_MS);
	}

	function stop(ctx: ExtensionContext): void {
		generation++;
		if (pollTimer) clearInterval(pollTimer);
		pollTimer = undefined;
		if (ctx.mode === "tui" && ctx.hasUI) publish(ctx, undefined);
	}

	pi.on("session_start", (_event, ctx) => start(ctx));
	pi.on("tool_execution_end", (_event, ctx) => void refresh(ctx, generation));
	pi.on("turn_end", (_event, ctx) => void refresh(ctx, generation));
	pi.on("session_shutdown", (_event, ctx) => stop(ctx));
}

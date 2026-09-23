// Learn-mode state helpers: branch persistence and tool activation.

export const MODE_ENTRY = "learn-mode";
export const LEARN_TOOLS = ["quiz", "review"] as const;

interface EntryLike {
	type: string;
	customType?: string;
	data?: unknown;
}

/** The last saved learn-mode state on this branch, or undefined if none. */
export function savedMode(branch: readonly EntryLike[]): boolean | undefined {
	for (let i = branch.length - 1; i >= 0; i--) {
		const entry = branch[i];
		if (entry.type === "custom" && entry.customType === MODE_ENTRY) {
			return (entry.data as { enabled?: unknown } | undefined)?.enabled === true;
		}
	}
	return undefined;
}

/** `--learn` forces the mode on at startup and for branches with no saved state. */
export function resolveMode(saved: boolean | undefined, flag: boolean, reason: string): boolean {
	if (flag && (reason === "startup" || saved === undefined)) return true;
	return saved ?? false;
}

/** Active tool list with learn tools added or removed, keeping every other tool. */
export function toolsFor(active: readonly string[], enabled: boolean): string[] {
	const others = active.filter((name) => !(LEARN_TOOLS as readonly string[]).includes(name));
	return enabled ? [...others, ...LEARN_TOOLS] : others;
}

export function parseModeArg(arg: string, current: boolean): boolean | "status" {
	const word = arg.trim().toLowerCase();
	if (word === "on") return true;
	if (word === "off") return false;
	if (word === "status") return "status";
	if (word === "") return !current;
	throw new Error(`Unknown argument "${arg.trim()}". Use /learn on, off or status.`);
}

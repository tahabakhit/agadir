/** Block-letter "agadir" over a row of Atlantic swell. */
export const LETTERS = [
	" ▄▀▀▄ ▄▀▀▀ ▄▀▀▄ █▀▀▄ ▀█▀ █▀▀▄",
	" █▀▀█ █ ▀█ █▀▀█ █  █  █  █▀▀▄",
	" ▀  ▀  ▀▀▀ ▀  ▀ ▀▀▀  ▀▀▀ ▀  ▀",
];
export const SWELL = "▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁▂▃▂▁";

/** Every logo character occupies one terminal column. */
export const LOGO_WIDTH = Math.max(...[...LETTERS, SWELL].map((line) => [...line].length));

export interface Paint {
	letters(text: string): string;
	swell(text: string): string;
	name(text: string): string;
	version(text: string): string;
}

/** Header lines for a terminal width. The logo is dropped when it would not fit. */
export function headerLines(width: number, version: string, paint: Paint): string[] {
	const title = `${paint.name("agadir")}${paint.version(` · pi v${version}`)}`;
	if (width < LOGO_WIDTH) return ["", title];
	return ["", ...LETTERS.map(paint.letters), paint.swell(SWELL), "", title];
}

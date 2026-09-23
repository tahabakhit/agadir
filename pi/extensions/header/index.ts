import { type ExtensionAPI, VERSION } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";
import { headerLines } from "./logo.ts";

export default function header(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		ctx.ui.setHeader((_tui, theme) => ({
			render(width: number) {
				const lines = headerLines(width, VERSION, {
					letters: (text) => theme.bold(theme.fg("accent", text)),
					swell: (text) => theme.fg("muted", text),
					name: (text) => theme.bold(theme.fg("accent", text)),
					version: (text) => theme.fg("dim", text),
				});
				return lines.map((line) => truncateToWidth(line, width));
			},
			invalidate() {},
		}));
	});
}

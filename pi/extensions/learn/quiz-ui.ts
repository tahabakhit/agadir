// Interactive quiz screen: one question at a time, immediate feedback for choice questions.

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { gradeQuestion, type Question, type QuestionResult, type Selection, toggleSelection } from "./quiz.ts";

type Row = { kind: "choice"; value: string; label: string } | { kind: "dontKnow" } | { kind: "submit" } | { kind: "answer" } | { kind: "note" };

export interface QuizRun {
	results: QuestionResult[];
	cancelled: boolean;
}

function rowsFor(q: Question): Row[] {
	if (q.type === "recall") return [{ kind: "answer" }, { kind: "dontKnow" }, { kind: "note" }];
	const rows: Row[] = q.choices.map((c) => ({ kind: "choice" as const, ...c }));
	rows.push({ kind: "dontKnow" });
	if (q.type === "multi") rows.push({ kind: "submit" });
	rows.push({ kind: "note" });
	return rows;
}

export function runQuiz(ctx: ExtensionContext, questions: Question[]): Promise<QuizRun> {
	return ctx.ui.custom<QuizRun>((tui, theme: Theme, _keybindings, done) => {
		const editorTheme: EditorTheme = {
			borderColor: (s) => theme.fg("accent", s),
			selectList: {
				selectedPrefix: (s) => theme.fg("accent", s),
				selectedText: (s) => theme.fg("accent", s),
				description: (s) => theme.fg("muted", s),
				scrollInfo: (s) => theme.fg("dim", s),
				noMatch: (s) => theme.fg("warning", s),
			},
		};
		const results: QuestionResult[] = [];
		let index = 0;
		let rows: Row[] = [];
		let cursor = 0;
		let selection: Selection = { values: [], dontKnow: false };
		let answer = new Editor(tui, editorTheme);
		let note = new Editor(tui, editorTheme);
		let hint = "";
		let feedback: QuestionResult | undefined;
		let focused = false;

		function start() {
			rows = rowsFor(questions[index]);
			cursor = 0;
			selection = { values: [], dontKnow: false };
			answer = new Editor(tui, editorTheme);
			note = new Editor(tui, editorTheme);
			hint = "";
			feedback = undefined;
			syncFocus();
		}

		function syncFocus() {
			const kind = feedback ? undefined : rows[cursor]?.kind;
			answer.focused = focused && kind === "answer";
			note.focused = focused && kind === "note";
		}

		function refresh() {
			syncFocus();
			tui.requestRender();
		}

		function submit(response: Selection & { text?: string }) {
			const result = gradeQuestion(questions[index], { ...response, note: note.getText() });
			results.push(result);
			feedback = result;
			refresh();
		}

		function advance() {
			index++;
			if (index >= questions.length) return done({ results, cancelled: false });
			start();
			refresh();
		}

		function handleInput(data: string) {
			if (feedback) {
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape) || matchesKey(data, Key.space)) advance();
				return;
			}
			if (matchesKey(data, Key.escape)) return done({ results, cancelled: true });
			const q = questions[index];
			const row = rows[cursor];
			hint = "";
			if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
				cursor = Math.max(0, Math.min(rows.length - 1, cursor + (matchesKey(data, Key.up) ? -1 : 1)));
				return refresh();
			}
			if (matchesKey(data, Key.tab)) {
				cursor = row.kind === "note" ? 0 : rows.length - 1;
				return refresh();
			}
			const enter = matchesKey(data, Key.enter);
			const toggle = enter || matchesKey(data, Key.space);
			switch (row.kind) {
				case "answer":
					if (!enter) answer.handleInput(data);
					else if (answer.getText().trim()) submit({ values: [], dontKnow: false, text: answer.getText() });
					else hint = "Write an answer first, or choose I don't know.";
					return refresh();
				case "note":
					if (enter) cursor = 0;
					else note.handleInput(data);
					return refresh();
				case "choice":
					if (q.type === "single" && enter) return submit({ values: [row.value], dontKnow: false });
					if (q.type === "multi" && toggle) selection = toggleSelection(selection, row.value);
					return refresh();
				case "dontKnow":
					if (q.type !== "multi" && enter) return submit({ values: [], dontKnow: true });
					if (q.type === "multi" && toggle) selection = toggleSelection(selection, null);
					return refresh();
				case "submit":
					if (!enter) return;
					if (selection.values.length || selection.dontKnow) return submit(selection);
					hint = "Select at least one option, or I don't know.";
					return refresh();
			}
		}

		function render(width: number): string[] {
			const w = Math.max(1, width);
			const lines: string[] = [];
			const add = (text: string, indent = "") => {
				for (const line of wrapTextWithAnsi(text, Math.max(1, w - indent.length))) lines.push(indent + line);
			};
			const q = questions[index];
			const rule = theme.fg("accent", "─".repeat(w));
			lines.push(rule);
			add(theme.fg("dim", `Quiz ${index + 1}/${questions.length} · ${q.type === "multi" ? "select all that apply" : q.type === "single" ? "choose one" : "answer in your own words"}`), " ");
			add(theme.bold(q.question), " ");
			if (q.context) add(theme.fg("muted", q.context), " ");
			lines.push("");
			if (feedback) renderFeedback(feedback, add);
			else renderQuestion(q, add, w, lines);
			lines.push(rule);
			return lines.map((line) => truncateToWidth(line, w));
		}

		function renderQuestion(q: Question, add: (text: string, indent?: string) => void, w: number, lines: string[]) {
			rows.forEach((row, i) => {
				const at = i === cursor;
				const pointer = at ? theme.fg("accent", "› ") : "  ";
				const paint = (s: string) => (at ? theme.fg("accent", s) : s);
				const box = (on: boolean) => (q.type === "multi" ? (on ? "[x] " : "[ ] ") : "");
				if (row.kind === "choice") {
					const n = rows.filter((r) => r.kind === "choice").indexOf(row) + 1;
					add(pointer + paint(`${box(selection.values.includes(row.value))}${n}. ${row.label}`), " ");
				} else if (row.kind === "dontKnow") {
					lines.push("");
					add(pointer + theme.fg(at ? "accent" : "muted", `${box(selection.dontKnow)}I don't know`), " ");
				} else if (row.kind === "submit") {
					const count = selection.dontKnow ? "I don't know" : `${selection.values.length} selected`;
					add(pointer + paint(`Submit (${count})`), " ");
				} else {
					const editor = row.kind === "answer" ? answer : note;
					if (row.kind === "note") lines.push("");
					add(pointer + theme.fg(at ? "accent" : "muted", row.kind === "answer" ? "Your answer" : "Note (optional)"), " ");
					for (const line of editor.render(Math.max(1, w - 3))) lines.push(`   ${line}`);
				}
			});
			lines.push("");
			if (hint) add(theme.fg("warning", hint), " ");
			const keys = rows[cursor]?.kind === "answer" || rows[cursor]?.kind === "note"
				? "Enter submit/return · Shift+Enter newline · ↑↓ move · Tab note · Esc stop quiz"
				: q.type === "multi"
					? "Space/Enter toggle · ↑↓ move · Tab note · Esc stop quiz"
					: "Enter choose · ↑↓ move · Tab note · Esc stop quiz";
			add(theme.fg("dim", keys), " ");
		}

		function renderFeedback(r: QuestionResult, add: (text: string, indent?: string) => void) {
			for (const c of r.choices) {
				const chosen = r.values.includes(c.value);
				const right = r.correct.includes(c.value);
				const mark = right ? theme.fg("success", "✓ ") : chosen ? theme.fg("error", "✗ ") : "  ";
				add(`${mark}${chosen ? theme.bold(c.label) : right ? c.label : theme.fg("muted", c.label)}`, " ");
			}
			if (r.choices.length) add("");
			const verdict = {
				correct: theme.fg("success", "Correct."),
				incorrect: theme.fg("error", "Not quite."),
				dont_know: theme.fg("warning", "Marked as not known yet. That's useful to know."),
				ungraded: theme.fg("accent", "Answer recorded. The agent will give feedback."),
			}[r.verdict];
			add(verdict, " ");
			if (r.text) add(`${theme.fg("muted", "You wrote: ")}${r.text}`, " ");
			if (r.type === "recall") add(`${theme.fg("muted", "Reference: ")}${r.answer}`, " ");
			if (r.explanation) add(r.explanation, " ");
			if (r.note) add(`${theme.fg("muted", "Your note: ")}${r.note}`, " ");
			add("");
			add(theme.fg("dim", index + 1 < questions.length ? "Enter next question" : "Enter finish"), " ");
		}

		start();
		return {
			render,
			handleInput,
			invalidate() {
				answer.invalidate();
				note.invalidate();
			},
			get focused() {
				return focused;
			},
			set focused(value: boolean) {
				focused = value;
				syncFocus();
			},
		};
	});
}

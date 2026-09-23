// Learn mode: tutoring guidance, a graded quiz and a spaced-review queue, all
// active only while the mode is on.

import { type ExtensionAPI, type ExtensionContext, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { MODE_ENTRY, parseModeArg, resolveMode, savedMode, toolsFor } from "./mode.ts";
import { prepareQuiz, type QuestionResult, type QuestionType, summarizeQuiz } from "./quiz.ts";
import { runQuiz } from "./quiz-ui.ts";
import type { Outcome } from "./schedule.ts";
import { addItem, appendLog, dueItems, gradeItem, learnDir, listItems, loadReviews, type ReviewItem, reviewsPath, saveReviews } from "./store.ts";

const GUIDANCE = `Learn mode is on. The user wants to build their own skill in the topic at hand, not only get output.

- Starting a topic, ask one question covering what they want to be able to do and their current level.
- Withhold answers only for the skill being learned. Do incidental work (setup, boilerplate, unrelated fixes) normally. If they say "just show me", show it.
- New concept: let them attempt first, then give a worked example, then fade it (leave steps for them), then set a solo problem. Ask which principle justifies a step. Fade faster for experienced users.
- Hints escalate from a nudge to a pointer to a partial step. After two failed tries, give the answer and explain it.
- In a codebase, have them predict what code will do before running or reading on, then check. After hard parts, ask them to explain it back.
- When a change needs 2-10 lines of real decision logic, hand it over: scaffold the file, signature and tests, leave one TODO(human), post Context, Task and Guidance, then stop and wait. If their code is wrong, hint at the failure; do not fix it.
- One question per turn. Keep replies short.
- When structure matters, draw a small ASCII diagram; sometimes ask them to sketch it first.
- At the end of a topic, check understanding without help using quiz (recall, predict-the-output, find-the-bug, choice). Then review add 1-3 items for what they learned or missed, and review log the session.
- Confidence, rereading, summaries and "makes sense" are not evidence of learning. Only unaided answers count.
- Get your own facts right; verify anything you are unsure of before teaching it.`;

const StringEnum = <T extends string>(values: readonly T[], description: string) =>
	Type.Unsafe<T>({ type: "string", enum: [...values], description });

const QuizParams = Type.Object({
	questions: Type.Array(
		Type.Object({
			type: StringEnum<QuestionType>(["single", "multi", "recall"], "single/multi: graded choices. recall: learner writes the answer and you grade it."),
			question: Type.String({ description: "One question." }),
			context: Type.Optional(Type.String({ description: "Code or details shown under the question." })),
			choices: Type.Optional(
				Type.Array(
					Type.Object({
						value: Type.String({ description: "Short stable key, used in correct." }),
						label: Type.String({ description: "Text shown to the learner." }),
					}),
					{ description: "single/multi only. At least 2; shown shuffled." },
				),
			),
			correct: Type.Optional(Type.Array(Type.String(), { description: "single/multi: values of the correct choices (exactly one for single)." })),
			answer: Type.Optional(Type.String({ description: "recall: reference answer, shown after the learner answers." })),
			explanation: Type.Optional(Type.String({ description: "Why the answer is right, shown after answering. Required for single/multi." })),
		}),
		{ minItems: 1, maxItems: 8 },
	),
});

const ReviewParams = Type.Object({
	action: StringEnum(["add", "due", "grade", "list", "log"], "Operation."),
	topic: Type.Optional(Type.String({ description: "add/log: topic. list: optional filter." })),
	prompt: Type.Optional(Type.String({ description: "add: question the learner must answer from memory." })),
	answer: Type.Optional(Type.String({ description: "add: reference answer." })),
	misconception: Type.Optional(Type.String({ description: "add: the mistaken belief they showed, if any." })),
	id: Type.Optional(Type.String({ description: "grade: item id." })),
	outcome: Type.Optional(StringEnum<Outcome>(["again", "good", "easy"], "grade: again = missed or needed a hint, good = recalled with effort, easy = instant.")),
	limit: Type.Optional(Type.Integer({ minimum: 1, description: "due: maximum items (default 10)." })),
	learned: Type.Optional(Type.String({ description: "log: what was learned." })),
	misconceptions: Type.Optional(Type.String({ description: "log: misconceptions found." })),
	next: Type.Optional(Type.String({ description: "log: next steps." })),
});

interface QuizDetails {
	total: number;
	cancelled: boolean;
	results: QuestionResult[];
}

interface ReviewDetails {
	summary: string;
	items: Pick<ReviewItem, "id" | "topic" | "prompt" | "due">[];
}

const day = (iso: string) => iso.slice(0, 10);
const text = (value: string) => [{ type: "text" as const, text: value }];

function need<T>(value: T | undefined, name: string, action: string): T {
	if (value === undefined || (typeof value === "string" && !value.trim())) throw new Error(`review ${action} needs "${name}".`);
	return value;
}

export default function learn(pi: ExtensionAPI) {
	let enabled = false;
	const dir = () => learnDir();

	pi.registerFlag("learn", { description: "Start with learn mode on", type: "boolean", default: false });

	function apply(ctx: ExtensionContext, next: boolean) {
		enabled = next;
		pi.setActiveTools(toolsFor(pi.getActiveTools(), next));
		ctx.ui.setStatus("learn", next ? ctx.ui.theme.fg("accent", "learn") : undefined);
	}

	function setMode(ctx: ExtensionContext, next: boolean) {
		apply(ctx, next);
		pi.appendEntry(MODE_ENTRY, { enabled: next });
		ctx.ui.notify(next ? 'Learn mode on: quiz and review are active. Say "just show me" any time.' : "Learn mode off.", "info");
	}

	async function dueCount(): Promise<number> {
		return dueItems(await loadReviews(dir()), new Date()).length;
	}

	pi.on("session_start", async (event, ctx) => {
		const saved = savedMode(ctx.sessionManager.getBranch());
		const next = resolveMode(saved, pi.getFlag("learn") === true, event.reason);
		apply(ctx, next);
		if (next !== (saved ?? false)) pi.appendEntry(MODE_ENTRY, { enabled: next });
		if (ctx.mode !== "tui") return;
		try {
			const n = await dueCount();
			if (n) ctx.ui.notify(`${n} review${n === 1 ? "" : "s"} due, run /review`, "info");
		} catch (error) {
			ctx.ui.notify(`Learn reviews: ${(error as Error).message}`, "warning");
		}
	});

	pi.on("session_tree", (_event, ctx) => {
		apply(ctx, resolveMode(savedMode(ctx.sessionManager.getBranch()), pi.getFlag("learn") === true, "tree"));
	});

	pi.on("before_agent_start", (event) => {
		if (enabled) event.systemPromptOptions.sections.learn_mode = GUIDANCE;
	});

	pi.registerCommand("learn", {
		description: "Learn mode: /learn [on|off|status]",
		getArgumentCompletions: (prefix) =>
			["on", "off", "status"].filter((a) => a.startsWith(prefix.trim())).map((a) => ({ value: a, label: a })),
		handler: async (args, ctx) => {
			let next: boolean | "status";
			try {
				next = parseModeArg(args, enabled);
			} catch (error) {
				return ctx.ui.notify((error as Error).message, "warning");
			}
			if (next === "status") {
				const due = await dueCount().then((n) => `${n} review(s) due.`, (error: Error) => error.message);
				return ctx.ui.notify(`Learn mode is ${enabled ? "on" : "off"}. ${due}`, "info");
			}
			if (next === enabled) return ctx.ui.notify(`Learn mode is already ${enabled ? "on" : "off"}.`, "info");
			setMode(ctx, next);
		},
	});

	pi.registerCommand("review", {
		description: "Start a spaced-review session on due items",
		handler: async (_args, ctx) => {
			let due: ReviewItem[];
			try {
				due = dueItems(await loadReviews(dir()), new Date(), 10);
			} catch (error) {
				return ctx.ui.notify((error as Error).message, "error");
			}
			if (!due.length) return ctx.ui.notify("No reviews due.", "info");
			if (!enabled) setMode(ctx, true);
			const message = [
				`Run a spaced-review session on these due items: ${due.map((i) => i.id).join(", ")}.`,
				`Load them with review due (limit ${due.length}). Ask me one prompt at a time without showing the answer and wait for my attempt.`,
				"Then give brief feedback with the reference answer and call review grade for that item before moving on. Finish with a one-line summary.",
			].join(" ");
			pi.sendUserMessage(message, ctx.isIdle() ? undefined : { deliverAs: "followUp" });
		},
	});

	pi.registerTool({
		name: "quiz",
		label: "Quiz",
		description:
			"Ask the learner one or more questions in an interactive screen. single/multi are graded here with immediate feedback; recall answers come back for you to grade. Every question offers \"I don't know\" and an optional note.",
		promptSnippet: "Check the learner's understanding with graded choice or free-recall questions",
		promptGuidelines: [
			"Use quiz only for questions with a checkable answer; ask about goals and preferences in chat.",
			"Prefer recall for predict-the-output, explain-why and find-the-bug; grade the reply against the reference answer and say what was right or missing.",
			"For choices, write the correct claim first, then distractors from specific plausible misconceptions with the same length and form. No trick questions, no hints in wording, no \"not sure\" choice (one is added).",
			"Treat \"I don't know\" as a gap to teach, not an error. Read any learner note and let it steer the follow-up.",
			"Prefer a few short questions over one large one.",
		],
		parameters: QuizParams,
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const questions = prepareQuiz(params.questions);
			if (ctx.mode !== "tui" || !ctx.hasUI) {
				throw new Error("quiz needs the interactive terminal, which this session does not have. Ask the questions in chat instead, one at a time, and grade the replies yourself.");
			}
			if (signal?.aborted) throw new Error("Quiz cancelled before it was shown.");
			const run = await runQuiz(ctx, questions);
			const details: QuizDetails = { total: questions.length, ...run };
			return { content: text(summarizeQuiz(run.results, questions.length, run.cancelled)), details };
		},
		renderCall(args, theme) {
			const qs = args.questions ?? [];
			const types = [...new Set(qs.map((q) => q.type))].join(", ");
			return new Text(`${theme.fg("toolTitle", theme.bold("quiz "))}${theme.fg("muted", `${qs.length} question${qs.length === 1 ? "" : "s"}${types ? ` (${types})` : ""}`)}`, 0, 0);
		},
		renderResult(result, { isPartial }, theme) {
			const details = result.details as QuizDetails | undefined;
			if (isPartial) return new Text(theme.fg("dim", "Waiting for the learner…"), 0, 0);
			if (!details) return new Text(result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"), 0, 0);
			const mark = { correct: theme.fg("success", "✓"), incorrect: theme.fg("error", "✗"), dont_know: theme.fg("warning", "?"), ungraded: theme.fg("accent", "✎") };
			const lines = details.results.map((r) => `${mark[r.verdict]} ${r.question}`);
			if (details.cancelled) lines.push(theme.fg("warning", `Stopped after ${details.results.length} of ${details.total}.`));
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "review",
		label: "Review",
		description:
			"Spaced-review queue kept across sessions. add: save a recall item. due: items due now, oldest first, with reference answers. grade: record again/good/easy and reschedule (1, 11, 21, 90, 180 days). list: items by topic. log: append a dated entry to the learning log.",
		promptSnippet: "Schedule spaced recall of what the learner studied and keep a learning log",
		promptGuidelines: [
			"Make each review item one question answerable from memory, with a short reference answer; record the misconception when they got it wrong.",
			"In a review session the learner answers before seeing the answer; then call review grade for that item.",
		],
		parameters: ReviewParams,
		executionMode: "sequential",
		async execute(_id, p) {
			const now = new Date();
			const root = dir();
			const done = (summary: string, items: ReviewItem[] = [], body = summary) => ({
				content: text(body),
				details: { summary, items: items.map(({ id, topic, prompt, due }) => ({ id, topic, prompt, due })) } satisfies ReviewDetails,
			});
			if (p.action === "log") {
				const path = await appendLog(root, { topic: need(p.topic, "topic", "log"), learned: need(p.learned, "learned", "log"), misconceptions: p.misconceptions, next: p.next }, now);
				return done(`Logged to ${path}.`);
			}
			return withFileMutationQueue(reviewsPath(root), async () => {
				const data = await loadReviews(root);
				if (p.action === "add") {
					const item = addItem(data, { topic: need(p.topic, "topic", "add"), prompt: need(p.prompt, "prompt", "add"), answer: need(p.answer, "answer", "add"), misconception: p.misconception }, now);
					await saveReviews(root, data);
					return done(`Added ${item.id} [${item.topic}], first review ${day(item.due)}.`, [item]);
				}
				if (p.action === "grade") {
					const item = gradeItem(data, need(p.id, "id", "grade"), need(p.outcome, "outcome", "grade"), now);
					await saveReviews(root, data);
					return done(`Graded ${item.id} ${item.lastOutcome}, next review ${day(item.due)}.`, [item]);
				}
				if (p.action === "due") {
					const all = dueItems(data, now);
					const items = all.slice(0, p.limit ?? 10);
					if (!items.length) return done("No reviews due.");
					const summary = `${all.length} due, showing ${items.length}.`;
					const body = items.map((i) =>
						[`${i.id} [${i.topic}] due ${day(i.due)}, reviewed ${i.reviews}x`, `  Prompt: ${i.prompt}`, `  Answer: ${i.answer}`, ...(i.misconception ? [`  Watch for: ${i.misconception}`] : [])].join("\n"),
					);
					return done(summary, items, [summary, ...body].join("\n"));
				}
				const items = listItems(data, p.topic);
				if (!items.length) return done(p.topic ? `No items match "${p.topic}".` : "The review queue is empty.");
				const summary = `${items.length} item(s).`;
				return done(summary, items, [summary, ...items.map((i) => `${i.id} [${i.topic}] due ${day(i.due)}: ${i.prompt}`)].join("\n"));
			});
		},
		renderCall(args, theme) {
			const extra = [args.topic, args.id, args.outcome].filter(Boolean).join(" ");
			return new Text(`${theme.fg("toolTitle", theme.bold("review "))}${theme.fg("muted", `${args.action}${extra ? ` ${extra}` : ""}`)}`, 0, 0);
		},
		renderResult(result, { expanded }, theme) {
			const details = result.details as ReviewDetails | undefined;
			if (!details) return new Text(result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n"), 0, 0);
			const lines = [details.summary];
			if (expanded) lines.push(...details.items.map((i) => theme.fg("muted", `${i.id} [${i.topic}] ${i.prompt}`)));
			return new Text(lines.join("\n"), 0, 0);
		},
	});
}

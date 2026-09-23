// Quiz validation, shuffling, selection and grading. No UI here.

export type QuestionType = "single" | "multi" | "recall";
export type Verdict = "correct" | "incorrect" | "dont_know" | "ungraded";

export interface Choice {
	value: string;
	label: string;
}

export interface QuestionInput {
	type: QuestionType;
	question: string;
	context?: string;
	choices?: Choice[];
	correct?: string[];
	answer?: string;
	explanation?: string;
}

export interface Question {
	type: QuestionType;
	question: string;
	context?: string;
	/** Choices in display order (shuffled). Empty for recall. */
	choices: Choice[];
	correct: string[];
	answer?: string;
	explanation?: string;
}

export interface Selection {
	values: string[];
	dontKnow: boolean;
}

export interface Response extends Selection {
	text?: string;
	note?: string;
}

export interface QuestionResult extends Question, Response {
	verdict: Verdict;
}

export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[out[i], out[j]] = [out[j], out[i]];
	}
	return out;
}

function validate(input: QuestionInput, n: number): { question?: Question; problems: string[] } {
	const where = `Question ${n}`;
	const problems: string[] = [];
	const question = input.question?.trim();
	if (!question) problems.push(`${where}: "question" is empty.`);

	if (input.type === "recall") {
		if (input.choices?.length || input.correct?.length) problems.push(`${where}: recall questions take no "choices" or "correct".`);
		if (!input.answer?.trim()) problems.push(`${where}: recall questions need a reference "answer".`);
		return {
			problems,
			question: { type: "recall", question, context: input.context?.trim() || undefined, choices: [], correct: [], answer: input.answer?.trim(), explanation: input.explanation?.trim() || undefined },
		};
	}

	const choices = (input.choices ?? []).map((c) => ({ value: c.value?.trim() ?? "", label: c.label?.trim() ?? "" }));
	if (choices.length < 2) problems.push(`${where}: needs at least 2 choices.`);
	const values = new Set<string>();
	for (const choice of choices) {
		if (!choice.value || !choice.label) problems.push(`${where}: every choice needs a non-empty value and label.`);
		else if (values.has(choice.value)) problems.push(`${where}: duplicate choice value "${choice.value}".`);
		values.add(choice.value);
	}
	const correct = (input.correct ?? []).map((v) => v.trim());
	const seen = new Set<string>();
	for (const value of correct) {
		if (!values.has(value)) problems.push(`${where}: correct value "${value}" is not a choice value (valid: ${[...values].join(", ")}).`);
		if (seen.has(value)) problems.push(`${where}: correct value "${value}" is listed twice.`);
		seen.add(value);
	}
	if (input.type === "single" && correct.length !== 1) problems.push(`${where}: single-choice questions need exactly 1 correct value.`);
	if (input.type === "multi" && correct.length < 1) problems.push(`${where}: multi-choice questions need at least 1 correct value.`);
	if (!input.explanation?.trim()) problems.push(`${where}: choice questions need an "explanation" shown after answering.`);
	return {
		problems,
		question: { type: input.type, question, context: input.context?.trim() || undefined, choices, correct, explanation: input.explanation?.trim() },
	};
}

/** Validate every question and shuffle choices. Throws one error listing all problems. */
export function prepareQuiz(inputs: QuestionInput[], rng: () => number = Math.random): Question[] {
	if (!inputs.length) throw new Error("Quiz needs at least one question.");
	const results = inputs.map((input, i) => validate(input, i + 1));
	const problems = results.flatMap((r) => r.problems);
	if (problems.length) throw new Error(`Invalid quiz, nothing was shown:\n${problems.join("\n")}`);
	return results.map(({ question }) => ({ ...question!, choices: shuffle(question!.choices, rng) }));
}

/** Toggle a choice value, or "I don't know" when `value` is null. The two are mutually exclusive. */
export function toggleSelection(selection: Selection, value: string | null): Selection {
	if (value === null) return { values: [], dontKnow: !selection.dontKnow };
	const values = selection.values.includes(value) ? selection.values.filter((v) => v !== value) : [...selection.values, value];
	return { values, dontKnow: false };
}

export function gradeQuestion(question: Question, response: Response): QuestionResult {
	const note = response.note?.trim() || undefined;
	const text = response.text?.trim() || undefined;
	const base = { ...question, values: response.values, dontKnow: response.dontKnow, text, note };
	if (response.dontKnow) return { ...base, values: [], text: undefined, verdict: "dont_know" };
	if (question.type === "recall") return { ...base, verdict: "ungraded" };
	const chosen = new Set(response.values);
	const exact = chosen.size === question.correct.length && question.correct.every((v) => chosen.has(v));
	return { ...base, verdict: exact ? "correct" : "incorrect" };
}

const labels = (q: Question, values: string[]) =>
	values.map((v) => q.choices.find((c) => c.value === v)?.label ?? v).map((l) => `"${l}"`).join(", ") || "(nothing)";

/** Model-facing summary of a finished or cancelled quiz. */
export function summarizeQuiz(results: QuestionResult[], total: number, cancelled: boolean): string {
	const graded = results.filter((r) => r.verdict === "correct" || r.verdict === "incorrect");
	const correct = graded.filter((r) => r.verdict === "correct").length;
	const lines = [
		cancelled
			? `The learner closed the quiz after ${results.length} of ${total} question(s).`
			: `Quiz finished: ${correct}/${graded.length} choice question(s) correct.`,
	];
	results.forEach((r, i) => {
		const head = `Q${i + 1} [${r.type}] ${r.question}`;
		if (r.verdict === "dont_know") lines.push(`${head}\n  Learner chose "I don't know": a genuine gap to teach, not an error.`);
		else if (r.verdict === "ungraded") lines.push(`${head}\n  Learner wrote: ${JSON.stringify(r.text ?? "")}\n  Reference: ${r.answer}\n  Grade this yourself and tell the learner what was right or missing.`);
		else lines.push(`${head}\n  ${r.verdict === "correct" ? "Correct" : "Incorrect"}. Chose ${labels(r, r.values)}${r.verdict === "incorrect" ? `; correct: ${labels(r, r.correct)}` : ""}.`);
		if (r.note) lines.push(`  Learner note: ${JSON.stringify(r.note)}`);
	});
	if (graded.length) lines.push("The learner has already seen the correct answers and explanations for choice questions.");
	return lines.join("\n");
}

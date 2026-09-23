import assert from "node:assert/strict";
import { test } from "node:test";
import { gradeQuestion, prepareQuiz, type QuestionInput, shuffle, summarizeQuiz, toggleSelection } from "./quiz.ts";

const single: QuestionInput = {
	type: "single",
	question: "Which call blocks?",
	choices: [
		{ value: "send", label: "Send on an unbuffered channel" },
		{ value: "len", label: "len(ch)" },
		{ value: "cap", label: "cap(ch)" },
	],
	correct: ["send"],
	explanation: "An unbuffered send waits for a receiver.",
};
const multi: QuestionInput = { ...single, type: "multi", correct: ["send", "cap"] };
const reversed = () => 0; // Fisher-Yates with rng 0 rotates the list

test("shuffle keeps every item and follows the rng", () => {
	assert.deepEqual(shuffle([1, 2, 3], reversed), [2, 3, 1]);
	assert.deepEqual(shuffle([1, 2, 3], () => 0.999), [1, 2, 3]);
});

test("grading follows values, not display positions", () => {
	const [q] = prepareQuiz([single], reversed);
	assert.deepEqual(q.choices.map((c) => c.value), ["len", "cap", "send"]);
	assert.equal(gradeQuestion(q, { values: ["send"], dontKnow: false }).verdict, "correct");
	assert.equal(gradeQuestion(q, { values: [q.choices[0].value], dontKnow: false }).verdict, "incorrect");
});

test("multi needs the exact set", () => {
	const [q] = prepareQuiz([multi]);
	assert.equal(gradeQuestion(q, { values: ["cap", "send"], dontKnow: false }).verdict, "correct");
	assert.equal(gradeQuestion(q, { values: ["send"], dontKnow: false }).verdict, "incorrect");
	assert.equal(gradeQuestion(q, { values: ["send", "cap", "len"], dontKnow: false }).verdict, "incorrect");
});

test("unknown, duplicate and missing values are rejected before asking", () => {
	assert.throws(() => prepareQuiz([{ ...single, correct: ["nope"] }]), /"nope" is not a choice value \(valid: send, len, cap\)/);
	assert.throws(() => prepareQuiz([{ ...multi, correct: ["send", "send"] }]), /listed twice/);
	assert.throws(() => prepareQuiz([{ ...single, choices: [...single.choices!, { value: "len", label: "again" }] }]), /duplicate choice value "len"/);
	assert.throws(() => prepareQuiz([{ ...single, correct: ["send", "len"] }]), /exactly 1 correct/);
	assert.throws(() => prepareQuiz([{ ...single, explanation: " " }]), /explanation/);
	assert.throws(() => prepareQuiz([{ type: "recall", question: "Define a goroutine" }]), /reference "answer"/);
	assert.throws(() => prepareQuiz([]), /at least one question/);
});

test("all problems are reported together", () => {
	assert.throws(
		() => prepareQuiz([{ ...single, correct: ["x"] }, { type: "recall", question: "" , answer: "a" }]),
		(e: Error) => /Question 1: correct value "x"/.test(e.message) && /Question 2: "question" is empty/.test(e.message),
	);
});

test("I don't know is exclusive with real choices", () => {
	let s = toggleSelection({ values: [], dontKnow: false }, "send");
	s = toggleSelection(s, "cap");
	assert.deepEqual(s, { values: ["send", "cap"], dontKnow: false });
	s = toggleSelection(s, null);
	assert.deepEqual(s, { values: [], dontKnow: true });
	s = toggleSelection(s, "len");
	assert.deepEqual(s, { values: ["len"], dontKnow: false });
	assert.deepEqual(toggleSelection(s, "len"), { values: [], dontKnow: false });
});

test("don't know and recall outcomes", () => {
	const [q, r] = prepareQuiz([single, { type: "recall", question: "What does close(ch) do?", answer: "Marks it closed; receivers drain then get zero values" }]);
	const dk = gradeQuestion(q, { values: ["send"], dontKnow: true, note: "  " });
	assert.equal(dk.verdict, "dont_know");
	assert.deepEqual(dk.values, []);
	assert.equal(dk.note, undefined);
	const rec = gradeQuestion(r, { values: [], dontKnow: false, text: " stops sends ", note: "unsure" });
	assert.equal(rec.verdict, "ungraded");
	assert.equal(rec.text, "stops sends");

	const summary = summarizeQuiz([dk, rec], 3, true);
	assert.match(summary, /closed the quiz after 2 of 3/);
	assert.match(summary, /genuine gap/);
	assert.match(summary, /Learner wrote: "stops sends"\n  Reference: Marks it closed/);
	assert.match(summary, /Learner note: "unsure"/);
});

test("summary names chosen and correct labels", () => {
	const [q] = prepareQuiz([single]);
	const summary = summarizeQuiz([gradeQuestion(q, { values: ["len"], dontKnow: false })], 1, false);
	assert.match(summary, /0\/1 choice question\(s\) correct/);
	assert.match(summary, /Incorrect\. Chose "len\(ch\)"; correct: "Send on an unbuffered channel"/);
});

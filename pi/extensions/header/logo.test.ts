import assert from "node:assert/strict";
import { test } from "node:test";
import { headerLines, LETTERS, LOGO_WIDTH, type Paint, SWELL } from "./logo.ts";

const plain: Paint = { letters: (t) => t, swell: (t) => t, name: (t) => t, version: (t) => t };

test("logo fits the size budget", () => {
	assert.ok(LETTERS.length + 1 <= 6);
	assert.ok(LOGO_WIDTH <= 48);
	assert.equal([...SWELL].length, LOGO_WIDTH);
});

test("wide terminals get the logo and the name line", () => {
	assert.deepEqual(headerLines(80, "1.2.3", plain), ["", ...LETTERS, SWELL, "", "agadir · pi v1.2.3"]);
	assert.equal(headerLines(LOGO_WIDTH, "1.2.3", plain).length, LETTERS.length + 4);
});

test("narrow terminals get only the name line", () => {
	assert.deepEqual(headerLines(LOGO_WIDTH - 1, "1.2.3", plain), ["", "agadir · pi v1.2.3"]);
});

test("paint functions style each part", () => {
	const tagged: Paint = {
		letters: (t) => `L(${t})`,
		swell: (t) => `S(${t})`,
		name: (t) => `N(${t})`,
		version: (t) => `V(${t})`,
	};
	const lines = headerLines(80, "9", tagged);
	assert.equal(lines[1], `L(${LETTERS[0]})`);
	assert.equal(lines[4], `S(${SWELL})`);
	assert.equal(lines.at(-1), "N(agadir)V( · pi v9)");
});

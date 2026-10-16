import { PassThrough } from "node:stream";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as confirm from "../../../src/terminal/prompts/confirm.js";
import type { PromptInput } from "../../../src/terminal/prompts/input-filter.js";
import * as multiselect from "../../../src/terminal/prompts/multiselect.js";
import * as select from "../../../src/terminal/prompts/select.js";
import type { PromptContext } from "../../../src/terminal/prompts/session.js";
import { createStyle } from "../../../src/terminal/style.js";
import { CaptureStdout, FakeHost, FakeStdin, tick } from "./terminal.js";

// The filter may take replies out and nothing else: a prompt reads every key
// through it as it would read stdin itself. Each prompt here is given an ESC,
// then a key some ms after it, then the keys that answer it, once through the
// filter and once with a pass-through in its place; the answers must match.

const FILTER = "../../../src/terminal/prompts/input-filter.js";
const CHOICES = ["laravel", "nuxt", "macos"].map((name) => ({
	value: name,
	label: name,
}));
const FOLLOWS = { j: "j", enter: "\r", y: "y", nothing: "" };
const GAPS = [0, 5, 10, 20, 30, 40, 45, 50, 55, 60, 70, 80, 100, 120, 150];
const CLOSING_MS = 250;

/** Stdin as a prompt reads it with no filter: each read passed as it comes. */
class Unfiltered extends PassThrough {
	readonly isTTY = true;

	constructor(private readonly source: PromptInput) {
		super();
	}

	get isRaw(): boolean {
		return this.source.isRaw === true;
	}

	setRawMode(mode: boolean): this {
		this.source.setRawMode?.(mode);
		return this;
	}

	onSequence(): () => void {
		return () => {};
	}
}

interface Prompts {
	select: typeof select.promptSelect;
	multiselect: typeof multiselect.promptMultiselect;
	confirm: typeof confirm.promptConfirm;
}

/** Each prompt, and the keys that answer it once the keys under test have had their effect. */
const ASKED = {
	select: {
		ask: (prompts: Prompts, context: PromptContext) =>
			prompts.select({ message: "Manage", options: CHOICES }, context),
		closing: "\r",
	},
	multiselect: {
		ask: (prompts: Prompts, context: PromptContext) =>
			prompts.multiselect(
				{ message: "Install", options: CHOICES, required: true },
				context,
			),
		closing: " \r",
	},
	confirm: {
		ask: (prompts: Prompts, context: PromptContext) =>
			prompts.confirm({ message: "Remove it?" }, context),
		closing: "\r",
	},
};

const filtered: Prompts = {
	select: select.promptSelect,
	multiselect: multiselect.promptMultiselect,
	confirm: confirm.promptConfirm,
};
let unfiltered: Prompts;

beforeAll(async () => {
	vi.resetModules();
	vi.doMock(FILTER, () => ({ InputFilter: Unfiltered }));
	const [freshSelect, freshMultiselect, freshConfirm] = await Promise.all([
		import("../../../src/terminal/prompts/select.js"),
		import("../../../src/terminal/prompts/multiselect.js"),
		import("../../../src/terminal/prompts/confirm.js"),
	]);
	vi.doUnmock(FILTER);
	unfiltered = {
		select: freshSelect.promptSelect,
		multiselect: freshMultiselect.promptMultiselect,
		confirm: freshConfirm.promptConfirm,
	};
});

/** The answer to an ESC, `follow` `gap` ms after it, then the closing keys. */
async function answer(
	ask: (context: PromptContext) => Promise<unknown>,
	follow: string,
	gap: number,
	closing: string,
): Promise<string> {
	const input = new FakeStdin();
	const answered = ask({
		input,
		output: new CaptureStdout(),
		width: 80,
		style: createStyle(0),
		background: [0, 0, 0],
		host: new FakeHost(),
	});
	await tick();
	input.write("\x1b");
	if (follow !== "") {
		setTimeout(() => input.write(follow), gap);
	}
	setTimeout(() => input.write(closing), CLOSING_MS);
	return `${gap} ms: ${JSON.stringify(await answered)}`;
}

describe.concurrent.each(
	Object.keys(ASKED) as (keyof typeof ASKED)[],
)("a %s given an ESC", (name) => {
	const { ask, closing } = ASKED[name];

	it.each(
		Object.entries(FOLLOWS),
	)("answers the same with the filter and without, %s following it", async (_key, follow) => {
		const answers = (prompts: Prompts) =>
			Promise.all(
				GAPS.map((gap) =>
					answer((context) => ask(prompts, context), follow, gap, closing),
				),
			);
		const [through, without] = await Promise.all([
			answers(filtered),
			answers(unfiltered),
		]);
		expect(through).toEqual(without);
		// Joined with the ESC early on, and after it the escape key later.
		const outcomes = new Set(without.map((line) => line.split(": ")[1]));
		expect(outcomes.size).toBe(follow === "" ? 1 : 2);
	});
});

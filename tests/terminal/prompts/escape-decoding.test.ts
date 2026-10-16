import { once } from "node:events";
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
// filter, its waits on a fake clock, and once with a pass-through in its
// place; the answers must match. Readline's own 50 ms wait after an ESC runs
// on Node's internal timers, which no fake clock reaches, so that run follows
// readline instead: a key under 50 ms after the ESC comes straight after it,
// and one at 50 or more once readline has read the ESC as the escape key.

const FILTER = "../../../src/terminal/prompts/input-filter.js";
const ESCAPE_MS = 50;
const CHOICES = ["laravel", "nuxt", "macos"].map((name) => ({
	value: name,
	label: name,
}));
const FOLLOWS = { j: "j", enter: "\r", y: "y", nothing: "" };
const GAPS = [0, 5, 10, 20, 30, 40, 45, 49, 50, 55, 60, 70, 80, 100, 120, 150];
const CLOSING_MS = 250;

/** Each pass-through, by the stdin it reads. */
const readers = new WeakMap<PromptInput, PassThrough>();

/** Stdin as a prompt reads it with no filter: each read passed as it comes. */
class Unfiltered extends PassThrough {
	readonly isTTY = true;

	constructor(private readonly source: PromptInput) {
		super();
		readers.set(source, this);
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

	release(): void {}
}

interface Prompts {
	select: typeof select.promptSelect;
	multiselect: typeof multiselect.promptMultiselect;
	confirm: typeof confirm.promptConfirm;
}

type Ask = (prompts: Prompts, context: PromptContext) => Promise<unknown>;

/** Each prompt, and the keys that answer it once the keys under test have had their effect. */
const ASKED: Record<keyof Prompts, { ask: Ask; closing: string }> = {
	select: {
		ask: (prompts, context) =>
			prompts.select({ message: "Manage", options: CHOICES }, context),
		closing: "\r",
	},
	multiselect: {
		ask: (prompts, context) =>
			prompts.multiselect(
				{ message: "Install", options: CHOICES, required: true },
				context,
			),
		closing: " \r",
	},
	confirm: {
		ask: (prompts, context) =>
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

interface Run {
	ask: Ask;
	follow: string;
	gap: number;
	closing: string;
}

function asking(prompts: Prompts, ask: Ask, input: FakeStdin) {
	return ask(prompts, {
		input,
		output: new CaptureStdout(),
		width: 80,
		style: createStyle(0),
		background: [0, 0, 0],
		host: new FakeHost(),
	});
}

const outcome = (gap: number, answer: unknown) =>
	`${gap} ms: ${JSON.stringify(answer)}`;

async function press(input: FakeStdin, keys: string): Promise<void> {
	if (keys !== "") {
		input.write(keys);
	}
	await tick();
}

/** Through the filter, on the fake clock. */
async function throughFilter({ ask, follow, gap, closing }: Run) {
	const input = new FakeStdin();
	const answered = asking(filtered, ask, input);
	await press(input, "\x1b");
	vi.advanceTimersByTime(gap);
	await press(input, follow);
	vi.advanceTimersByTime(CLOSING_MS - gap);
	await press(input, closing);
	return outcome(gap, await answered);
}

/** Through a pass-through, readline's wait followed as readline keeps it. */
async function withoutFilter({ ask, follow, gap, closing }: Run) {
	const input = new FakeStdin();
	const answered = asking(unfiltered, ask, input);
	const reader = readers.get(input);
	if (reader === undefined) {
		throw new Error("the prompt reads no pass-through");
	}
	if (gap < ESCAPE_MS && follow !== "") {
		// In the one turn of the loop, so readline's wait can't run out between.
		input.write("\x1b");
		input.write(follow);
	} else {
		const escaped = once(reader, "keypress");
		await press(input, "\x1b");
		await escaped;
		await press(input, follow);
	}
	await press(input, closing);
	return outcome(gap, await answered);
}

describe.each(
	Object.keys(ASKED) as (keyof Prompts)[],
)("a %s given an ESC", (name) => {
	const { ask, closing } = ASKED[name];

	it.each(
		Object.entries(FOLLOWS),
	)("answers the same with the filter and without, %s following it", async (_key, follow) => {
		const runs = GAPS.map((gap) => ({ ask, follow, gap, closing }));
		const without: string[] = [];
		for (const run of runs) {
			without.push(await withoutFilter(run));
		}
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const through: string[] = [];
		try {
			for (const run of runs) {
				through.push(await throughFilter(run));
			}
		} finally {
			vi.useRealTimers();
		}
		expect(through).toEqual(without);
		// Joined with the ESC early on, and after it the escape key later.
		const answers = new Set(without.map((line) => line.split(": ")[1]));
		expect(answers.size).toBe(follow === "" ? 1 : 2);
	});
});

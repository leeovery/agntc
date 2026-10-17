import stringWidth from "string-width";
import { describe, expect, it } from "vitest";
import type { Message, Step } from "../../src/message.js";
import { blockLayout, renderRow } from "../../src/terminal/block.js";
import { renderCancel, renderClose } from "../../src/terminal/close.js";
import { renderHeader } from "../../src/terminal/header.js";
import { type MessageKind, renderMessage } from "../../src/terminal/message.js";
import { renderNext } from "../../src/terminal/next.js";
import { renderConfirm } from "../../src/terminal/prompts/confirm.js";
import { scrollWindow } from "../../src/terminal/prompts/list-window.js";
import {
	MULTISELECT_HINTS,
	PICK_ONE,
	renderMultiselect,
} from "../../src/terminal/prompts/multiselect.js";
import {
	isChoice,
	renderSelect,
	SELECT_HINTS,
	type SelectOption,
} from "../../src/terminal/prompts/select.js";
import {
	bandPainter,
	createStyle,
	type Painter,
	type Style,
} from "../../src/terminal/style.js";
import type {
	Child,
	NextItem,
	Row,
	Status,
	TallyItem,
} from "../../src/terminal/types.js";

// The one rule: no line reaches the last column. Commands are exempt, as
// they're never wrapped or cut. Lines are measured by string-width, not by
// the module's own visibleWidth, so a miscount can't cancel itself out. The
// two agree on everything here (ASCII, CJK, the glyphs, box drawing, braille,
// `…`, `—`, `→`); they part on Indic clusters, which string-width counts by
// their first code point, so none are in the matrix. No line ends in a space
// either, unless a background paints it: the cursor row's band is drawn to
// the margin.

const WIDTHS = [40, 59, 60, 80, 100];
const LONG =
	"owner/a-very-long-repository-name-that-keeps-going-and-going-past-any-column";
const WORD = "x".repeat(150);
const PROSE =
	"it would remove macos-hig, which is still in the source but would no longer be installed, so the install is left unchanged";
const CJK = "日本語のスキル集リポジトリ名前がとても長い";
const LONG_META = "feature/a-very-long-branch-name-that-is-the-intent";
const COMMANDS = [
	`npx agntc add ${LONG} --skill a-skill-with-a-long-name-too`,
	"npx agntc remove owner/repo/macos",
];

const SHORT_SUBJECTS = [
	"",
	"a",
	"owner/alpha",
	"rshankras/claude-code-apple-skills",
];
const subjects = [...SHORT_SUBJECTS, LONG, WORD, CJK];
const metas = [undefined, "", "^1.4.0", "^0.10.12", LONG_META, WORD];
const details: Row["detail"][] = [
	undefined,
	"",
	"up to date",
	PROSE,
	WORD,
	CJK,
	{ move: { from: "v0.10.12", to: "v0.11.0" } },
	{ move: { from: "v0.10.12", to: "v0.11.0" }, note: "not applied" },
	{ move: { from: "v1.4.0", to: "v1.5.0" }, note: PROSE },
	{ move: { from: LONG, to: WORD } },
	{ label: "not checked", aside: PROSE },
	{ label: "up to date" },
	{ label: WORD, aside: CJK },
	{ label: "", aside: "Could not resolve host: github.com" },
];
const statuses: Status[] = [
	"done",
	"unchanged",
	"attention",
	"failed",
	"subject",
	"newer",
	"note",
];
const SHORT_CHILDREN: Child[] = [
	{ name: "one", detail: "skill" },
	{ name: "", detail: "" },
	{ name: "two", status: "unchanged", detail: PROSE },
	{ name: "laravel", status: "attention", detail: WORD },
];
const children: Child[] = [
	...SHORT_CHILDREN,
	{ name: LONG, status: "failed", detail: PROSE },
	{ name: CJK, status: "done", detail: CJK },
];

const pick = <T>(list: readonly T[], index: number): T =>
	list[index % list.length] as T;

/** Every index pair below `a` and `b`. */
function pairs(a: number, b: number): [number, number][] {
	return Array.from({ length: a * b }, (_, i) => [Math.floor(i / b), i % b]);
}

/**
 * Rows covering every pair of subject and meta, subject and detail, and meta
 * and detail, the third of each cycling, with statuses and a growing run of
 * children cycling too: the whole product is four times the rows for no new
 * pairing.
 */
function rowsMatrix(
	subjectsIn: readonly string[],
	childrenIn: readonly Child[],
): Row[] {
	const triples = [
		...pairs(subjectsIn.length, metas.length).map(([s, m]) => [s, m, s + m]),
		...pairs(subjectsIn.length, details.length).map(([s, d]) => [s, s + d, d]),
		...pairs(metas.length, details.length).map(([m, d]) => [m + d, m, d]),
	];
	return triples.map(([s = 0, m = 0, d = 0], index) => ({
		status: pick(statuses, index),
		subject: pick(subjectsIn, s),
		meta: pick(metas, m),
		detail: pick(details, d),
		children: childrenIn.slice(0, index % (childrenIn.length + 1)),
	}));
}

const steps: Step[] = [
	{ command: COMMANDS[0] as string },
	{ choice: COMMANDS },
	{ words: PROSE },
	{ words: WORD },
];
const messages: Message[] = [
	"",
	PROSE,
	WORD,
	CJK,
	{
		text: PROSE,
		cause: `fatal: unable to access 'https://github.com/${LONG}.git/': ${PROSE}`,
		plain: "",
	},
	{ text: "", cause: "", remedy: { lead: "", steps }, plain: "" },
	{ text: WORD, remedy: { lead: PROSE, steps }, plain: "" },
];
const nextItems: NextItem[] = [
	{ subject: "macos", remedy: { lead: "To update it anyway:", steps } },
	{ subject: LONG, remedy: { lead: PROSE, steps } },
	{ subject: WORD, remedy: { lead: "", steps } },
	{ subject: "", remedy: { lead: WORD, steps } },
	{ subject: CJK, remedy: { lead: CJK, steps } },
];
const tally: TallyItem[] = [
	{ count: 3, label: "updated", status: "done" },
	{ count: 12, label: "up to date", status: "unchanged" },
	{ count: 1, label: "not checked", status: "attention" },
	{ count: 0, label: "kept", status: "attention" },
	{ count: 1, label: PROSE, status: "failed" },
	{ count: 2, label: WORD, status: "newer" },
];

function renderBlock(
	rows: readonly Row[],
	width: number,
	level: 0 | 3,
): string[] {
	const style = createStyle(level);
	const layout = blockLayout(rows, width);
	return rows.flatMap((row) => renderRow(row, layout, width, style));
}

const rendered = new Map<string, string[]>();

function renderAll(width: number, level: 0 | 3): string[] {
	const key = `${width}:${level}`;
	const lines = rendered.get(key) ?? renderEverything(width, level);
	rendered.set(key, lines);
	return lines;
}

function renderEverything(width: number, level: 0 | 3): string[] {
	const style = createStyle(level);
	const rows = rowsMatrix(subjects, children);
	return [
		// One block holding the long inputs, its columns always capped.
		...renderBlock(rows, width, level),
		// One without them, its columns sized by what it holds.
		...renderBlock(rowsMatrix(SHORT_SUBJECTS, SHORT_CHILDREN), width, level),
		...rows.flatMap((row) => renderBlock([row], width, level)),
		...(["warn", "note", "error"] as MessageKind[]).flatMap((kind) =>
			messages.flatMap((message) => renderMessage(kind, message, width, style)),
		),
		...renderNext(nextItems, width, style),
		...renderClose(tally, 72_000, width, style),
		...renderClose(tally.slice(0, 3), 2400, width, style),
		...renderClose([], 2400, width, style),
		...renderHeader(
			{ command: "update", where: LONG, version: "0.5.3" },
			width,
			style,
		),
		...renderHeader(
			{ command: "update", where: CJK, version: WORD },
			width,
			style,
		),
		...renderCancel(width, style),
		...renderCancel(width, style, PROSE),
		...renderCancel(width, style, WORD),
		...renderPrompts(width, style, undefined),
		...(level === 3
			? renderPrompts(width, style, bandPainter(3, [30, 30, 30]))
			: []),
	];
}

const hints = [undefined, "", "up to date", PROSE, WORD, CJK];
/** Every pair of label and hint, as the options of each prompt. */
const choices = pairs(subjects.length, hints.length).map(([label, hint]) => ({
	value: label * hints.length + hint,
	label: pick(subjects, label),
	...(pick(hints, hint) === undefined ? {} : { hint: pick(hints, hint) }),
}));
const headings = [...SHORT_SUBJECTS, LONG, CJK];
/** The choices in groups of six, each under a heading. */
const selectOptions: SelectOption<number>[] = choices.flatMap(
	(choice, index) =>
		index % 6 === 0
			? [{ heading: pick(headings, index / 6) }, choice]
			: [choice],
);
const selectHeadings = selectOptions.map((option) => !isChoice(option));
const noHeadings = choices.map(() => false);
const questions = ["", "What to install", PROSE, WORD, CJK];
const keyHints = ["", SELECT_HINTS, MULTISELECT_HINTS, LONG];

/**
 * The prompts with the cursor on every option, in a scrolling window and in
 * one holding everything, and every question with every set of key hints.
 */
function renderPrompts(
	width: number,
	style: Style,
	band: Painter | undefined,
): string[] {
	const stops = selectOptions.flatMap((option, index) =>
		isChoice(option) ? [index] : [],
	);
	const select = (
		cursor: number,
		size: number,
		message = "Pick",
		hints = SELECT_HINTS,
	) =>
		renderSelect(
			{
				message,
				hints,
				options: selectOptions,
				cursor,
				top: scrollWindow(selectHeadings, cursor, 0, size),
				size,
				more: true,
			},
			width,
			style,
			band,
		);
	const multiselect = (
		cursor: number,
		size: number,
		message = "Pick",
		hints = MULTISELECT_HINTS,
	) =>
		renderMultiselect(
			{
				message,
				hints,
				options: choices,
				cursor,
				top: scrollWindow(noHeadings, cursor, 0, size),
				size,
				more: true,
				footer: 2,
				picked: choices.flatMap((_, index) =>
					index % 2 === cursor % 2 ? [index] : [],
				),
				warning: cursor % 3 === 0 ? PICK_ONE : "",
			},
			width,
			style,
			band,
		);
	const everyQuestion = (
		render: (message: string, hints: string) => string[],
	) =>
		questions.flatMap((message) =>
			keyHints.flatMap((hints) => render(message, hints)),
		);
	return [
		...stops.flatMap((cursor) => [
			...select(cursor, 5),
			...select(cursor, selectOptions.length),
		]),
		...choices.flatMap((_, cursor) => multiselect(cursor, 5)),
		...everyQuestion((message, hints) =>
			select(stops[0] ?? 0, 5, message, hints),
		),
		...everyQuestion((message, hints) =>
			multiselect(0, choices.length, message, hints),
		),
		...everyQuestion((message, hints) =>
			[true, false].flatMap((value) =>
				renderConfirm({ message, hints, value }, width, style),
			),
		),
	];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escape codes
const SGR = /\x1b\[([0-9;]*)m/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escape codes
const SGR_PIECE = /(\x1b\[[0-9;]*m)/;
const stripSgr = (line: string) => line.replace(SGR, "");
const isCommand = (line: string) => COMMANDS.includes(stripSgr(line).trim());

/** A code's parameters, an extended colour (`38;5;n`, `48;2;r;g;b`) read as one. */
function parameters(code: string): string[] {
	const parts = code.split(";");
	const read: string[] = [];
	for (let at = 0; at < parts.length; at++) {
		const part = parts[at] ?? "";
		read.push(part);
		if (part === "38" || part === "48") {
			at += parts[at + 1] === "5" ? 2 : 4;
		}
	}
	return read;
}

const opensBackground = (parameter: string) =>
	/^(4[0-8]|10[0-7])$/.test(parameter);

/**
 * What's wrong with a line's escape codes: a full reset, bold and dim nested
 * (they share a close), one colour inside another (likewise), one background
 * inside another, or anything still open at the end of the line.
 */
function sgrProblems(line: string): string[] {
	const problems: string[] = [];
	let bold = false;
	let dim = false;
	let colour = false;
	let background = false;
	for (const [, code = ""] of line.matchAll(SGR)) {
		for (const parameter of parameters(code)) {
			if (parameter === "" || parameter === "0") {
				problems.push("a full reset");
			} else if (parameter === "1" || parameter === "2") {
				if (bold || dim) {
					problems.push("bold and dim nested");
				}
				bold ||= parameter === "1";
				dim ||= parameter === "2";
			} else if (parameter === "22") {
				bold = false;
				dim = false;
			} else if (parameter === "39") {
				colour = false;
			} else if (parameter === "49") {
				background = false;
			} else if (opensBackground(parameter)) {
				if (background) {
					problems.push("a background inside a background");
				}
				background = true;
			} else {
				if (colour) {
					problems.push("a colour inside a colour");
				}
				colour = true;
			}
		}
	}
	if (bold || dim || colour || background) {
		problems.push("left open");
	}
	return problems;
}

/** Whether the line ends in a space no background paints. */
function endsInBlank(line: string): boolean {
	let background = false;
	let shown = "";
	line.split(SGR_PIECE).forEach((piece, index) => {
		if (index % 2 === 0) {
			shown += background ? piece.replace(/\s/g, "█") : piece;
			return;
		}
		for (const parameter of parameters(piece.slice(2, -1))) {
			if (opensBackground(parameter)) {
				background = true;
			} else if (["49", "0", ""].includes(parameter)) {
				background = false;
			}
		}
	});
	return /\s$/.test(shown);
}

describe("every line fits", () => {
	for (const width of WIDTHS) {
		for (const level of [0, 3] as const) {
			it(`at ${width} columns, colour level ${level}`, () => {
				const lines = renderAll(width, level).filter(
					(line) => !isCommand(line),
				);
				const over = lines.filter((line) => stringWidth(line) > width - 1);
				const trailing = lines.filter(endsInBlank);
				expect(over).toEqual([]);
				expect(trailing).toEqual([]);
			});
		}
	}

	it.each(WIDTHS)("balances every line's escape codes at %i", (width) => {
		const unbalanced = renderAll(width, 3)
			.map((line) => ({ line, problems: sgrProblems(line) }))
			.filter(({ problems }) => problems.length > 0);
		expect(unbalanced).toEqual([]);
	});

	it.each([0, 1, 2])("renders at %i columns without throwing", (width) => {
		expect(() => renderAll(width, 3)).not.toThrow();
	});

	it("prints commands whole, on lines of their own", () => {
		const lines = renderAll(40, 0).map((line) => line.trim());
		for (const command of COMMANDS) {
			expect(lines).toContain(command);
		}
	});
});

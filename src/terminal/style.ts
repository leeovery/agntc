import type { Status } from "./types.js";

/** 0 none, 1 the terminal's 16 colours, 2 xterm-256, 3 truecolor. */
export type ColorLevel = 0 | 1 | 2 | 3;

export type Painter = (text: string) => string;

export interface Style {
	level: ColorLevel;
	bold: Painter;
	dim: Painter;
	good: Painter;
	attention: Painter;
	bad: Painter;
	accent: Painter;
}

type Tone = "dim" | "good" | "attention" | "bad" | "accent";

export function detectColorLevel(
	env: Readonly<Record<string, string | undefined>>,
	isTTY: boolean,
): ColorLevel {
	if (env.NO_COLOR) {
		return 0;
	}
	const forced = forcedLevel(env.FORCE_COLOR);
	if (forced !== undefined) {
		return forced;
	}
	if (!isTTY || env.TERM === "dumb") {
		return 0;
	}
	if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) {
		return 3;
	}
	return env.TERM?.includes("256") ? 2 : 1;
}

/** Any value but `0`/`false` turns colour on; `2` and `3` also pick the level. */
function forcedLevel(value: string | undefined): ColorLevel | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (value === "0" || value === "false") {
		return 0;
	}
	if (value === "2" || value === "3") {
		return Number(value) as ColorLevel;
	}
	return 1;
}

// #A78BFA: the 256-colour is the nearest of the xterm cube, #AF87FF.
const ACCENT: Record<Exclude<ColorLevel, 0>, string> = {
	1: "35",
	2: "38;5;141",
	3: "38;2;167;139;250",
};

const identity: Painter = (text) => text;

function sgr(open: string, close: string): Painter {
	return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}

/** Painters close with their own codes, never a full reset, so they nest. */
export function createStyle(level: ColorLevel): Style {
	if (level === 0) {
		return {
			level,
			bold: identity,
			dim: identity,
			good: identity,
			attention: identity,
			bad: identity,
			accent: identity,
		};
	}
	return {
		level,
		bold: sgr("1", "22"),
		dim: sgr("2", "22"),
		good: sgr("32", "39"),
		attention: sgr("33", "39"),
		bad: sgr("31", "39"),
		accent: sgr(ACCENT[level], "39"),
	};
}

const LOOKS: Record<Status, { glyph: string; tone: Tone }> = {
	done: { glyph: "✓", tone: "good" },
	unchanged: { glyph: "○", tone: "dim" },
	attention: { glyph: "!", tone: "attention" },
	failed: { glyph: "✗", tone: "bad" },
	subject: { glyph: "●", tone: "accent" },
	newer: { glyph: "↑", tone: "accent" },
	note: { glyph: "·", tone: "dim" },
};

export function statusTone(status: Status, style: Style): Painter {
	return style[LOOKS[status].tone];
}

export function statusGlyph(status: Status, style: Style): string {
	return statusTone(status, style)(LOOKS[status].glyph);
}

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
	/** Dark text on the accent: a chosen button. */
	onAccent: Painter;
}

/** A colour's red, green and blue, 0 to 255 each. */
export type Rgb = readonly [red: number, green: number, blue: number];

type Tone = "dim" | "good" | "attention" | "bad" | "accent";

export function detectColorLevel(
	env: Readonly<Record<string, string | undefined>>,
	isTTY: boolean,
): ColorLevel {
	if (env.NO_COLOR) {
		return 0;
	}
	const forced = forcedLevel(env.FORCE_COLOR);
	if (forced === 0) {
		return 0;
	}
	if (forced !== undefined) {
		return Math.max(forced, terminalLevel(env)) as ColorLevel;
	}
	return isTTY ? terminalLevel(env) : 0;
}

/** What the terminal says it draws. */
function terminalLevel(
	env: Readonly<Record<string, string | undefined>>,
): ColorLevel {
	if (env.TERM === "dumb") {
		return 0;
	}
	if (/^(truecolor|24bit)$/i.test(env.COLORTERM ?? "")) {
		return 3;
	}
	return env.TERM?.includes("256") ? 2 : 1;
}

/**
 * Any value but `0`/`false` turns colour on, at least at level 1; `2` and `3`
 * raise that floor.
 */
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

// The accent behind #111111 text; at level 2 the nearest xterm-256 colours,
// 141 and 233.
const ON_ACCENT: Record<Exclude<ColorLevel, 0>, string> = {
	1: "45;30",
	2: "48;5;141;38;5;233",
	3: "48;2;167;139;250;38;2;17;17;17",
};

export const identity: Painter = (text) => text;

/** Each line painted, an empty one left empty so it still reads as nothing. */
export function paintLines(lines: readonly string[], paint: Painter): string[] {
	return lines.map((line) => (line === "" ? line : paint(line)));
}

function sgr(open: string, close: string): Painter {
	return (text) => `\x1b[${open}m${text}\x1b[${close}m`;
}

/**
 * Painters close with their own codes, never a full reset, so painters on
 * different axes nest (a colour round bold). Bold and dim share their close,
 * as all colours do, so neither nests inside its own kind.
 */
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
			onAccent: identity,
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
		onAccent: sgr(ON_ACCENT[level], "49;39"),
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
	local: { glyph: "◇", tone: "dim" },
};

export function statusTone(status: Status, style: Style): Painter {
	return style[LOOKS[status].tone];
}

export function statusGlyph(status: Status, style: Style): string {
	return statusTone(status, style)(LOOKS[status].glyph);
}

const ACCENT_RGB: Rgb = [167, 139, 250];
/** How much of the band is the terminal's background; the rest is the accent. */
const BAND_BACKGROUND_SHARE = 0.78;

/**
 * The cursor row's background: the accent mixed into the terminal's own, so
 * it reads on light and dark themes alike. None below 256 colours, or with
 * the background unknown.
 */
export function bandPainter(
	level: ColorLevel,
	background: Rgb | undefined,
): Painter | undefined {
	if (background === undefined || level < 2) {
		return undefined;
	}
	const band = mix(ACCENT_RGB, background, BAND_BACKGROUND_SHARE);
	return sgr(
		level === 3 ? `48;2;${band.join(";")}` : `48;5;${nearest256(band)}`,
		"49",
	);
}

/** `from` moved `share` of the way to `to`, channel by channel. */
export function mix(from: Rgb, to: Rgb, share: number): Rgb {
	return channels((index) =>
		Math.round(from[index] + (to[index] - from[index]) * share),
	);
}

/**
 * The xterm-256 colour nearest `colour`, from the 6×6×6 cube (16 to 231)
 * and the grey ramp (232 to 255); the first 16 are the theme's own, so
 * they're never picked.
 */
export function nearest256(colour: Rgb): number {
	const steps = channels((index) => cubeStep(colour[index]));
	const cube = channels((index) => cubeLevel(steps[index]));
	const mean = (colour[0] + colour[1] + colour[2]) / 3;
	const greyStep = Math.min(23, Math.max(0, Math.round((mean - 8) / 10)));
	const grey = 8 + 10 * greyStep;
	return distance(colour, cube) <= distance(colour, [grey, grey, grey])
		? 16 + 36 * steps[0] + 6 * steps[1] + steps[2]
		: 232 + greyStep;
}

type Channel = 0 | 1 | 2;

function channels(value: (channel: Channel) => number): Rgb {
	return [value(0), value(1), value(2)];
}

/** The cube's levels are 0, 95, 135, 175, 215 and 255. */
function cubeStep(channel: number): number {
	if (channel < 48) {
		return 0;
	}
	return channel < 115 ? 1 : Math.floor((channel - 35) / 40);
}

function cubeLevel(step: number): number {
	return step === 0 ? 0 : 55 + 40 * step;
}

function distance(a: Rgb, b: Rgb): number {
	return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

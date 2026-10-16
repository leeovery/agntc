import type { ColorLevel, Rgb } from "../style.js";
import type { InputFilter } from "./input-filter.js";

/** OSC 11 asks the terminal for its background colour. */
export const BACKGROUND_QUERY = "\x1b]11;?\x07";
const ANSWER_MS = 150;
const REPLY = "11;";
const COLOUR = /^11;rgb:([0-9a-f]{1,4})\/([0-9a-f]{1,4})\/([0-9a-f]{1,4})$/i;

interface Streams {
	input: { isTTY?: boolean };
	output: { isTTY?: boolean; write(text: string): unknown };
}

let asked: Promise<Rgb | undefined> | undefined;

/**
 * The terminal's background, asked once per process: the first call asks
 * when both streams are terminals and colour reaches 256, and every call
 * after shares its answer.
 */
export function terminalBackground(
	filter: InputFilter,
	streams: Streams,
	level: ColorLevel,
): Promise<Rgb | undefined> {
	asked ??=
		streams.input.isTTY === true && streams.output.isTTY === true && level >= 2
			? queryBackground(filter, streams.output)
			: Promise.resolve(undefined);
	return asked;
}

/**
 * Asks the terminal for its background and waits for the reply through
 * `filter`: undefined when none comes in time or it doesn't read as a colour.
 * Raw mode must be on, so the reply is neither echoed nor held for a newline.
 */
export function queryBackground(
	filter: InputFilter,
	output: Streams["output"],
	waitMs = ANSWER_MS,
): Promise<Rgb | undefined> {
	return new Promise((resolve) => {
		const answer = (colour: Rgb | undefined) => {
			clearTimeout(timer);
			stop();
			resolve(colour);
		};
		const stop = filter.onSequence((body) => {
			if (body.startsWith(REPLY)) {
				answer(parseBackground(body));
			}
		});
		const timer = setTimeout(() => answer(undefined), waitMs);
		output.write(BACKGROUND_QUERY);
	});
}

/** `11;rgb:RRRR/GGGG/BBBB`, each channel 1 to 4 hex digits, scaled to 0–255. */
export function parseBackground(body: string): Rgb | undefined {
	const match = COLOUR.exec(body);
	if (match === null) {
		return undefined;
	}
	const [, red = "", green = "", blue = ""] = match;
	return [toByte(red), toByte(green), toByte(blue)];
}

function toByte(hex: string): number {
	return Math.round((Number.parseInt(hex, 16) / (16 ** hex.length - 1)) * 255);
}

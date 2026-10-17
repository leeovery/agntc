import { describe, expect, it } from "vitest";
import {
	failure,
	isMachineOnly,
	machineOnly,
	plainText,
	sentence,
} from "../src/message.js";

describe("machineOnly", () => {
	it("says its words to machine mode alone", () => {
		const message = machineOnly("a note for the document");

		expect(isMachineOnly(message)).toBe(true);
		expect(plainText(message)).toBe("a note for the document");
	});
});

describe("sentence", () => {
	it("says the same words in both modes, for the terminal to wrap", () => {
		const message = sentence("--plugin is now --pack");

		expect(message).toEqual({
			text: "--plugin is now --pack",
			plain: "--plugin is now --pack",
		});
		expect(isMachineOnly(message)).toBe(false);
	});
});

describe("failure", () => {
	it("is its one line, kept whole for machine mode", () => {
		expect(failure("git clone failed")).toEqual({
			text: "git clone failed",
			plain: "git clone failed",
		});
	});

	it("says its first line, and the rest beneath as its cause", () => {
		expect(failure('no skill named a\n"b" matches more than one\nc')).toEqual({
			text: "no skill named a",
			cause: '"b" matches more than one\nc',
			plain: 'no skill named a\n"b" matches more than one\nc',
		});
	});
});

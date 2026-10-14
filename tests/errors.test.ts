import { describe, expect, it } from "vitest";
import { errorMessage, gitErrorCause, isNodeError } from "../src/errors.js";
import { SSH_REFUSAL } from "./helpers/git-mocks.js";

describe("isNodeError", () => {
	it("returns true for Error with code property", () => {
		const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
		expect(isNodeError(err)).toBe(true);
	});

	it("returns false for plain Error without code", () => {
		expect(isNodeError(new Error("plain"))).toBe(false);
	});

	it("returns false for non-Error object with code", () => {
		expect(isNodeError({ code: "ENOENT" })).toBe(false);
	});

	it("returns false for null", () => {
		expect(isNodeError(null)).toBe(false);
	});

	it("returns false for undefined", () => {
		expect(isNodeError(undefined)).toBe(false);
	});

	it("returns false for string", () => {
		expect(isNodeError("ENOENT")).toBe(false);
	});
});

describe("errorMessage", () => {
	it("returns the message property for Error instances", () => {
		expect(errorMessage(new Error("something broke"))).toBe("something broke");
	});

	it("returns String(err) for non-Error values", () => {
		expect(errorMessage("raw string")).toBe("raw string");
		expect(errorMessage(42)).toBe("42");
		expect(errorMessage(null)).toBe("null");
		expect(errorMessage(undefined)).toBe("undefined");
		expect(errorMessage({ foo: "bar" })).toBe("[object Object]");
	});
});

describe("gitErrorCause", () => {
	it("keeps the first line of git's error, without the advice after it", () => {
		expect(gitErrorCause(SSH_REFUSAL)).toBe(
			"git@github.com: Permission denied (publickey).",
		);
	});

	it("skips blank lines to reach the first one with words", () => {
		expect(gitErrorCause("\n  \n  remote: Repository not found.\n")).toBe(
			"remote: Repository not found.",
		);
	});

	it("takes git's fatal: off the line it keeps", () => {
		expect(
			gitErrorCause(
				"fatal: unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com\n",
			),
		).toBe(
			"unable to access 'https://github.com/o/r.git/': Could not resolve host: github.com",
		);
	});

	it("leaves a fatal: that isn't the line's start alone", () => {
		expect(gitErrorCause("ssh: fatal: no route")).toBe("ssh: fatal: no route");
	});

	it("passes over ssh's known-hosts warning to the line that names the failure", () => {
		expect(
			gitErrorCause(
				`Warning: Permanently added 'github.com' (ED25519) to the list of known hosts.\n${SSH_REFUSAL}`,
			),
		).toBe("git@github.com: Permission denied (publickey).");
	});

	it("passes over git's warnings, hints and clone progress", () => {
		expect(
			gitErrorCause(
				[
					"Cloning into '/tmp/agntc-abc'...",
					"warning: redirecting to https://github.com/o/r.git/",
					"hint: Using 'master' as the name for the initial branch.",
					"fatal: Remote branch v9 not found in upstream origin",
				].join("\n"),
			),
		).toBe("Remote branch v9 not found in upstream origin");
	});

	it("gives the first line when every line is one it would pass over", () => {
		expect(gitErrorCause("warning: something odd\nhint: try this")).toBe(
			"warning: something odd",
		);
	});

	it("says a timed-out command timed out, and after how long", () => {
		expect(
			gitErrorCause(
				"git ls-remote timed out after 15s\nCommand failed: git ls-remote --tags https://github.com/o/r.git\n",
			),
		).toBe("git ls-remote timed out after 15s");
	});

	it("keeps a one-line message as it is", () => {
		expect(gitErrorCause("network timeout")).toBe("network timeout");
	});
});

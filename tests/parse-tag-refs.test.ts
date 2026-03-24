import { describe, expect, it } from "vitest";
import { parseTagRefs } from "../src/git-utils.js";

describe("parseTagRefs", () => {
	it("parses standard ls-remote --tags output into tag/sha pairs", () => {
		const stdout = [
			"abc123\trefs/tags/v1.0.0",
			"def456\trefs/tags/v1.1.0",
			"ghi789\trefs/tags/v2.0.0",
		].join("\n");

		const result = parseTagRefs(stdout);

		expect(result).toEqual([
			{ tag: "v1.0.0", sha: "abc123" },
			{ tag: "v1.1.0", sha: "def456" },
			{ tag: "v2.0.0", sha: "ghi789" },
		]);
	});

	it("filters out ^{} annotated tag refs", () => {
		const stdout = [
			"abc123\trefs/tags/v1.0.0",
			"abc124\trefs/tags/v1.0.0^{}",
			"def456\trefs/tags/v2.0.0",
			"def457\trefs/tags/v2.0.0^{}",
		].join("\n");

		const result = parseTagRefs(stdout);

		expect(result).toEqual([
			{ tag: "v1.0.0", sha: "abc123" },
			{ tag: "v2.0.0", sha: "def456" },
		]);
	});

	it("returns empty array for empty string", () => {
		const result = parseTagRefs("");

		expect(result).toEqual([]);
	});

	it("returns empty array for whitespace-only string", () => {
		const result = parseTagRefs("  \n  \n  ");

		expect(result).toEqual([]);
	});

	it("handles trailing newline", () => {
		const stdout = "abc123\trefs/tags/v1.0.0\n";

		const result = parseTagRefs(stdout);

		expect(result).toEqual([{ tag: "v1.0.0", sha: "abc123" }]);
	});

	it("handles mixed empty lines in output", () => {
		const stdout = [
			"abc123\trefs/tags/v1.0.0",
			"",
			"def456\trefs/tags/v2.0.0",
			"",
		].join("\n");

		const result = parseTagRefs(stdout);

		expect(result).toEqual([
			{ tag: "v1.0.0", sha: "abc123" },
			{ tag: "v2.0.0", sha: "def456" },
		]);
	});
});

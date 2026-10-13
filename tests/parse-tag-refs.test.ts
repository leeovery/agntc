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

	it("takes an annotated tag's commit from its peeled line, not the tag object", () => {
		const stdout = [
			"abc123\trefs/tags/v1.0.0",
			"abc124\trefs/tags/v1.0.0^{}",
			"def456\trefs/tags/v2.0.0",
			"def457\trefs/tags/v2.0.0^{}",
		].join("\n");

		const result = parseTagRefs(stdout);

		expect(result).toEqual([
			{ tag: "v1.0.0", sha: "abc124" },
			{ tag: "v2.0.0", sha: "def457" },
		]);
	});

	it("keeps a lightweight tag's own sha, which is its commit", () => {
		const stdout = "abc123\trefs/tags/v1.0.0\n";

		expect(parseTagRefs(stdout)).toEqual([{ tag: "v1.0.0", sha: "abc123" }]);
	});

	it("takes each tag's commit in a mix of annotated and lightweight tags, in order", () => {
		const stdout = [
			"aaa111\trefs/tags/v1.0.0",
			"bbb111\trefs/tags/v1.1.0",
			"bbb222\trefs/tags/v1.1.0^{}",
			"ccc111\trefs/tags/v2.0.0",
		].join("\n");

		const result = parseTagRefs(stdout);

		expect(result).toEqual([
			{ tag: "v1.0.0", sha: "aaa111" },
			{ tag: "v1.1.0", sha: "bbb222" },
			{ tag: "v2.0.0", sha: "ccc111" },
		]);
	});

	it("takes the peeled sha even when it is listed before the tag object", () => {
		const stdout = [
			"abc124\trefs/tags/v1.0.0^{}",
			"abc123\trefs/tags/v1.0.0",
		].join("\n");

		expect(parseTagRefs(stdout)).toEqual([{ tag: "v1.0.0", sha: "abc124" }]);
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

import { describe, expect, it } from "vitest";
import { parseRefProbe } from "../src/update-check.js";

const HEAD_SHA = "1111111111111111111111111111111111111111";
const TAG_SHA = "2222222222222222222222222222222222222222";
const PEELED_SHA = "3333333333333333333333333333333333333333";
const OTHER_SHA = "4444444444444444444444444444444444444444";

describe("parseRefProbe", () => {
	it("returns only headSha when only the refs/heads/{ref} line is present", () => {
		const stdout = `${HEAD_SHA}\trefs/heads/v4\n`;

		const result = parseRefProbe(stdout, "v4");

		expect(result).toEqual({ headSha: HEAD_SHA, tagSha: null });
	});

	it("returns only tagSha when only the refs/tags/{ref} line is present", () => {
		const stdout = `${TAG_SHA}\trefs/tags/v4.9.0\n`;

		const result = parseRefProbe(stdout, "v4.9.0");

		expect(result).toEqual({ headSha: null, tagSha: TAG_SHA });
	});

	it("returns both shas when both refs/heads and refs/tags lines are present", () => {
		const stdout = [
			`${HEAD_SHA}\trefs/heads/v4`,
			`${TAG_SHA}\trefs/tags/v4`,
		].join("\n");

		const result = parseRefProbe(stdout, "v4");

		expect(result).toEqual({ headSha: HEAD_SHA, tagSha: TAG_SHA });
	});

	it("ignores the peeled refs/tags/{ref}^{} line and keeps the real tag sha", () => {
		const stdout = [
			`${TAG_SHA}\trefs/tags/v4.9.0`,
			`${PEELED_SHA}\trefs/tags/v4.9.0^{}`,
		].join("\n");

		const result = parseRefProbe(stdout, "v4.9.0");

		expect(result).toEqual({ headSha: null, tagSha: TAG_SHA });
	});

	it("returns both null for empty stdout", () => {
		const result = parseRefProbe("", "v4");

		expect(result).toEqual({ headSha: null, tagSha: null });
	});

	it("does not cross-match a loose prefix (refs/heads/release-candidate for ref 'release')", () => {
		const stdout = [
			`${HEAD_SHA}\trefs/heads/release`,
			`${OTHER_SHA}\trefs/heads/release-candidate`,
		].join("\n");

		const result = parseRefProbe(stdout, "release");

		expect(result).toEqual({ headSha: HEAD_SHA, tagSha: null });
	});

	it("matches a slash-in-name ref only on its exact ref path", () => {
		const stdout = [
			`${HEAD_SHA}\trefs/heads/feature/x`,
			`${TAG_SHA}\trefs/tags/feature/x`,
			`${OTHER_SHA}\trefs/heads/feature/xyz`,
		].join("\n");

		const result = parseRefProbe(stdout, "feature/x");

		expect(result).toEqual({ headSha: HEAD_SHA, tagSha: TAG_SHA });
	});

	it("produces an identical result regardless of line order", () => {
		const headsThenTags = [
			`${HEAD_SHA}\trefs/heads/v4`,
			`${TAG_SHA}\trefs/tags/v4`,
		].join("\n");
		const tagsThenHeads = [
			`${TAG_SHA}\trefs/tags/v4`,
			`${HEAD_SHA}\trefs/heads/v4`,
		].join("\n");

		const forward = parseRefProbe(headsThenTags, "v4");
		const reversed = parseRefProbe(tagsThenHeads, "v4");

		expect(forward).toEqual({ headSha: HEAD_SHA, tagSha: TAG_SHA });
		expect(reversed).toEqual(forward);
	});
});

import { describe, expect, it } from "vitest";
import { normalizeTags } from "../src/version-resolve.js";

describe("normalizeTags", () => {
	it("normalizes v-prefixed tag to clean semver", () => {
		const result = normalizeTags(["v1.2.3"]);
		expect(result).toEqual(new Map([["1.2.3", "v1.2.3"]]));
	});

	it("keeps bare semver tag as-is", () => {
		const result = normalizeTags(["1.0.0"]);
		expect(result).toEqual(new Map([["1.0.0", "1.0.0"]]));
	});

	it("prefers v-prefixed tag when duplicate versions exist", () => {
		const result = normalizeTags(["v1.2.3", "1.2.3"]);
		expect(result).toEqual(new Map([["1.2.3", "v1.2.3"]]));
	});

	it("prefers v-prefixed tag regardless of input order", () => {
		const result = normalizeTags(["1.2.3", "v1.2.3"]);
		expect(result).toEqual(new Map([["1.2.3", "v1.2.3"]]));
	});

	it("excludes non-semver tags", () => {
		const result = normalizeTags(["release-candidate", "latest", "nope"]);
		expect(result).toEqual(new Map());
	});

	it("handles empty tag list", () => {
		const result = normalizeTags([]);
		expect(result).toEqual(new Map());
	});

	it("filters mixed semver and non-semver tags", () => {
		const result = normalizeTags(["v1.0.0", "v2.0.0", "latest"]);
		expect(result).toEqual(
			new Map([
				["1.0.0", "v1.0.0"],
				["2.0.0", "v2.0.0"],
			]),
		);
	});

	it("handles no semver tags at all", () => {
		const result = normalizeTags(["alpha", "beta", "rc1"]);
		expect(result).toEqual(new Map());
	});

	it("strips whitespace from tags via clean()", () => {
		const result = normalizeTags(["  v1.0.0  ", " 2.0.0 "]);
		expect(result).toEqual(
			new Map([
				["1.0.0", "  v1.0.0  "],
				["2.0.0", " 2.0.0 "],
			]),
		);
	});

	it("handles pre-release tags", () => {
		const result = normalizeTags(["v1.0.0-beta.1", "v1.0.0"]);
		expect(result).toEqual(
			new Map([
				["1.0.0-beta.1", "v1.0.0-beta.1"],
				["1.0.0", "v1.0.0"],
			]),
		);
	});
});

import { describe, expect, it } from "vitest";
import {
	normalizeTags,
	resolveLatestVersion,
	resolveVersion,
} from "../src/version-resolve.js";

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

describe("resolveVersion", () => {
	it("resolves highest version within caret constraint", () => {
		const result = resolveVersion("^1.0", ["v1.0.0", "v1.1.0", "v2.0.0"]);
		expect(result).toEqual({ tag: "v1.1.0", version: "1.1.0" });
	});

	it("resolves highest version within tilde constraint", () => {
		const result = resolveVersion("~1.0.0", ["v1.0.0", "v1.0.5", "v1.1.0"]);
		expect(result).toEqual({ tag: "v1.0.5", version: "1.0.5" });
	});

	it("returns null when no tags satisfy constraint", () => {
		const result = resolveVersion("^3.0", ["v1.0.0", "v2.0.0"]);
		expect(result).toBeNull();
	});

	it("excludes pre-release tags from matching", () => {
		const result = resolveVersion("^1.0", [
			"v1.0.0",
			"v1.1.0-beta.1",
			"v1.1.0",
		]);
		expect(result).toEqual({ tag: "v1.1.0", version: "1.1.0" });
	});

	it("handles pre-1.0 caret semantics (^0.2.3 is minor-bounded)", () => {
		const result = resolveVersion("^0.2.3", ["v0.2.3", "v0.2.5", "v0.3.0"]);
		expect(result).toEqual({ tag: "v0.2.5", version: "0.2.5" });
	});

	it("handles pre-1.0 caret semantics (^0.0.3 is patch-bounded)", () => {
		const result = resolveVersion("^0.0.3", ["v0.0.3", "v0.0.4", "v0.1.0"]);
		expect(result).toEqual({ tag: "v0.0.3", version: "0.0.3" });
	});

	it("resolves partial constraint (^1) against full version tags", () => {
		const result = resolveVersion("^1", ["v1.0.0", "v1.5.0", "v2.0.0"]);
		expect(result).toEqual({ tag: "v1.5.0", version: "1.5.0" });
	});

	it("resolves partial constraint (~1.2) against full tags", () => {
		const result = resolveVersion("~1.2", ["v1.2.0", "v1.2.5", "v1.3.0"]);
		expect(result).toEqual({ tag: "v1.2.5", version: "1.2.5" });
	});

	it("returns original v-prefixed tag name, not cleaned version", () => {
		const result = resolveVersion("^1.0", ["v1.0.0", "v1.1.0"]);
		expect(result).not.toBeNull();
		expect(result?.tag).toBe("v1.1.0");
		expect(result?.version).toBe("1.1.0");
	});

	it("returns null for empty tag list", () => {
		const result = resolveVersion("^1.0", []);
		expect(result).toBeNull();
	});

	it("handles mixed v-prefixed and bare tags", () => {
		const result = resolveVersion("^1.0", ["1.0.0", "v1.2.0", "1.3.0"]);
		expect(result).toEqual({ tag: "1.3.0", version: "1.3.0" });
	});
});

describe("resolveLatestVersion", () => {
	it("finds highest stable version", () => {
		const result = resolveLatestVersion(["v1.0.0", "v2.0.0", "v2.0.0-beta.1"]);
		expect(result).toEqual({ tag: "v2.0.0", version: "2.0.0" });
	});

	it("returns null when no semver tags exist", () => {
		const result = resolveLatestVersion(["alpha", "beta"]);
		expect(result).toBeNull();
	});

	it("excludes pre-release from latest", () => {
		const result = resolveLatestVersion([
			"v1.0.0",
			"v2.0.0-beta.1",
			"v2.0.0-rc.1",
		]);
		expect(result).toEqual({ tag: "v1.0.0", version: "1.0.0" });
	});
});

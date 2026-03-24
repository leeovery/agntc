import { describe, expect, it } from "vitest";
import { isAtOrAboveVersion } from "../src/version-resolve.js";

describe("isAtOrAboveVersion", () => {
	it("returns true when current ref is greater than candidate tag", () => {
		expect(isAtOrAboveVersion("v1.3.0", "v1.2.0")).toBe(true);
	});

	it("returns false when current ref is less than candidate tag", () => {
		expect(isAtOrAboveVersion("v1.2.0", "v1.3.0")).toBe(false);
	});

	it("returns false when current ref is non-semver", () => {
		expect(isAtOrAboveVersion("main", "v1.0.0")).toBe(false);
	});

	it("returns false when current ref is null", () => {
		expect(isAtOrAboveVersion(null, "v1.0.0")).toBe(false);
	});

	it("returns true when versions are equal", () => {
		expect(isAtOrAboveVersion("v1.0.0", "v1.0.0")).toBe(true);
	});

	it("returns false when candidate tag is non-semver", () => {
		expect(isAtOrAboveVersion("v1.0.0", "latest")).toBe(false);
	});

	it("returns false when both are non-semver", () => {
		expect(isAtOrAboveVersion("main", "develop")).toBe(false);
	});
});

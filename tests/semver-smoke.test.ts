import * as semver from "semver";
import { describe, expect, it } from "vitest";

describe("semver smoke tests", () => {
	it("semver is importable and clean() returns expected value", () => {
		expect(semver.clean("v1.2.3")).toBe("1.2.3");
	});

	it("semver maxSatisfying works with caret constraint", () => {
		expect(semver.maxSatisfying(["1.0.0", "1.1.0", "2.0.0"], "^1.0.0")).toBe(
			"1.1.0",
		);
	});
});

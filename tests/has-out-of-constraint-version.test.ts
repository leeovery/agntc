import { describe, expect, it } from "vitest";
import {
	hasOutOfConstraintVersion,
	type UpdateCheckResult,
} from "../src/update-check.js";

describe("hasOutOfConstraintVersion", () => {
	it("returns true for constrained-update-available with latestOverall", () => {
		const result: UpdateCheckResult = {
			status: "constrained-update-available",
			tag: "v2.1.0",
			commit: "a".repeat(40),
			latestOverall: "v3.0.0",
		};
		expect(hasOutOfConstraintVersion(result)).toBe(true);
	});

	it("returns true for constrained-up-to-date with latestOverall", () => {
		const result: UpdateCheckResult = {
			status: "constrained-up-to-date",
			latestOverall: "v3.0.0",
		};
		expect(hasOutOfConstraintVersion(result)).toBe(true);
	});

	it("returns false for constrained-update-available with null latestOverall", () => {
		const result: UpdateCheckResult = {
			status: "constrained-update-available",
			tag: "v2.1.0",
			commit: "a".repeat(40),
			latestOverall: null,
		};
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});

	it("returns false for constrained-up-to-date with null latestOverall", () => {
		const result: UpdateCheckResult = {
			status: "constrained-up-to-date",
			latestOverall: null,
		};
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});

	it("returns false for up-to-date status", () => {
		const result: UpdateCheckResult = { status: "up-to-date" };
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});

	it("returns false for update-available status", () => {
		const result: UpdateCheckResult = {
			status: "update-available",
			remoteCommit: "b".repeat(40),
		};
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});

	it("returns false for local status", () => {
		const result: UpdateCheckResult = { status: "local" };
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});

	it("returns false for check-failed status", () => {
		const result: UpdateCheckResult = {
			status: "check-failed",
			reason: "network error",
		};
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});

	it("returns false for constrained-no-match status", () => {
		const result: UpdateCheckResult = { status: "constrained-no-match" };
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});

	it("returns false for newer-tags status", () => {
		const result: UpdateCheckResult = {
			status: "newer-tags",
			tags: ["v2.0.0"],
		};
		expect(hasOutOfConstraintVersion(result)).toBe(false);
	});
});

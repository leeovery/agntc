import { describe, expect, it } from "vitest";
import {
	formatAssetCounts,
	formatRefLabel,
	joinWithAnd,
	renderUpdateOutcomeSummary,
} from "../src/summary.js";

describe("formatRefLabel", () => {
	it("returns ref when ref is not null", () => {
		expect(formatRefLabel("v2.1.6", "abc1234")).toBe("v2.1.6");
	});

	it("returns 'local' when ref is null and commit is null", () => {
		expect(formatRefLabel(null, null)).toBe("local");
	});

	it("returns 'HEAD' when ref is null and commit is present", () => {
		expect(formatRefLabel(null, "abc1234def5678")).toBe("HEAD");
	});
});

describe("formatAssetCounts", () => {
	it("names each asset type with its count", () => {
		expect(formatAssetCounts({ skills: 12, agents: 3, hooks: 2 })).toBe(
			"12 skills, 3 agents, 2 hooks",
		);
	});

	it("omits zero-count asset types", () => {
		expect(formatAssetCounts({ skills: 5, agents: 0, hooks: 0 })).toBe(
			"5 skills",
		);
	});

	it("uses singular form for count of 1", () => {
		expect(formatAssetCounts({ skills: 1, agents: 1, hooks: 1 })).toBe(
			"1 skill, 1 agent, 1 hook",
		);
	});

	it("returns an empty string when nothing was counted", () => {
		expect(formatAssetCounts({})).toBe("");
	});
});

describe("joinWithAnd", () => {
	it("joins with commas and a final and", () => {
		expect(joinWithAnd(["a", "b", "c"])).toBe("a, b and c");
	});

	it("joins two with and", () => {
		expect(joinWithAnd(["a", "b"])).toBe("a and b");
	});

	it("returns one item as is, and nothing as empty", () => {
		expect(joinWithAnd(["a"])).toBe("a");
		expect(joinWithAnd([])).toBe("");
	});
});

describe("renderUpdateOutcomeSummary", () => {
	it("formats git update outcome with commit transition", () => {
		const result = renderUpdateOutcomeSummary({
			type: "git-update",
			key: "owner/repo",
			oldRef: null,
			newRef: null,
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
		});
		expect(result).toBe("owner/repo: Updated abc1234 -> def4567");
	});

	it("git-update renders tags for a constrained update and hashes for a branch update", () => {
		const constrained = renderUpdateOutcomeSummary({
			type: "git-update",
			key: "owner/repo",
			oldRef: "v1.2.3",
			newRef: "v1.3.0",
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
		});
		expect(constrained).toBe("owner/repo: Updated v1.2.3 -> v1.3.0");

		const branch = renderUpdateOutcomeSummary({
			type: "git-update",
			key: "owner/repo",
			oldRef: "main",
			newRef: "main",
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
		});
		expect(branch).toBe("owner/repo: Updated abc1234 -> def4567");
	});

	it("formats local update outcome", () => {
		const result = renderUpdateOutcomeSummary({
			type: "local-update",
			key: "/path/to/plugin",
		});
		expect(result).toBe("/path/to/plugin: Refreshed from local path");
	});

	it("local-update is unchanged (no version move, tag rule untouched)", () => {
		const plain = renderUpdateOutcomeSummary({
			type: "local-update",
			key: "/path/to/plugin",
		});
		expect(plain).toBe("/path/to/plugin: Refreshed from local path");
	});
});

describe("edge cases", () => {
	it("all up-to-date produces no crashed output from outcome formatter", () => {
		// This tests that we can call the outcome formatter with various statuses
		// without crashes; the actual "all up to date" message is in the command layer
		const gitResult = renderUpdateOutcomeSummary({
			type: "git-update",
			key: "owner/repo",
			oldRef: null,
			newRef: null,
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
		});
		expect(gitResult).toBeTruthy();
	});
});

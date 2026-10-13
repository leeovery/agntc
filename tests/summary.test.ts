import { describe, expect, it } from "vitest";
import {
	formatAssetCounts,
	formatRefLabel,
	type PluginInstallResult,
	renderAddSummary,
	renderCollectionAddSummary,
	renderGitUpdateSummary,
	renderLocalUpdateSummary,
	renderRemoveSummary,
	renderUpdateOutcomeSummary,
} from "../src/summary.js";
import { formatVersionMove } from "../src/version-resolve.js";

function installed(pluginName: string): PluginInstallResult {
	return {
		pluginName,
		pluginSegment: pluginName,
		status: "installed",
		copiedFiles: [`.claude/skills/${pluginName}/`],
		detectedType: { type: "bare-skill" },
	};
}

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

describe("renderAddSummary", () => {
	it("formats a plugin add as headline + one asset-count line", () => {
		const result = renderAddSummary({
			manifestKey: "leeovery/claude-technical-workflows",
			ref: "v2.1.6",
			commit: "abc1234",
			assetCounts: { skills: 12, agents: 3, hooks: 2 },
		});
		expect(result).toEqual({
			headline: "Installed leeovery/claude-technical-workflows@v2.1.6",
			detail: ["12 skills, 3 agents, 2 hooks"],
		});
	});

	it("formats a bare skill add as headline + one skill line", () => {
		const result = renderAddSummary({
			manifestKey: "owner/my-skill",
			ref: "main",
			commit: "abc123def456",
			assetCounts: { skills: 1 },
		});
		expect(result).toEqual({
			headline: "Installed owner/my-skill@main",
			detail: ["1 skill"],
		});
	});

	it("emits no detail line when nothing was counted", () => {
		const result = renderAddSummary({
			manifestKey: "owner/my-skill",
			ref: "main",
			commit: "abc123def456",
			assetCounts: {},
		});
		expect(result.detail).toEqual([]);
	});

	it("uses HEAD label when ref is null with commit", () => {
		const result = renderAddSummary({
			manifestKey: "owner/my-skill",
			ref: null,
			commit: "abc123",
			assetCounts: { skills: 1 },
		});
		expect(result.headline).toContain("owner/my-skill@HEAD");
	});

	it("uses local label when ref and commit are null", () => {
		const result = renderAddSummary({
			manifestKey: "owner/my-skill",
			ref: null,
			commit: null,
			assetCounts: { skills: 1 },
		});
		expect(result.headline).toContain("owner/my-skill@local");
	});
});

describe("renderCollectionAddSummary", () => {
	it("shows one row per installed member, naming only the member", () => {
		const result = renderCollectionAddSummary({
			manifestKey: "owner/my-collection",
			ref: "main",
			commit: "abc123",
			results: [installed("pluginA"), installed("pluginB")],
		});
		expect(result.headline).toBe("Installed owner/my-collection@main");
		expect(result.detail).toEqual(["pluginA", "pluginB"]);
	});

	it("notes skipped plugins", () => {
		const result = renderCollectionAddSummary({
			manifestKey: "owner/my-collection",
			ref: "main",
			commit: "abc123",
			results: [
				installed("pluginA"),
				{ pluginName: "pluginB", status: "skipped", copiedFiles: [] },
			],
		});
		expect(result.detail.join("\n")).toMatch(/1 skipped/);
	});

	it("notes failed plugins with error messages", () => {
		const result = renderCollectionAddSummary({
			manifestKey: "owner/my-collection",
			ref: "main",
			commit: "abc123",
			results: [
				{
					pluginName: "pluginA",
					status: "failed",
					copiedFiles: [],
					errorMessage: "permission denied",
				},
			],
		});
		expect(result.detail.join("\n")).toMatch(
			/pluginA: failed — permission denied/,
		);
	});

	it("handles mixed outcomes: installed, skipped, and failed", () => {
		const result = renderCollectionAddSummary({
			manifestKey: "owner/my-collection",
			ref: "v1.0",
			commit: "abc123",
			results: [
				installed("pluginA"),
				{ pluginName: "pluginB", status: "skipped", copiedFiles: [] },
				{
					pluginName: "pluginC",
					status: "failed",
					copiedFiles: [],
					errorMessage: "disk full",
				},
			],
		});
		expect(result.detail).toEqual([
			"pluginA",
			"1 skipped",
			"pluginC: failed — disk full",
		]);
	});
});

describe("renderGitUpdateSummary", () => {
	it("shows commit transition and file count", () => {
		const result = renderGitUpdateSummary({
			key: "owner/repo",
			oldRef: null,
			newRef: null,
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
			copiedFiles: [".claude/skills/my-skill/file1.md"],
		});
		expect(result).toBe("Updated owner/repo: abc1234 -> def4567 — 1 file(s)");
	});

	it("uses 'unknown' when old commit is null", () => {
		const result = renderGitUpdateSummary({
			key: "owner/repo",
			oldRef: null,
			newRef: null,
			oldCommit: null,
			newCommit: "def4567890abc",
			copiedFiles: [],
		});
		expect(result).toContain("unknown -> def4567");
	});

	it("renders tags for a constrained update (v1.2.3 -> v1.3.0)", () => {
		const result = renderGitUpdateSummary({
			key: "owner/repo",
			oldRef: "v1.2.3",
			newRef: "v1.3.0",
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
			copiedFiles: [".claude/skills/my-skill/file1.md"],
		});
		// Both refs are semver tags and the ref moved → the shared rule renders tags,
		// not commit hashes. The file-count tail is unchanged.
		expect(result).toBe("Updated owner/repo: v1.2.3 -> v1.3.0 — 1 file(s)");
	});

	it("falls to short hashes for a branch update (oldRef === newRef)", () => {
		const result = renderGitUpdateSummary({
			key: "owner/repo",
			oldRef: "main",
			newRef: "main",
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
			copiedFiles: [".claude/skills/my-skill/file1.md"],
		});
		// A branch update keeps the ref name fixed (only the commit moved), so the
		// "ref actually moved" guard sends it to hashes.
		expect(result).toBe("Updated owner/repo: abc1234 -> def4567 — 1 file(s)");
	});

	it("falls to short hashes for a HEAD update (newRef null)", () => {
		const result = renderGitUpdateSummary({
			key: "owner/repo",
			oldRef: null,
			newRef: null,
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
			copiedFiles: [".claude/skills/my-skill/file1.md"],
		});
		expect(result).toBe("Updated owner/repo: abc1234 -> def4567 — 1 file(s)");
	});

	it("still renders unknown -> <newShort> when old commit is null (hash path)", () => {
		const result = renderGitUpdateSummary({
			key: "owner/repo",
			oldRef: null,
			newRef: null,
			oldCommit: null,
			newCommit: "def4567890abc",
			copiedFiles: [],
		});
		expect(result).toContain("unknown -> def4567");
	});
});

describe("renderLocalUpdateSummary", () => {
	it("shows refreshed with file count", () => {
		const result = renderLocalUpdateSummary({
			key: "/path/to/plugin",
			copiedFiles: [
				".claude/skills/my-skill/file1.md",
				".claude/skills/my-skill/file2.md",
			],
		});
		expect(result).toBe("Refreshed /path/to/plugin — 2 file(s)");
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

describe("shared tag-vs-hash rule across surfaces", () => {
	it("single-key and all-mode produce the identical move substring for the same old/new refs (shared rule, no divergence)", () => {
		const move = {
			oldRef: "v1.2.3",
			newRef: "v1.3.0",
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
		};
		const singleKey = renderGitUpdateSummary({
			key: "owner/repo",
			...move,
			copiedFiles: [".claude/skills/my-skill/file1.md"],
		});
		const allMode = renderUpdateOutcomeSummary({
			type: "git-update",
			key: "owner/repo",
			...move,
		});

		// The one shared rule produces the move; both surfaces embed it verbatim.
		const expectedMove = formatVersionMove(move);
		expect(expectedMove).toBe("v1.2.3 -> v1.3.0");
		expect(singleKey).toContain(expectedMove);
		expect(allMode).toContain(expectedMove);
	});

	it("both surfaces fall to the identical hash move for a branch update", () => {
		const move = {
			oldRef: "main",
			newRef: "main",
			oldCommit: "abc1234567890",
			newCommit: "def4567890abc",
		};
		const singleKey = renderGitUpdateSummary({
			key: "owner/repo",
			...move,
			copiedFiles: [],
		});
		const allMode = renderUpdateOutcomeSummary({
			type: "git-update",
			key: "owner/repo",
			...move,
		});

		const expectedMove = formatVersionMove(move);
		expect(expectedMove).toBe("abc1234 -> def4567");
		expect(singleKey).toContain(expectedMove);
		expect(allMode).toContain(expectedMove);
	});
});

describe("renderRemoveSummary", () => {
	it("shows key and file count", () => {
		const result = renderRemoveSummary({
			summaryLabel: "owner/repo",
			fileCount: 5,
		});
		expect(result).toBe("Removed owner/repo — 5 file(s)");
	});

	it("shows count label for multiple plugins", () => {
		const result = renderRemoveSummary({
			summaryLabel: "3 plugin(s)",
			fileCount: 12,
		});
		expect(result).toBe("Removed 3 plugin(s) — 12 file(s)");
	});

	it("handles zero files", () => {
		const result = renderRemoveSummary({
			summaryLabel: "owner/repo",
			fileCount: 0,
		});
		expect(result).toBe("Removed owner/repo — 0 file(s)");
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

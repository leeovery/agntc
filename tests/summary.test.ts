import { describe, expect, it } from "vitest";
import {
	formatAssetCounts,
	formatRefLabel,
	type ItemIdentity,
	type ItemOutcome,
	joinWithAnd,
	renderAddSummary,
	renderGitUpdateSummary,
	renderLocalUpdateSummary,
	renderRemoveSummary,
	renderUpdateOutcomeSummary,
} from "../src/summary.js";
import { formatVersionMove } from "../src/version-resolve.js";

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

describe("renderAddSummary", () => {
	function item(label: string, kind: "skill" | "pack" = "skill"): ItemIdentity {
		return { label, key: `owner/repo/${label}`, kind, path: label };
	}

	function skill(label: string): ItemOutcome {
		return {
			...item(label),
			status: "installed",
			assetCounts: { skills: 1 },
			files: [],
		};
	}

	it("gives one line per installed item under a source headline", () => {
		const result = renderAddSummary({
			sourceKey: "owner/repo",
			ref: "v1.0.0",
			commit: "abc123",
			outcomes: [skill("skills/react/hooks"), skill("tools/lint")],
		});

		expect(result).toEqual({
			headline: "Installed owner/repo@v1.0.0",
			installed: ["skills/react/hooks", "tools/lint"],
			skipped: [],
			failed: [],
		});
	});

	it("gives a pack's skill count with its agents and hooks counts", () => {
		const result = renderAddSummary({
			sourceKey: "owner/repo",
			ref: "main",
			commit: "abc123",
			outcomes: [
				{
					...item("laravel", "pack"),
					status: "installed",
					assetCounts: { skills: 12, agents: 3, hooks: 1 },
					files: [],
				},
			],
		});

		expect(result.installed).toEqual([
			"laravel (pack · 12 skills, 3 agents, 1 hook)",
		]);
	});

	it("gives a pack's skill count even when it has none", () => {
		const result = renderAddSummary({
			sourceKey: "owner/repo",
			ref: "main",
			commit: "abc123",
			outcomes: [
				{
					...item("repo", "pack"),
					status: "installed",
					assetCounts: { skills: 0, agents: 2 },
					files: [],
				},
			],
		});

		expect(result.installed).toEqual(["repo (pack · 0 skills, 2 agents)"]);
	});

	it("counts a pack's support folders after its skills", () => {
		const result = renderAddSummary({
			sourceKey: "owner/repo",
			ref: "main",
			commit: "abc123",
			outcomes: [
				{
					...item("repo", "pack"),
					status: "installed",
					assetCounts: { skills: 23, folders: 3, agents: 1 },
					files: [],
				},
			],
		});

		expect(result.installed).toEqual([
			"repo (pack · 23 skills, 3 folders, 1 agent)",
		]);
	});

	it("lists skipped and failed items with their reasons", () => {
		const result = renderAddSummary({
			sourceKey: "owner/repo",
			ref: "main",
			commit: "abc123",
			outcomes: [
				skill("a"),
				{ ...item("b"), status: "skipped", reason: "conflict not resolved" },
				{ ...item("c"), status: "failed", reason: "disk full" },
			],
		});

		expect(result.skipped).toEqual(["b: skipped — conflict not resolved"]);
		expect(result.failed).toEqual(["c: failed — disk full"]);
	});

	it("says nothing was installed when no item installed", () => {
		const result = renderAddSummary({
			sourceKey: "owner/repo",
			ref: "main",
			commit: "abc123",
			outcomes: [{ ...item("a"), status: "skipped", reason: "conflict" }],
		});

		expect(result.headline).toBe("Nothing installed from owner/repo");
	});

	it("uses HEAD label when ref is null with commit", () => {
		const result = renderAddSummary({
			sourceKey: "owner/my-skill",
			ref: null,
			commit: "abc123",
			outcomes: [skill("my-skill")],
		});
		expect(result.headline).toBe("Installed owner/my-skill@HEAD");
	});

	it("uses local label when ref and commit are null", () => {
		const result = renderAddSummary({
			sourceKey: "/path/to/skills",
			ref: null,
			commit: null,
			outcomes: [skill("a")],
		});
		expect(result.headline).toBe("Installed /path/to/skills@local");
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
			summaryLabel: "3 install(s)",
			fileCount: 12,
		});
		expect(result).toBe("Removed 3 install(s) — 12 file(s)");
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

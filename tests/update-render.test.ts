import { describe, expect, it } from "vitest";
import {
	buildAbortMessage,
	buildCopySafetyMessage,
} from "../src/clone-reinstall.js";
import type { EntryGroup } from "../src/update-groups.js";
import {
	formatCheckFailedLine,
	formatCloneFailureLine,
	formatConstrainedNoMatchLine,
	formatGroupHeader,
	formatMemberLine,
	formatNewerTagsLine,
	formatUpToDateLine,
	formatVersionMove,
	groupLabel,
} from "../src/update-render.js";
import { makeEntry } from "./helpers/factories.js";

function makeGroup(
	memberKeys: string[],
	versionIntent: string | null,
): EntryGroup {
	return {
		cloneUrl: "https://github.com/owner/repo.git",
		versionIntent,
		constrained:
			typeof versionIntent === "string" && versionIntent.startsWith("^"),
		members: memberKeys.map((key) => ({ key, entry: makeEntry() })),
	};
}

describe("groupLabel", () => {
	it("returns the bare owner/repo label when the repo has a single group", () => {
		const group = makeGroup(["owner/repo"], "^1.2.3");

		expect(groupLabel(group, [group])).toBe("owner/repo");
	});

	it("disambiguates two groups of one repo with @<constraint> and @<tag> intent suffixes", () => {
		const caret = makeGroup(["owner/repo/a"], "^1.2.3");
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [caret, pin];

		expect(groupLabel(caret, groups)).toBe("owner/repo@^1.2.3");
		expect(groupLabel(pin, groups)).toBe("owner/repo@v2.0.0");
	});

	it("uses the @HEAD sentinel for a HEAD-tracked group (versionIntent===null) in a multi-group repo", () => {
		const head = makeGroup(["owner/repo/a"], null);
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [head, pin];

		expect(groupLabel(head, groups)).toBe("owner/repo@HEAD");
	});

	it("renders @main for a branch group and @v2.0.0 for an exact-pin group when the repo is multi-group", () => {
		const branch = makeGroup(["owner/repo/a"], "main");
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [branch, pin];

		expect(groupLabel(branch, groups)).toBe("owner/repo@main");
		expect(groupLabel(pin, groups)).toBe("owner/repo@v2.0.0");
	});

	it("derives the same repo label for a standalone (owner/repo) and a collection member (owner/repo/member)", () => {
		const standalone = makeGroup(["owner/repo"], "^1.2.3");
		const collection = makeGroup(["owner/repo/member"], "^1.2.3");

		expect(groupLabel(standalone, [standalone])).toBe("owner/repo");
		expect(groupLabel(collection, [collection])).toBe("owner/repo");
	});
});

const OLD_A = "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b";
const OLD_B = "bbbbbbb222222233333334444444555555566666";
const NEW = "9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c3b2a1f0e";

describe("formatVersionMove", () => {
	it("renders <oldTag> -> <newTag> when both refs are semver tags and the ref moved", () => {
		expect(
			formatVersionMove({
				oldRef: "v1.2.3",
				newRef: "v1.3.0",
				oldCommit: OLD_A,
				newCommit: NEW,
			}),
		).toBe("v1.2.3 -> v1.3.0");
	});

	it("falls to short hashes for a v4 branch (clean() null)", () => {
		expect(
			formatVersionMove({
				oldRef: "v4",
				newRef: "v4",
				oldCommit: OLD_A,
				newCommit: NEW,
			}),
		).toBe("1a2b3c4 -> 9f8e7d6");
	});

	it("falls to short hashes for a v4.0.0 branch when only the commit moved (oldRef === newRef)", () => {
		expect(
			formatVersionMove({
				oldRef: "v4.0.0",
				newRef: "v4.0.0",
				oldCommit: OLD_A,
				newCommit: NEW,
			}),
		).toBe("1a2b3c4 -> 9f8e7d6");
	});

	it("falls to short hashes for a branch/HEAD move (newRef null or non-tag)", () => {
		expect(
			formatVersionMove({
				oldRef: "main",
				newRef: "main",
				oldCommit: OLD_A,
				newCommit: NEW,
			}),
		).toBe("1a2b3c4 -> 9f8e7d6");
		expect(
			formatVersionMove({
				oldRef: null,
				newRef: null,
				oldCommit: OLD_A,
				newCommit: NEW,
			}),
		).toBe("1a2b3c4 -> 9f8e7d6");
	});

	it("uses unknown for a null old commit on the hash path", () => {
		expect(
			formatVersionMove({
				oldRef: null,
				newRef: null,
				oldCommit: null,
				newCommit: NEW,
			}),
		).toBe("unknown -> 9f8e7d6");
	});
});

describe("formatGroupHeader", () => {
	it("renders a shared-old header with old -> new and the attempted member count", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_A, OLD_A],
			oldRefs: [null, null, null],
			newCommit: NEW,
			newRef: null,
		});

		expect(header).toBe("Updating owner/repo  1a2b3c4 -> 9f8e7d6  (3 members)");
	});

	it("renders a divergent-old header with the resolved target only (no old ref)", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_B],
			oldRefs: [null, null],
			newCommit: NEW,
			newRef: null,
		});

		expect(header).toBe("Updating owner/repo -> 9f8e7d6  (2 members)");
	});

	it("counts only the updating members passed in oldCommits (up-to-date siblings excluded upstream)", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_A, OLD_A, OLD_A, OLD_A, OLD_A, OLD_A],
			oldRefs: [null, null, null, null, null, null, null],
			newCommit: NEW,
			newRef: null,
		});

		expect(header).toBe("Updating owner/repo  1a2b3c4 -> 9f8e7d6  (7 members)");
	});

	it("shared-old group header renders the tag move v1.2.3 -> v1.3.0", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_A],
			oldRefs: ["v1.2.3", "v1.2.3"],
			newCommit: NEW,
			newRef: "v1.3.0",
		});

		expect(header).toBe("Updating owner/repo  v1.2.3 -> v1.3.0  (2 members)");
	});

	it("divergent-old header shows -> <tag> for a tagged target and -> <hash> for a branch target", () => {
		const tagged = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_B],
			oldRefs: ["v1.2.0", "v1.1.0"],
			newCommit: NEW,
			newRef: "v1.3.0",
		});
		expect(tagged).toBe("Updating owner/repo -> v1.3.0  (2 members)");

		const branch = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_B],
			oldRefs: ["main", "main"],
			newCommit: NEW,
			newRef: "main",
		});
		expect(branch).toBe("Updating owner/repo -> 9f8e7d6  (2 members)");
	});
});

describe("formatMemberLine", () => {
	it("success renders <name> → <agents> at success level with no parenthetical when no move or drop", () => {
		expect(
			formatMemberLine({
				kind: "success",
				name: "design",
				agents: ["claude"],
				droppedAgents: [],
			}),
		).toEqual({ level: "success", text: "design → claude" });
	});

	it("divergent-old success carries its own (old -> new) move parenthetical", () => {
		expect(
			formatMemberLine({
				kind: "success",
				name: "macos",
				agents: ["claude"],
				droppedAgents: [],
				move: { oldRef: null, newRef: null, oldCommit: OLD_A, newCommit: NEW },
			}),
		).toEqual({
			level: "success",
			text: "macos → claude  (1a2b3c4 -> 9f8e7d6)",
		});
	});

	it("divergent-old member line renders its own <oldTag> -> <newTag> move in tags", () => {
		expect(
			formatMemberLine({
				kind: "success",
				name: "macos",
				agents: ["claude"],
				droppedAgents: [],
				move: {
					oldRef: "v1.2.0",
					newRef: "v1.3.0",
					oldCommit: OLD_A,
					newCommit: NEW,
				},
			}),
		).toEqual({
			level: "success",
			text: "macos → claude  (v1.2.0 -> v1.3.0)",
		});
	});

	it("success with dropped agents appends the support removed by plugin author notice in the parenthetical", () => {
		expect(
			formatMemberLine({
				kind: "success",
				name: "macos",
				agents: ["claude"],
				droppedAgents: ["codex"],
			}),
		).toEqual({
			level: "success",
			text: "macos → claude  (codex support removed by plugin author)",
		});
	});

	it("success with both a move and a drop shares one parenthetical joined by ;", () => {
		expect(
			formatMemberLine({
				kind: "success",
				name: "macos",
				agents: ["claude"],
				droppedAgents: ["codex"],
				move: { oldRef: null, newRef: null, oldCommit: OLD_A, newCommit: NEW },
			}),
		).toEqual({
			level: "success",
			text: "macos → claude  (1a2b3c4 -> 9f8e7d6; codex support removed by plugin author)",
		});
	});

	it("copy-failed renders at error level with the recovery hint", () => {
		expect(
			formatMemberLine({
				kind: "copy-failed",
				name: "design",
				recoveryHint: "re-run update",
			}),
		).toEqual({
			level: "error",
			text: "design: copy failed — re-run update",
		});
	});

	it("aborted renders at error level carrying the recorded type and the remove+add remedy inline", () => {
		const message = buildAbortMessage(
			"owner/repo/design",
			"skill",
			"SKILL.md missing",
		);

		const line = formatMemberLine({ kind: "aborted", name: "design", message });

		expect(line).toEqual({ level: "error", text: `design: ${message}` });
		expect(line.text).toContain("skill");
		expect(line.text).toContain("npx agntc remove owner/repo/design");
		expect(line.text).toContain("npx agntc add owner/repo/design");
	});

	it("blocked renders at error level with the copy-safety message and no remove+add remedy", () => {
		const message = buildCopySafetyMessage(
			"owner/repo/design",
			"symlink target escapes the clone",
		);

		const line = formatMemberLine({ kind: "blocked", name: "design", message });

		expect(line).toEqual({ level: "error", text: `design: ${message}` });
		expect(line.text).not.toContain("npx agntc remove");
		expect(line.text).not.toContain("npx agntc add");
	});

	it("no-agents renders at warn level as a skip", () => {
		expect(formatMemberLine({ kind: "no-agents", name: "design" })).toEqual({
			level: "warn",
			text: "design: skipped — no longer supports installed agents",
		});
	});
});

describe("formatUpToDateLine", () => {
	it("renders '<label>: <count> up to date' for the collapsed count", () => {
		expect(formatUpToDateLine("owner/repo", 7)).toBe(
			"owner/repo: 7 up to date",
		);
	});

	it("renders a single up-to-date member as '<label>: 1 up to date'", () => {
		expect(formatUpToDateLine("owner/repo", 1)).toBe(
			"owner/repo: 1 up to date",
		);
	});

	it("carries an @intent-disambiguated label verbatim", () => {
		expect(formatUpToDateLine("owner/repo@v2.0.0", 3)).toBe(
			"owner/repo@v2.0.0: 3 up to date",
		);
	});
});

describe("formatNewerTagsLine", () => {
	it("renders the pinned-ref notice plus the repo-level agntc add command", () => {
		expect(
			formatNewerTagsLine("owner/repo", "owner/repo", "v1.0", "v3.0"),
		).toBe(
			"owner/repo: Pinned to v1.0 — newer tags available (latest: v3.0). To upgrade: npx agntc add owner/repo@v3.0",
		);
	});

	it("builds the add command from the bare repo target, not the @intent display label", () => {
		expect(
			formatNewerTagsLine("owner/repo@main", "owner/repo", "v1.0", "v2.0"),
		).toBe(
			"owner/repo@main: Pinned to v1.0 — newer tags available (latest: v2.0). To upgrade: npx agntc add owner/repo@v2.0",
		);
	});
});

describe("formatCheckFailedLine", () => {
	it("renders '<label>: check failed — <reason>' with the shared probe reason", () => {
		expect(
			formatCheckFailedLine("owner/repo", "ls-remote failed: dead remote"),
		).toBe("owner/repo: check failed — ls-remote failed: dead remote");
	});
});

describe("formatConstrainedNoMatchLine", () => {
	it("renders '<label>: no tags satisfy <constraint> — left untouched'", () => {
		expect(formatConstrainedNoMatchLine("owner/repo", "^2.0")).toBe(
			"owner/repo: no tags satisfy ^2.0 — left untouched",
		);
	});
});

describe("formatCloneFailureLine", () => {
	it("enumerates member basenames with the affected count", () => {
		expect(formatCloneFailureLine("owner/repo", ["a", "b", "c"])).toBe(
			"owner/repo: clone failed — affects 3 members: a, b, c",
		);
	});

	it("carries an @intent-disambiguated label verbatim", () => {
		expect(
			formatCloneFailureLine("owner/repo@^1.2.3", ["design", "macos"]),
		).toBe(
			"owner/repo@^1.2.3: clone failed — affects 2 members: design, macos",
		);
	});
});

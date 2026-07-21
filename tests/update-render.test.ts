import { describe, expect, it } from "vitest";
import {
	buildAbortMessage,
	buildCopySafetyMessage,
} from "../src/clone-reinstall.js";
import type { EntryGroup } from "../src/update-groups.js";
import {
	formatGroupHeader,
	formatMemberLine,
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
	it("returns <oldShort> -> <newShort> for reuse on member lines", () => {
		expect(formatVersionMove(OLD_A, NEW)).toBe("1a2b3c4 -> 9f8e7d6");
	});
});

describe("formatGroupHeader", () => {
	it("renders a shared-old header with old -> new and the attempted member count", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_A, OLD_A],
			newCommit: NEW,
		});

		expect(header).toBe("Updating owner/repo  1a2b3c4 -> 9f8e7d6  (3 members)");
	});

	it("renders a divergent-old header with the resolved target only (no old ref)", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_B],
			newCommit: NEW,
		});

		expect(header).toBe("Updating owner/repo -> 9f8e7d6  (2 members)");
	});

	it("counts only the updating members passed in oldCommits (up-to-date siblings excluded upstream)", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_A, OLD_A, OLD_A, OLD_A, OLD_A, OLD_A],
			newCommit: NEW,
		});

		expect(header).toBe("Updating owner/repo  1a2b3c4 -> 9f8e7d6  (7 members)");
	});

	it("renders the version move as short commit hashes, not tags (interim — Phase 3 rewords)", () => {
		const header = formatGroupHeader({
			label: "owner/repo",
			oldCommits: [OLD_A, OLD_A],
			newCommit: NEW,
		});

		expect(header).toContain("1a2b3c4 -> 9f8e7d6");
		expect(header).not.toContain("v1");
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
				move: { oldCommit: OLD_A, newCommit: NEW },
			}),
		).toEqual({
			level: "success",
			text: "macos → claude  (1a2b3c4 -> 9f8e7d6)",
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
				move: { oldCommit: OLD_A, newCommit: NEW },
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

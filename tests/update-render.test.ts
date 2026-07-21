import { describe, expect, it } from "vitest";
import type { EntryGroup } from "../src/update-groups.js";
import {
	formatGroupHeader,
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

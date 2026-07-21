import { describe, expect, it } from "vitest";
import { groupEntriesForUpdate } from "../src/update-groups.js";
import { makeEntry, makeManifest } from "./helpers/factories.js";

const REPO_URL = "https://github.com/owner/repo.git";

function memberKeys(group: { members: Array<{ key: string }> }): string[] {
	return group.members.map((m) => m.key);
}

describe("groupEntriesForUpdate", () => {
	it("groups two members of one repo sharing a constraint into one group, preserving manifest order", () => {
		const manifest = makeManifest({
			"owner/repo/a": makeEntry({ ref: "v1.2.3", constraint: "^1.2.3" }),
			"owner/repo/b": makeEntry({ ref: "v1.2.3", constraint: "^1.2.3" }),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(1);
		expect(groups[0]).toMatchObject({
			cloneUrl: REPO_URL,
			versionIntent: "^1.2.3",
			constrained: true,
		});
		expect(memberKeys(groups[0]!)).toEqual(["owner/repo/a", "owner/repo/b"]);
	});

	it("excludes the mutating ref from a constrained group key so a singly-updated member stays grouped with behind siblings", () => {
		const manifest = makeManifest({
			"owner/repo/a": makeEntry({ ref: "v1.3.0", constraint: "^1.2.3" }),
			"owner/repo/b": makeEntry({ ref: "v1.2.3", constraint: "^1.2.3" }),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(1);
		expect(groups[0]!.versionIntent).toBe("^1.2.3");
		expect(memberKeys(groups[0]!)).toEqual(["owner/repo/a", "owner/repo/b"]);
	});

	it("splits owner/repo/a@^1 and owner/repo/b@^2 into distinct groups", () => {
		const manifest = makeManifest({
			"owner/repo/a": makeEntry({ ref: "v1.5.0", constraint: "^1.0.0" }),
			"owner/repo/b": makeEntry({ ref: "v2.1.0", constraint: "^2.0.0" }),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(2);
		expect(memberKeys(groups[0]!)).toEqual(["owner/repo/a"]);
		expect(groups[0]!.versionIntent).toBe("^1.0.0");
		expect(memberKeys(groups[1]!)).toEqual(["owner/repo/b"]);
		expect(groups[1]!.versionIntent).toBe("^2.0.0");
	});

	it("splits a branch entry and a caret entry of the same repo into distinct groups", () => {
		const manifest = makeManifest({
			"owner/repo/a": makeEntry({ ref: "main" }),
			"owner/repo/b": makeEntry({ ref: "v1.3.0", constraint: "^1.2.3" }),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			versionIntent: "main",
			constrained: false,
		});
		expect(groups[1]).toMatchObject({
			versionIntent: "^1.2.3",
			constrained: true,
		});
	});

	it("splits an exact-pin ref from a same-repo caret (keyed pre-resolution, not on resolved commit)", () => {
		const sharedCommit = "c".repeat(40);
		const manifest = makeManifest({
			"owner/repo/a": makeEntry({ ref: "v1.3.0", commit: sharedCommit }),
			"owner/repo/b": makeEntry({
				ref: "v1.3.0",
				constraint: "^1.2.3",
				commit: sharedCommit,
			}),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(2);
		expect(groups[0]).toMatchObject({
			versionIntent: "v1.3.0",
			constrained: false,
		});
		expect(groups[1]).toMatchObject({
			versionIntent: "^1.2.3",
			constrained: true,
		});
	});

	it("collapses a legacy null-cloneUrl entry with an explicit-URL entry for the same repo via deriveCloneUrlFromKey", () => {
		const manifest = makeManifest({
			"owner/repo/a": makeEntry({ constraint: "^1.2.3", cloneUrl: null }),
			"owner/repo/b": makeEntry({
				constraint: "^1.2.3",
				cloneUrl: REPO_URL,
			}),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(1);
		expect(groups[0]!.cloneUrl).toBe(REPO_URL);
		expect(memberKeys(groups[0]!)).toEqual(["owner/repo/a", "owner/repo/b"]);
	});

	it("keys a HEAD-tracked entry (ref===null) under the HEAD sentinel, distinct from tag/branch groups", () => {
		const manifest = makeManifest({
			"owner/repo/head": makeEntry({ ref: null }),
			"owner/repo/tag": makeEntry({ ref: "v1.0.0" }),
			"owner/repo/branch": makeEntry({ ref: "main" }),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(3);
		const headGroup = groups.find((g) => g.versionIntent === null);
		expect(headGroup).toBeDefined();
		expect(headGroup!.constrained).toBe(false);
		expect(memberKeys(headGroup!)).toEqual(["owner/repo/head"]);
	});

	it("excludes local entries (commit===null) from grouping entirely", () => {
		const manifest = makeManifest({
			"owner/repo/local": makeEntry({ commit: null }),
			"owner/repo/remote": makeEntry({ ref: "v1.0.0" }),
		});

		const groups = groupEntriesForUpdate(manifest);

		expect(groups).toHaveLength(1);
		expect(memberKeys(groups[0]!)).toEqual(["owner/repo/remote"]);
		const allKeys = groups.flatMap((g) => memberKeys(g));
		expect(allKeys).not.toContain("owner/repo/local");
	});
});

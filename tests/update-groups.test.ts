import { beforeEach, describe, expect, it, vi } from "vitest";
import { execGit, fetchRemoteTagRefs } from "../src/git-utils.js";
import type { ManifestEntry } from "../src/manifest.js";
import { categorizeMember, resolveGroupTarget } from "../src/update-check.js";
import {
	type EntryGroup,
	groupEntriesForUpdate,
} from "../src/update-groups.js";
import { makeEntry, makeManifest } from "./helpers/factories.js";

vi.mock("../src/git-utils.js");

const REPO_URL = "https://github.com/owner/repo.git";

const SHA_CUR = "a".repeat(40);
const SHA_TGT = "b".repeat(40);
const SHA_OTHER = "c".repeat(40);
const SHA_RESOLVED = "d".repeat(40);

function firstGroup(entries: Record<string, ManifestEntry>): EntryGroup {
	return groupEntriesForUpdate(makeManifest(entries))[0]!;
}

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

describe("resolveGroupTarget / categorizeMember", () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it("resolves a constrained group target tag and commit with a single fetchRemoteTagRefs call", async () => {
		vi.mocked(fetchRemoteTagRefs).mockResolvedValue([
			{ tag: "v1.2.3", sha: SHA_CUR },
			{ tag: "v1.3.0", sha: SHA_TGT },
		]);
		const group = firstGroup({
			"owner/repo/a": makeEntry({
				ref: "v1.2.3",
				commit: SHA_CUR,
				constraint: "^1.2.3",
			}),
			"owner/repo/b": makeEntry({
				ref: "v1.2.3",
				commit: SHA_CUR,
				constraint: "^1.2.3",
			}),
		});

		const target = await resolveGroupTarget(group);

		expect(target).toEqual({
			kind: "constrained",
			tag: "v1.3.0",
			commit: SHA_TGT,
			latestOverall: null,
		});
		expect(fetchRemoteTagRefs).toHaveBeenCalledTimes(1);
		expect(execGit).not.toHaveBeenCalled();
	});

	it("categorizes a member at the target tag as up-to-date while a behind sibling is constrained-update-available (one shared target)", async () => {
		vi.mocked(fetchRemoteTagRefs).mockResolvedValue([
			{ tag: "v1.2.3", sha: SHA_CUR },
			{ tag: "v1.3.0", sha: SHA_TGT },
		]);
		const atTarget = makeEntry({
			ref: "v1.3.0",
			commit: SHA_TGT,
			constraint: "^1.2.3",
		});
		const behind = makeEntry({
			ref: "v1.2.3",
			commit: SHA_CUR,
			constraint: "^1.2.3",
		});
		const group = firstGroup({
			"owner/repo/a": atTarget,
			"owner/repo/b": behind,
		});

		const target = await resolveGroupTarget(group);

		expect(target.kind).toBe("constrained");
		expect(categorizeMember(atTarget, target)).toEqual({
			status: "constrained-up-to-date",
			latestOverall: null,
		});
		expect(categorizeMember(behind, target)).toEqual({
			status: "constrained-update-available",
			tag: "v1.3.0",
			commit: SHA_TGT,
			latestOverall: null,
		});
		expect(fetchRemoteTagRefs).toHaveBeenCalledTimes(1);
	});

	it("branch members at divergent installed commits all advance to one resolved HEAD sha", async () => {
		vi.mocked(execGit).mockResolvedValue({
			stdout: `${SHA_RESOLVED}\trefs/heads/main\n`,
			stderr: "",
		});
		const behindA = makeEntry({ ref: "main", commit: SHA_CUR });
		const behindB = makeEntry({ ref: "main", commit: SHA_OTHER });
		const atHead = makeEntry({ ref: "main", commit: SHA_RESOLVED });
		const group = firstGroup({
			"owner/repo/a": behindA,
			"owner/repo/b": behindB,
			"owner/repo/c": atHead,
		});

		const target = await resolveGroupTarget(group);

		expect(target).toEqual({ kind: "branch", resolvedSha: SHA_RESOLVED });
		expect(categorizeMember(behindA, target)).toEqual({
			status: "update-available",
			remoteCommit: SHA_RESOLVED,
		});
		expect(categorizeMember(behindB, target)).toEqual({
			status: "update-available",
			remoteCommit: SHA_RESOLVED,
		});
		expect(categorizeMember(atHead, target)).toEqual({ status: "up-to-date" });
		expect(execGit).toHaveBeenCalledTimes(1);
	});

	it("exact-pin group resolves the newer-tags list once; category is not keyed on a resolved commit", async () => {
		vi.mocked(execGit).mockResolvedValue({
			stdout: `${SHA_TGT}\trefs/tags/v1.3.0\n`,
			stderr: "",
		});
		vi.mocked(fetchRemoteTagRefs).mockResolvedValue([
			{ tag: "v1.3.0", sha: SHA_TGT },
			{ tag: "v1.4.0", sha: SHA_OTHER },
		]);
		const memberA = makeEntry({ ref: "v1.3.0", commit: SHA_TGT });
		const memberB = makeEntry({ ref: "v1.3.0", commit: SHA_TGT });
		const group = firstGroup({
			"owner/repo/a": memberA,
			"owner/repo/b": memberB,
		});

		const target = await resolveGroupTarget(group);

		expect(target).toEqual({
			kind: "tag",
			tag: "v1.3.0",
			newerTags: ["v1.4.0"],
		});
		expect(fetchRemoteTagRefs).toHaveBeenCalledTimes(1);
		// Category derives from the shared newer-tags list, never a resolved commit,
		// so it stays independent of any caret group resolving to the same commit.
		expect(categorizeMember(memberA, target)).toEqual({
			status: "newer-tags",
			tags: ["v1.4.0"],
		});
		expect(categorizeMember(memberB, target)).toEqual({
			status: "newer-tags",
			tags: ["v1.4.0"],
		});
	});

	it("a probe error yields check-failed for the group and every member", async () => {
		vi.mocked(fetchRemoteTagRefs).mockRejectedValue(new Error("network down"));
		const memberA = makeEntry({
			ref: "v1.2.3",
			commit: SHA_CUR,
			constraint: "^1.2.3",
		});
		const memberB = makeEntry({
			ref: "v1.2.3",
			commit: SHA_CUR,
			constraint: "^1.2.3",
		});
		const group = firstGroup({
			"owner/repo/a": memberA,
			"owner/repo/b": memberB,
		});

		const target = await resolveGroupTarget(group);

		expect(target).toEqual({ kind: "check-failed", reason: "network down" });
		expect(categorizeMember(memberA, target)).toEqual({
			status: "check-failed",
			reason: "network down",
		});
		expect(categorizeMember(memberB, target)).toEqual({
			status: "check-failed",
			reason: "network down",
		});
	});
});

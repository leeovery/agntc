import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/git-utils.js");

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("./helpers/clack-mock.js");
	return mockClack();
});

vi.mock("../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/git-clone.js")>()),
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../src/config.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/config.js")>()),
	readConfig: vi.fn(),
}));

vi.mock("../src/nuke-files.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/nuke-files.js")>()),
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/fs-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/fs-utils.js")>()),
	pathExists: vi.fn(),
}));

vi.mock("../src/copy-bare-skill.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/copy-bare-skill.js")>()),
	copyBareSkill: vi.fn(),
}));

vi.mock("../src/drivers/registry.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/drivers/registry.js")>()),
	getDriver: vi.fn(),
}));

vi.mock("../src/copy-safety.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/copy-safety.js")>();
	const { mockCopySafety } = await import("./helpers/copy-safety-mock.js");
	return {
		...actual,
		assertSubpathWithinClone: vi.fn(),
		...mockCopySafety(actual.SymlinkEscapeError),
	};
});

import { readConfig } from "../src/config.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import {
	assertSubpathWithinClone,
	PathTraversalError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import { getDriver } from "../src/drivers/registry.js";
import { pathExists } from "../src/fs-utils.js";
import { cleanupTempDir, cloneSource } from "../src/git-clone.js";
import { execGit, fetchRemoteTagRefs } from "../src/git-utils.js";
import type { ManifestEntry } from "../src/manifest.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import {
	categorizeMember,
	type GroupTarget,
	resolveGroupTarget,
} from "../src/update-check.js";
import {
	type EntryGroup,
	groupEntriesForUpdate,
	groupTargetFacets,
	processGroupUpdate,
} from "../src/update-groups.js";
import {
	makeEntry,
	makeFakeDriver,
	makeManifest,
} from "./helpers/factories.js";

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockPathExists = vi.mocked(pathExists);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);
const mockAssertSubpathWithinClone = vi.mocked(assertSubpathWithinClone);

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

describe("groupTargetFacets", () => {
	it("projects a constrained target: tag is the clone ref AND display ref, commit is the resolved sha", () => {
		const group: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: "^1.2.3",
			constrained: true,
			members: [
				{
					key: "owner/repo/a",
					entry: makeEntry({ ref: "v1.2.3", constraint: "^1.2.3" }),
				},
			],
		};
		const target: GroupTarget = {
			kind: "constrained",
			tag: "v1.3.0",
			commit: SHA_TGT,
			latestOverall: null,
		};

		expect(groupTargetFacets(target, group)).toStrictEqual({
			commit: SHA_TGT,
			cloneRef: "v1.3.0",
			displayRef: "v1.3.0",
		});
	});

	it("projects a branch target: clone ref undefined (stored-branch clone) but display ref is the branch intent, commit is the resolved sha", () => {
		const group: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: "main",
			constrained: false,
			members: [{ key: "owner/repo/a", entry: makeEntry({ ref: "main" }) }],
		};
		const target: GroupTarget = { kind: "branch", resolvedSha: SHA_RESOLVED };

		expect(groupTargetFacets(target, group)).toStrictEqual({
			commit: SHA_RESOLVED,
			cloneRef: undefined,
			displayRef: "main",
		});
	});

	it("projects a head target: clone ref undefined, display ref null (HEAD-tracked), commit is the resolved sha", () => {
		const group: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: null,
			constrained: false,
			members: [{ key: "owner/repo/a", entry: makeEntry({ ref: null }) }],
		};
		const target: GroupTarget = { kind: "head", resolvedSha: SHA_RESOLVED };

		expect(groupTargetFacets(target, group)).toStrictEqual({
			commit: SHA_RESOLVED,
			cloneRef: undefined,
			displayRef: null,
		});
	});

	it("keeps the branch clone ref (undefined) distinct from the display ref (version intent)", () => {
		const group: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: "main",
			constrained: false,
			members: [{ key: "owner/repo/a", entry: makeEntry({ ref: "main" }) }],
		};
		const target: GroupTarget = { kind: "branch", resolvedSha: SHA_RESOLVED };

		const facets = groupTargetFacets(target, group);

		expect(facets.cloneRef).toBeUndefined();
		expect(facets.displayRef).toBe("main");
	});

	it("agrees with the member move: displayRef equals effectiveRef ?? member.ref for every reachable arm (grouping invariant)", () => {
		const constrainedGroup: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: "^1.2.3",
			constrained: true,
			members: [
				{
					key: "owner/repo/a",
					entry: makeEntry({ ref: "v1.2.0", constraint: "^1.2.3" }),
				},
			],
		};
		const constrained: GroupTarget = {
			kind: "constrained",
			tag: "v1.3.0",
			commit: SHA_TGT,
			latestOverall: null,
		};
		const branchGrp: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: "main",
			constrained: false,
			members: [{ key: "owner/repo/a", entry: makeEntry({ ref: "main" }) }],
		};
		const headGrp: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: null,
			constrained: false,
			members: [{ key: "owner/repo/a", entry: makeEntry({ ref: null }) }],
		};

		for (const [target, group] of [
			[constrained, constrainedGroup],
			[BRANCH_TARGET_FACET, branchGrp],
			[HEAD_TARGET_FACET, headGrp],
		] as const) {
			const { cloneRef, displayRef } = groupTargetFacets(target, group);
			const memberMoveRef = cloneRef ?? group.members[0]!.entry.ref;
			expect(displayRef).toBe(memberMoveRef);
		}
	});
});

const BRANCH_TARGET_FACET: GroupTarget = {
	kind: "branch",
	resolvedSha: SHA_RESOLVED,
};
const HEAD_TARGET_FACET: GroupTarget = {
	kind: "head",
	resolvedSha: SHA_RESOLVED,
};

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

describe("processGroupUpdate", () => {
	const CLONE_DIR = "/tmp/agntc-clone";
	// Deliberately distinct from SHA_RESOLVED so a branch group's recorded commit
	// can be asserted to come from the resolved target, NOT the clone's own HEAD.
	const CLONE_COMMIT = "e".repeat(40);
	const fakeDriver = makeFakeDriver();

	const BRANCH_TARGET: GroupTarget = {
		kind: "branch",
		resolvedSha: SHA_RESOLVED,
	};

	function branchMember(
		key: string,
		overrides: Partial<ManifestEntry> = {},
	): { key: string; entry: ManifestEntry } {
		return {
			key,
			entry: makeEntry({
				type: "skill",
				ref: "main",
				commit: SHA_CUR,
				agents: ["claude"],
				files: [`.claude/skills/${key.split("/").pop()}/`],
				...overrides,
			}),
		};
	}

	function branchGroup(
		members: Array<{ key: string; entry: ManifestEntry }>,
	): EntryGroup {
		return {
			cloneUrl: REPO_URL,
			versionIntent: "main",
			constrained: false,
			members,
		};
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockCloneSource.mockResolvedValue({
			tempDir: CLONE_DIR,
			commit: CLONE_COMMIT,
		});
		mockCleanupTempDir.mockResolvedValue(undefined);
		mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
		mockGetDriver.mockReturnValue(fakeDriver);
		mockPathExists.mockResolvedValue(true);
		mockReadConfig.mockResolvedValue({ agents: ["claude"] });
		mockScanForEscapingSymlinks.mockResolvedValue(undefined);
		mockAssertSubpathWithinClone.mockImplementation(() => {});
		mockCopyBareSkill.mockResolvedValue({ copiedFiles: [".claude/skills/x/"] });
	});

	it("clones once for a 3-member group and reinstalls each member from the shared clone", async () => {
		const members = [
			branchMember("owner/repo/a"),
			branchMember("owner/repo/b"),
			branchMember("owner/repo/c"),
		];

		const result = await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			"/fake/project",
		);
		const { outcomes } = result;

		expect(result.cloneFailed).toBe(false);
		expect(mockCloneSource).toHaveBeenCalledTimes(1);
		expect(outcomes).toHaveLength(3);
		expect(outcomes.map((o) => o.key)).toEqual([
			"owner/repo/a",
			"owner/repo/b",
			"owner/repo/c",
		]);
		expect(outcomes.every((o) => o.status === "updated")).toBe(true);
		// Each member reinstalled from its own subdir of the single shared clone.
		for (const name of ["a", "b", "c"]) {
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: `${CLONE_DIR}/${name}` }),
			);
		}
		// No member carries a sourceSubpath here, so the traversal guard never runs.
		expect(mockAssertSubpathWithinClone).not.toHaveBeenCalled();
		// Branch effectiveCommit is the group's resolved sha, not the clone's HEAD.
		const first = outcomes[0]!;
		if (first.status === "updated") {
			expect(first.newEntry.commit).toBe(SHA_RESOLVED);
		}
	});

	it("clones a constrained group once at the resolved target tag and records target.commit per member", async () => {
		const members = [
			{
				key: "owner/repo/a",
				entry: makeEntry({
					type: "skill",
					ref: "v1.2.3",
					commit: SHA_CUR,
					constraint: "^1.2.3",
					agents: ["claude"],
					files: [".claude/skills/a/"],
				}),
			},
			{
				key: "owner/repo/b",
				entry: makeEntry({
					type: "skill",
					ref: "v1.2.3",
					commit: SHA_CUR,
					constraint: "^1.2.3",
					agents: ["claude"],
					files: [".claude/skills/b/"],
				}),
			},
		];
		const group: EntryGroup = {
			cloneUrl: REPO_URL,
			versionIntent: "^1.2.3",
			constrained: true,
			members,
		};
		const target: GroupTarget = {
			kind: "constrained",
			tag: "v1.3.0",
			commit: SHA_TGT,
			latestOverall: null,
		};

		const result = await processGroupUpdate(
			group,
			members,
			target,
			"/fake/project",
		);
		const { outcomes } = result;

		expect(result.cloneFailed).toBe(false);
		expect(mockCloneSource).toHaveBeenCalledTimes(1);
		// The resolved target tag reaches the clone as the --branch override.
		expect(mockCloneSource).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "v1.3.0" }),
		);
		expect(outcomes).toHaveLength(2);
		for (const o of outcomes) {
			expect(o.status).toBe("updated");
			if (o.status === "updated") {
				expect(o.newEntry.ref).toBe("v1.3.0");
				expect(o.newEntry.commit).toBe(SHA_TGT);
			}
		}
	});

	it("runs assertSubpathWithinClone per member and isolates a traversal-escaping subpath", async () => {
		const members = [
			branchMember("owner/repo/a", {
				sourceSubpath: "skills/a",
				files: [".claude/skills/a/"],
			}),
			branchMember("owner/repo/evil", {
				sourceSubpath: "../evil",
				files: [".claude/skills/evil/"],
			}),
			branchMember("owner/repo/c", {
				sourceSubpath: "skills/c",
				files: [".claude/skills/c/"],
			}),
		];
		mockAssertSubpathWithinClone.mockImplementation((_root, subpath) => {
			if (subpath === "../evil") {
				throw new PathTraversalError("../evil");
			}
		});

		const { outcomes } = await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			"/fake/project",
		);

		// The guard runs once per member (each carries its own sourceSubpath),
		// scanned against the whole clone root.
		expect(mockAssertSubpathWithinClone).toHaveBeenCalledTimes(3);
		expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
			CLONE_DIR,
			"skills/a",
		);
		expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
			CLONE_DIR,
			"../evil",
		);
		expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
			CLONE_DIR,
			"skills/c",
		);

		const byKey = new Map(outcomes.map((o) => [o.key, o]));
		expect(byKey.get("owner/repo/evil")!.status).toBe("failed");
		expect(byKey.get("owner/repo/a")!.status).toBe("updated");
		expect(byKey.get("owner/repo/c")!.status).toBe("updated");

		// The escaping member never nuked or copied; its two siblings did.
		expect(mockNukeManifestFiles).not.toHaveBeenCalledWith("/fake/project", [
			".claude/skills/evil/",
		]);
		expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
	});

	it("contains one member reinstall throw so later siblings still reinstall", async () => {
		const members = [
			branchMember("owner/repo/a"),
			branchMember("owner/repo/b"),
			branchMember("owner/repo/c"),
		];
		mockReadConfig.mockImplementation(async (dir: string) => {
			if (dir === `${CLONE_DIR}/b`) {
				throw new Error("kaboom");
			}
			return { agents: ["claude"] };
		});

		const { outcomes } = await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			"/fake/project",
		);

		const byKey = new Map(outcomes.map((o) => [o.key, o]));
		expect(byKey.get("owner/repo/b")!.status).toBe("failed");
		expect(byKey.get("owner/repo/a")!.status).toBe("updated");
		// The sibling AFTER the throwing member still reinstalled.
		expect(byKey.get("owner/repo/c")!.status).toBe("updated");
		expect(mockCopyBareSkill).toHaveBeenCalledWith(
			expect.objectContaining({ sourceDir: `${CLONE_DIR}/c` }),
		);
	});

	it("calls cleanupTempDir exactly once after the whole member loop, even when a member throws", async () => {
		const members = [
			branchMember("owner/repo/a"),
			branchMember("owner/repo/b"),
			branchMember("owner/repo/c"),
		];
		mockReadConfig.mockImplementation(async (dir: string) => {
			if (dir === `${CLONE_DIR}/b`) {
				throw new Error("kaboom");
			}
			return { agents: ["claude"] };
		});

		await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			"/fake/project",
		);

		expect(mockCleanupTempDir).toHaveBeenCalledTimes(1);
		expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_DIR);
	});

	it("scans each member subdir against the clone root (cloneRoot = whole clone), not the subdir", async () => {
		const members = [
			branchMember("owner/repo/a"),
			branchMember("owner/repo/b"),
		];

		await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			"/fake/project",
		);

		expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
			`${CLONE_DIR}/a`,
			CLONE_DIR,
		);
		expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
			`${CLONE_DIR}/b`,
			CLONE_DIR,
		);
	});

	it("fans a clone-fatal rejection out to one failed outcome per member and skips cleanupTempDir", async () => {
		const members = [
			branchMember("owner/repo/a"),
			branchMember("owner/repo/b"),
			branchMember("owner/repo/c"),
		];
		mockCloneSource.mockRejectedValue(
			new Error("git clone failed after 3 attempts: network error"),
		);

		const result = await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			"/fake/project",
		);
		const { outcomes } = result;

		// The clone-fatal discriminator is surfaced additively for the render layer,
		// carrying the shared clone-failure reason; the MODEL stays N failed outcomes.
		expect(result.cloneFailed).toBe(true);
		if (result.cloneFailed) {
			expect(result.reason).toBe(
				"git clone failed after 3 attempts: network error",
			);
		}
		// N failed outcomes, one per updating member, keyed to its own key.
		expect(outcomes).toHaveLength(3);
		expect(outcomes.map((o) => o.key)).toEqual([
			"owner/repo/a",
			"owner/repo/b",
			"owner/repo/c",
		]);
		expect(outcomes.every((o) => o.status === "failed")).toBe(true);
		for (const o of outcomes) {
			expect(o.summary).toBe(
				`${o.key}: Failed — git clone failed after 3 attempts: network error`,
			);
		}
		// The clone never produced a tempDir, so there is nothing to clean up, and no
		// member reinstall was attempted.
		expect(mockCleanupTempDir).not.toHaveBeenCalled();
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
	});

	it("fans a clone-fatal rejection over the updating subset, not group.members (up-to-date siblings excluded)", async () => {
		const updatingA = branchMember("owner/repo/a");
		const updatingB = branchMember("owner/repo/b");
		// An up-to-date sibling that belongs to the group but is NOT in the updating
		// subset passed to processGroupUpdate.
		const upToDate = branchMember("owner/repo/current");
		mockCloneSource.mockRejectedValue(new Error("boom"));

		const result = await processGroupUpdate(
			branchGroup([updatingA, updatingB, upToDate]),
			[updatingA, updatingB],
			BRANCH_TARGET,
			"/fake/project",
		);
		const { outcomes } = result;

		expect(result.cloneFailed).toBe(true);
		// Only the two updating members fail; the up-to-date sibling is untouched.
		expect(outcomes).toHaveLength(2);
		expect(outcomes.map((o) => o.key)).toEqual([
			"owner/repo/a",
			"owner/repo/b",
		]);
		expect(outcomes.some((o) => o.key === "owner/repo/current")).toBe(false);
	});
});

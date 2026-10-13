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

vi.mock("../src/copy-safety.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/copy-safety.js")>();
	const { mockCopySafety } = await import("./helpers/copy-safety-mock.js");
	return {
		...actual,
		assertSubpathWithinClone: vi.fn(),
		...mockCopySafety(actual.SymlinkEscapeError),
	};
});

import type { CloneReinstallResult } from "../src/clone-reinstall.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import {
	assertSubpathWithinClone,
	PathTraversalError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import { pathExists } from "../src/fs-utils.js";
import { cleanupTempDir, cloneSource } from "../src/git-clone.js";
import { execGit, fetchRemoteTagRefs } from "../src/git-utils.js";
import type { Manifest, ManifestEntry } from "../src/manifest.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { projectScope } from "../src/scope.js";
import {
	categorizeMember,
	type GroupTarget,
	resolveGroupTarget,
} from "../src/update-check.js";
import {
	applyOutcome,
	type EntryGroup,
	failedOutcome,
	groupEntriesForUpdate,
	groupTargetFacets,
	isSuccessOutcome,
	keyBefore,
	mapReinstallResultToOutcome,
	type PluginOutcome,
	packsFirst,
	processGroupUpdate,
	reinstallInTurn,
	withAbsorptions,
} from "../src/update-groups.js";
import { makeEntry, makeManifest } from "./helpers/factories.js";

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockPathExists = vi.mocked(pathExists);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
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

describe("failedOutcome", () => {
	it("builds the failed literal with the exact `<key>: Failed — <message>` summary", () => {
		expect(failedOutcome("owner/repo/a", "boom")).toEqual({
			status: "failed",
			key: "owner/repo/a",
			summary: "owner/repo/a: Failed — boom",
		});
	});
});

describe("isSuccessOutcome", () => {
	const newEntry = makeEntry({ ref: "v1.0.0" });

	it("is true for updated and refreshed, narrowing to the newEntry-carrying variants", () => {
		const updated: PluginOutcome = {
			status: "updated",
			key: "owner/repo/a",
			summary: "s",
			newEntry,
			notes: [],
			absorbed: [],
		};
		const refreshed: PluginOutcome = {
			status: "refreshed",
			key: "local",
			summary: "s",
			newEntry,
			notes: [],
			absorbed: [],
		};

		expect(isSuccessOutcome(updated)).toBe(true);
		expect(isSuccessOutcome(refreshed)).toBe(true);
		if (isSuccessOutcome(updated)) {
			expect(updated.newEntry).toBe(newEntry);
		}
	});

	it("is false for every non-success status", () => {
		for (const status of [
			"up-to-date",
			"newer-tags",
			"check-failed",
			"failed",
			"copy-failed",
			"aborted",
			"blocked",
			"constrained-no-match",
			"gone-kept",
			"gone-removed",
		] as const) {
			expect(
				isSuccessOutcome({ status, key: "k", summary: "s", absorbed: [] }),
			).toBe(false);
		}
	});
});

describe("mapReinstallResultToOutcome success", () => {
	function successResult(
		manifestEntry: ManifestEntry,
		key: string,
	): CloneReinstallResult {
		return {
			status: "success",
			key,
			manifestEntry,
			copiedFiles: manifestEntry.files,
			notes: [],
			absorbed: [],
		};
	}

	it("maps a git reinstall to updated, carrying the new entry and the version move", () => {
		const entry = makeEntry({ ref: "v1.0.0", commit: SHA_CUR });
		const newEntry = makeEntry({ ref: "v1.1.0", commit: SHA_TGT });

		const outcome = mapReinstallResultToOutcome(
			"owner/repo/a",
			entry,
			successResult(newEntry, "owner/repo/a"),
			"v1.1.0",
			"project",
		);

		expect(outcome).toEqual({
			status: "updated",
			key: "owner/repo/a",
			summary: "owner/repo/a: Updated v1.0.0 -> v1.1.0",
			newEntry,
			notes: [],
			absorbed: [],
		});
	});

	it("maps a local reinstall to refreshed, carrying the new entry", () => {
		const entry = makeEntry({ ref: null, commit: null });
		const newEntry = makeEntry({ ref: null, commit: null });

		const outcome = mapReinstallResultToOutcome(
			"/local/path",
			entry,
			successResult(newEntry, "/local/path"),
			null,
			"project",
		);

		expect(outcome).toEqual({
			status: "refreshed",
			key: "/local/path",
			summary: "/local/path: Refreshed from local path",
			newEntry,
			notes: [],
			absorbed: [],
		});
	});

	it("carries the reinstall's notes and absorbed keys on a git or a local outcome", () => {
		const notes = ["owner/repo/a now includes b, installed on its own before"];
		const newEntry = makeEntry({ commit: SHA_TGT });
		const result = {
			...successResult(newEntry, "owner/repo/a"),
			notes,
			absorbed: ["owner/repo/b"],
		};

		expect(
			mapReinstallResultToOutcome(
				"owner/repo/a",
				makeEntry({ commit: SHA_CUR }),
				result,
				null,
				"project",
			),
		).toMatchObject({ status: "updated", notes, absorbed: ["owner/repo/b"] });
		expect(
			mapReinstallResultToOutcome(
				"/local/a",
				makeEntry({ commit: null }),
				result,
				null,
				"project",
			),
		).toMatchObject({ status: "refreshed", notes, absorbed: ["owner/repo/b"] });
	});

	it("keys a reinstall that moved where it went, naming the key it had", () => {
		const entry = makeEntry({ ref: "v1.0.0", commit: SHA_CUR });
		const newEntry = makeEntry({ ref: "v1.1.0", commit: SHA_TGT });

		const outcome = mapReinstallResultToOutcome(
			"owner/repo/packs/foo",
			entry,
			successResult(newEntry, "owner/repo/foo"),
			"v1.1.0",
			"project",
		);

		expect(outcome).toEqual({
			status: "updated",
			key: "owner/repo/foo",
			previousKey: "owner/repo/packs/foo",
			summary: "owner/repo/foo: Updated v1.0.0 -> v1.1.0",
			newEntry,
			notes: [],
			absorbed: [],
		});
		expect(keyBefore(outcome)).toBe("owner/repo/packs/foo");
	});

	it("keys a local reinstall that moved where it went, naming the key it had", () => {
		const outcome = mapReinstallResultToOutcome(
			"/src/kit/packs/foo",
			makeEntry({ commit: null }),
			successResult(makeEntry({ commit: null }), "/src/kit/foo"),
			null,
			"project",
		);

		expect(outcome).toMatchObject({
			status: "refreshed",
			key: "/src/kit/foo",
			previousKey: "/src/kit/packs/foo",
			summary: "/src/kit/foo: Refreshed from local path",
		});
	});

	it("maps gone to a gone-kept outcome, since nothing was touched yet", () => {
		expect(
			mapReinstallResultToOutcome(
				"owner/repo/a",
				makeEntry(),
				{ status: "gone" },
				null,
				"project",
			),
		).toEqual({
			status: "gone-kept",
			key: "owner/repo/a",
			summary: "Kept owner/repo/a — it's gone upstream",
		});
	});

	it("maps a copy failure to copy-failed, carrying what the pack took over", () => {
		expect(
			mapReinstallResultToOutcome(
				"owner/repo/laravel",
				makeEntry({ type: "pack" }),
				{
					status: "failed",
					failureReason: "copy-failed",
					message: "hint",
					absorbed: ["owner/repo/queues"],
				},
				null,
				"project",
			),
		).toEqual({
			status: "copy-failed",
			key: "owner/repo/laravel",
			summary: "hint",
			absorbed: ["owner/repo/queues"],
		});
	});

	it("maps a removal failure to failed, so the entry and what it would take over stay recorded", () => {
		const outcome = mapReinstallResultToOutcome(
			"owner/repo/laravel",
			makeEntry({ type: "pack" }),
			{
				status: "failed",
				failureReason: "remove-failed",
				message: "couldn't remove its old files: EACCES",
			},
			null,
			"project",
		);

		expect(outcome).toEqual({
			status: "failed",
			key: "owner/repo/laravel",
			summary:
				"owner/repo/laravel: Failed — couldn't remove its old files: EACCES",
		});
		const manifest = makeManifest(["owner/repo/laravel", "owner/repo/queues"]);
		expect(applyOutcome(manifest, outcome)).toBe(manifest);
	});

	it("builds an abort's summary from the entry, re-add command included", () => {
		const entry = makeEntry({ type: "pack" });

		const outcome = mapReinstallResultToOutcome(
			"owner/repo/laravel",
			entry,
			{ status: "aborted", reason: "its folder now contains packs" },
			null,
			"project",
		);

		expect(outcome).toMatchObject({ status: "aborted" });
		if (outcome.status !== "aborted") return;
		expect(outcome.summary).toContain(
			"npx agntc add owner/repo/laravel --pack",
		);
	});
});

describe("applyOutcome", () => {
	const manifest = makeManifest({
		"owner/repo/pack": makeEntry({ type: "pack" }),
		"owner/repo/loose": makeEntry(),
		"owner/repo/other": makeEntry(),
	});

	it("records a reinstall's new entry and drops the loose skills it absorbed", () => {
		const newEntry = makeEntry({ type: "pack", commit: SHA_TGT });

		const next = applyOutcome(manifest, {
			status: "updated",
			key: "owner/repo/pack",
			summary: "s",
			newEntry,
			notes: [],
			absorbed: ["owner/repo/loose"],
		});

		expect(Object.keys(next)).toEqual(["owner/repo/pack", "owner/repo/other"]);
		expect(next["owner/repo/pack"]).toBe(newEntry);
	});

	it("moves a reinstall that went to a new key there, the old key gone in the same manifest", () => {
		const newEntry = makeEntry({ commit: SHA_TGT });

		const next = applyOutcome(manifest, {
			status: "updated",
			key: "owner/repo/moved",
			previousKey: "owner/repo/loose",
			summary: "s",
			newEntry,
			notes: [],
			absorbed: [],
		});

		expect(Object.keys(next)).toEqual([
			"owner/repo/pack",
			"owner/repo/other",
			"owner/repo/moved",
		]);
		expect(next["owner/repo/moved"]).toBe(newEntry);
	});

	it("drops an entry removed as gone upstream", () => {
		const next = applyOutcome(manifest, {
			status: "gone-removed",
			key: "owner/repo/loose",
			summary: "s",
		});

		expect(Object.keys(next)).toEqual(["owner/repo/pack", "owner/repo/other"]);
	});

	it("drops an entry whose copy failed, and the loose skills it took over before the copy", () => {
		const next = applyOutcome(manifest, {
			status: "copy-failed",
			key: "owner/repo/pack",
			summary: "s",
			absorbed: ["owner/repo/loose"],
		});

		expect(Object.keys(next)).toEqual(["owner/repo/other"]);
	});

	it("leaves the manifest itself in place for everything else", () => {
		for (const outcome of [
			{ status: "gone-kept", key: "owner/repo/loose", summary: "s" },
			{ status: "aborted", key: "owner/repo/loose", summary: "s" },
			{ status: "up-to-date", key: "owner/repo/loose" },
		] as const) {
			expect(applyOutcome(manifest, outcome)).toBe(manifest);
		}
	});
});

describe("withAbsorptions", () => {
	it("replaces what an absorbed entry got before with an absorbed outcome naming the pack", () => {
		const outcomes = withAbsorptions([
			{ status: "up-to-date", key: "owner/repo/loose" },
			{
				status: "updated",
				key: "owner/repo/pack",
				summary: "s",
				newEntry: makeEntry(),
				notes: [],
				absorbed: ["owner/repo/loose"],
			},
		]);

		expect(outcomes.map((outcome) => outcome.status)).toEqual([
			"updated",
			"absorbed",
		]);
		expect(outcomes[1]).toEqual({
			status: "absorbed",
			key: "owner/repo/loose",
			into: "owner/repo/pack",
			summary: "owner/repo/loose is now part of the pack owner/repo/pack",
		});
	});

	it("adds an absorbed outcome for an entry that was skipped", () => {
		const outcomes = withAbsorptions([
			{
				status: "updated",
				key: "owner/repo/pack",
				summary: "s",
				newEntry: makeEntry(),
				notes: [],
				absorbed: ["owner/repo/loose"],
			},
		]);

		expect(outcomes.map((outcome) => outcome.key)).toEqual([
			"owner/repo/pack",
			"owner/repo/loose",
		]);
	});

	it("keeps the key an entry moved from when a pack takes it over after the move", () => {
		const outcomes = withAbsorptions([
			{
				status: "updated",
				key: "owner/repo/foo",
				previousKey: "owner/repo/packs/foo",
				summary: "s",
				newEntry: makeEntry(),
				notes: [],
				absorbed: [],
			},
			{
				status: "updated",
				key: "owner/repo/packs",
				summary: "s",
				newEntry: makeEntry({ type: "pack" }),
				notes: [],
				absorbed: ["owner/repo/foo"],
			},
		]);

		expect(outcomes).toEqual([
			expect.objectContaining({ key: "owner/repo/packs" }),
			{
				status: "absorbed",
				key: "owner/repo/foo",
				previousKey: "owner/repo/packs/foo",
				into: "owner/repo/packs",
				summary: "owner/repo/foo is now part of the pack owner/repo/packs",
			},
		]);
	});

	it("says an entry a pack took over was removed when the pack's copy then failed", () => {
		const outcomes = withAbsorptions([
			{
				status: "copy-failed",
				key: "owner/repo/pack",
				summary: "s",
				absorbed: ["owner/repo/loose"],
			},
		]);

		expect(outcomes[1]).toEqual({
			status: "absorbed",
			key: "owner/repo/loose",
			into: "owner/repo/pack",
			summary:
				"owner/repo/loose was removed — the pack owner/repo/pack took it over, then failed to install",
		});
	});
});

describe("packsFirst", () => {
	it("puts packs ahead of loose skills, keeping each kind's order", () => {
		const members = [
			{ key: "a", entry: makeEntry({ type: "skill" }) },
			{ key: "b", entry: makeEntry({ type: "pack" }) },
			{ key: "c", entry: makeEntry() },
			{ key: "d", entry: makeEntry({ type: "pack" }) },
		];

		expect(packsFirst(members).map((m) => m.key)).toEqual(["b", "d", "a", "c"]);
	});
});

describe("reinstallInTurn", () => {
	it("skips a member a pack before it absorbed, without reinstalling it", async () => {
		const pack = { key: "owner/repo/pack", entry: makeEntry({ type: "pack" }) };
		const loose = { key: "owner/repo/loose", entry: makeEntry() };
		const reinstall = vi.fn(
			async (member: { key: string }): Promise<PluginOutcome> => ({
				status: "updated",
				key: member.key,
				summary: "s",
				newEntry: makeEntry(),
				notes: [],
				absorbed: member.key === pack.key ? [loose.key] : [],
			}),
		);

		const outcomes = await reinstallInTurn(
			[pack, loose],
			makeManifest({ [pack.key]: pack.entry, [loose.key]: loose.entry }),
			reinstall,
		);

		expect(reinstall).toHaveBeenCalledOnce();
		expect(outcomes.map((outcome) => outcome.status)).toEqual([
			"updated",
			"absorbed",
		]);
	});

	it("skips a member a pack took over even when the pack's copy then failed", async () => {
		const pack = { key: "owner/repo/pack", entry: makeEntry({ type: "pack" }) };
		const loose = { key: "owner/repo/loose", entry: makeEntry() };
		const reinstall = vi.fn(
			async (): Promise<PluginOutcome> => ({
				status: "copy-failed",
				key: pack.key,
				summary: "s",
				absorbed: [loose.key],
			}),
		);

		const outcomes = await reinstallInTurn(
			[pack, loose],
			makeManifest({ [pack.key]: pack.entry, [loose.key]: loose.entry }),
			reinstall,
		);

		expect(reinstall).toHaveBeenCalledOnce();
		expect(outcomes.map((outcome) => outcome.status)).toEqual([
			"copy-failed",
			"absorbed",
		]);
	});

	it("reinstalls each member against the manifest the ones before it left", async () => {
		const first = { key: "owner/repo/a", entry: makeEntry() };
		const second = { key: "owner/repo/b", entry: makeEntry() };
		const newEntry = makeEntry({ commit: SHA_TGT });
		const seen: Array<Record<string, unknown>> = [];

		await reinstallInTurn(
			[first, second],
			makeManifest({ [first.key]: first.entry, [second.key]: second.entry }),
			async (member, current) => {
				seen.push(current);
				return {
					status: "updated",
					key: member.key,
					summary: "s",
					newEntry,
					notes: [],
					absorbed: [],
				};
			},
		);

		expect(seen[1]?.[first.key]).toBe(newEntry);
	});
});

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

	it("agrees with the member move: displayRef equals cloneRef ?? member.ref for every reachable arm (grouping invariant)", () => {
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

	function installedOf(
		members: Array<{ key: string; entry: ManifestEntry }>,
	): Manifest {
		return Object.fromEntries(members.map(({ key, entry }) => [key, entry]));
	}

	beforeEach(() => {
		vi.clearAllMocks();
		mockCloneSource.mockResolvedValue({
			tempDir: CLONE_DIR,
			commit: CLONE_COMMIT,
		});
		mockCleanupTempDir.mockResolvedValue(undefined);
		mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
		mockPathExists.mockResolvedValue(true);
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
			projectScope("/fake/project"),
			installedOf(members),
		);
		const { outcomes } = result;

		expect(result.cloneFailed).toBe(false);
		expect(mockCloneSource).toHaveBeenCalledTimes(1);
		expect(mockCleanupTempDir).toHaveBeenCalledTimes(1);
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
		// No member carries a sourceSubpath, so each key's own suffix is guarded.
		for (const name of ["a", "b", "c"]) {
			expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
				CLONE_DIR,
				name,
			);
		}
		// Branch facets.commit is the group's resolved sha, not the clone's HEAD.
		const first = outcomes[0]!;
		if (first.status === "updated") {
			expect(first.newEntry.commit).toBe(SHA_RESOLVED);
		}
	});

	it.each([
		["a branch group stays on its branch", "main", BRANCH_TARGET],
		[
			"a HEAD group stays on HEAD",
			null,
			{ kind: "head", resolvedSha: SHA_RESOLVED } as const,
		],
	])("keeps each member's recorded ref: %s", async (_, ref, target) => {
		const members = [
			branchMember("owner/repo/a", { ref }),
			branchMember("owner/repo/b", { ref }),
		];

		const { outcomes } = await processGroupUpdate(
			{ ...branchGroup(members), versionIntent: ref },
			members,
			target,
			projectScope("/fake/project"),
			installedOf(members),
		);

		expect(mockCloneSource).toHaveBeenCalledWith(
			expect.objectContaining({ ref }),
		);
		expect(outcomes).toEqual([
			expect.objectContaining({
				status: "updated",
				newEntry: expect.objectContaining({ ref, commit: SHA_RESOLVED }),
			}),
			expect.objectContaining({
				status: "updated",
				newEntry: expect.objectContaining({ ref, commit: SHA_RESOLVED }),
			}),
		]);
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
			projectScope("/fake/project"),
			installedOf(members),
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
			projectScope("/fake/project"),
			installedOf(members),
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
		mockPathExists.mockImplementation(async (path: string) => {
			if (path === `${CLONE_DIR}/b/SKILL.md`) {
				throw new Error("kaboom");
			}
			return true;
		});

		const { outcomes } = await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			projectScope("/fake/project"),
			installedOf(members),
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
		mockPathExists.mockImplementation(async (path: string) => {
			if (path === `${CLONE_DIR}/b/SKILL.md`) {
				throw new Error("kaboom");
			}
			return true;
		});

		await processGroupUpdate(
			branchGroup(members),
			members,
			BRANCH_TARGET,
			projectScope("/fake/project"),
			installedOf(members),
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
			projectScope("/fake/project"),
			installedOf(members),
		);

		expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(`${CLONE_DIR}/a`, {
			root: CLONE_DIR,
			local: false,
		});
		expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(`${CLONE_DIR}/b`, {
			root: CLONE_DIR,
			local: false,
		});
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
			projectScope("/fake/project"),
			installedOf(members),
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
			expect(o).toEqual({
				status: "failed",
				key: o.key,
				summary: `${o.key}: Failed — git clone failed after 3 attempts: network error`,
			});
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
			projectScope("/fake/project"),
			installedOf([updatingA, updatingB, upToDate]),
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

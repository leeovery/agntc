import type { Stats } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgntcConfig } from "../../src/config.js";
import type { CopyBareSkillResult } from "../../src/copy-bare-skill.js";
import type { CopyPluginAssetsResult } from "../../src/copy-plugin-assets.js";
import { ExitSignal } from "../../src/exit-signal.js";
import type { CloneResult } from "../../src/git-clone.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { NukeResult } from "../../src/nuke-files.js";
import type { DetectedType } from "../../src/type-detection.js";
import type { UpdateCheckResult } from "../../src/update-check.js";

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack();
});

vi.mock("../../src/manifest.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/manifest.js")>()),
	readManifest: vi.fn(),
	readManifestOrExit: vi.fn(),
	writeManifest: vi.fn(),
	addEntry: vi.fn(),
	removeEntry: vi.fn(),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/update-check.js")>();
	return {
		// Single-key path (runSingleUpdate) still resolves per key via checkForUpdate.
		checkForUpdate: vi.fn(),
		// All-mode path (runAllUpdates) resolves ONE target per group (task 1-5);
		// categorizeMember stays REAL so a mocked/bridged target is classified by the
		// production rule against each member's own installed commit.
		resolveGroupTarget: vi.fn(),
		categorizeMember: actual.categorizeMember,
		hasOutOfConstraintVersion: actual.hasOutOfConstraintVersion,
	};
});

vi.mock("../../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
	readConfig: vi.fn(),
}));

vi.mock("../../src/type-detection.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/type-detection.js")>();
	return {
		detectType: vi.fn(),
		ASSET_DIRS: actual.ASSET_DIRS,
		findPresentAssetDirs: actual.findPresentAssetDirs,
	};
});

vi.mock("../../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../../src/copy-plugin-assets.js", () => ({
	copyPluginAssets: vi.fn(),
}));

vi.mock("../../src/copy-bare-skill.js", () => ({
	copyBareSkill: vi.fn(),
}));

vi.mock("../../src/drivers/registry.js", () => ({
	getDriver: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	stat: vi.fn(),
	access: vi.fn(),
}));

vi.mock("../../src/copy-safety.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/copy-safety.js")>();
	const { mockCopySafety } = await import("../helpers/copy-safety-mock.js");
	return {
		...actual,
		...mockCopySafety(actual.SymlinkEscapeError),
	};
});

import { access, stat } from "node:fs/promises";
import * as p from "@clack/prompts";
import { runUpdate } from "../../src/commands/update.js";
import { readConfig } from "../../src/config.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import {
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../../src/copy-safety.js";
import { getDriver } from "../../src/drivers/registry.js";
import { cleanupTempDir, cloneSource } from "../../src/git-clone.js";
import {
	addEntry,
	readManifest,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { detectType } from "../../src/type-detection.js";
import {
	checkForUpdate,
	type GroupTarget,
	resolveGroupTarget,
} from "../../src/update-check.js";

const mockReadManifest = vi.mocked(readManifest);
const mockReadManifestOrExit = vi.mocked(readManifestOrExit);
const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockRemoveEntry = vi.mocked(removeEntry);
const mockCheckForUpdate = vi.mocked(checkForUpdate);
const mockResolveGroupTarget = vi.mocked(resolveGroupTarget);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockStat = vi.mocked(stat);
const mockAccess = vi.mocked(access);
const mockOutro = vi.mocked(p.outro);
const mockLog = vi.mocked(p.log);
const mockCancel = vi.mocked(p.cancel);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);

import { makeEntry, makeFakeDriver } from "../helpers/factories.js";

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);

const fakeDriver = makeFakeDriver();

// --- All-mode group-target bridge ---
// runAllUpdates resolves ONE GroupTarget per group (task 1-5) instead of a
// per-member checkForUpdate. To keep the behavioural all-mode regression tests
// expressing intent via checkForUpdate (their existing arrange), this bridge is
// installed as the DEFAULT resolveGroupTarget mock: it derives the group's
// target from the desired per-key UpdateCheckResult (read off the still-mocked
// checkForUpdate for the group's representative member), so the REAL
// categorizeMember + processGroupUpdate then run unchanged. Tests that assert
// directly on the seam (the clone-once cases + the four migrated cases) override
// this with an explicit mockResolveGroupTarget. Locals never reach here (they
// are excluded from grouping), and only groups-of-one occur in these tests, so
// the representative member IS the group.
function groupTargetFromCheckResult(
	entry: ManifestEntry,
	result: UpdateCheckResult,
): GroupTarget {
	switch (result.status) {
		case "update-available":
			return entry.ref === null
				? { kind: "head", resolvedSha: result.remoteCommit }
				: { kind: "branch", resolvedSha: result.remoteCommit };
		case "up-to-date":
			return entry.ref === null
				? { kind: "head", resolvedSha: entry.commit! }
				: { kind: "branch", resolvedSha: entry.commit! };
		case "newer-tags":
			return { kind: "tag", tag: entry.ref!, newerTags: result.tags };
		case "check-failed":
			return { kind: "check-failed", reason: result.reason };
		case "constrained-update-available":
			return {
				kind: "constrained",
				tag: result.tag,
				commit: result.commit,
				latestOverall: result.latestOverall,
			};
		case "constrained-up-to-date":
			return {
				kind: "constrained",
				tag: entry.ref!,
				commit: entry.commit!,
				latestOverall: result.latestOverall,
			};
		case "constrained-no-match":
			return { kind: "constrained-no-match" };
		case "local":
			throw new Error("local entries are excluded from grouping");
	}
}

function installGroupTargetBridge(): void {
	mockResolveGroupTarget.mockImplementation(async (group) => {
		const { key, entry } = group.members[0]!;
		const result = await mockCheckForUpdate(key, entry);
		return groupTargetFromCheckResult(entry, result);
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
	mockWriteManifest.mockResolvedValue(undefined);
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockGetDriver.mockReturnValue(fakeDriver);
	// Default: the recorded structural unit still exists in the re-clone, so the
	// derive-before-delete gate passes (pathExists -> access resolves).
	mockAccess.mockResolvedValue(undefined);
	// Default: no escaping symlink in the re-clone (copy-safety scan passes).
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
	mockAddEntry.mockImplementation((manifest, key, entry) => ({
		...manifest,
		[key]: entry,
	}));
	mockRemoveEntry.mockImplementation((manifest, key) => {
		const { [key]: _, ...rest } = manifest;
		return rest;
	});
	installGroupTargetBridge();
});

describe("update command", () => {
	describe("intro", () => {
		it("shows the 'agntc update' intro (all-plugins mode)", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate();

			expect(vi.mocked(p.intro)).toHaveBeenCalledWith("agntc update");
		});

		it("shows the 'agntc update' intro (single-key mode)", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate("owner/repo");

			expect(vi.mocked(p.intro)).toHaveBeenCalledWith("agntc update");
		});
	});

	describe("all-plugins mode (no key)", () => {
		it("displays message and exits 0 when manifest is empty", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate();

			expect(mockOutro).toHaveBeenCalledWith("No plugins installed.");
			expect(mockCheckForUpdate).not.toHaveBeenCalled();
		});

		it("checks all entries in parallel", async () => {
			const entryA = makeEntry({ commit: INSTALLED_SHA });
			const entryB = makeEntry({ commit: INSTALLED_SHA });
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});

			let resolveA!: (v: UpdateCheckResult) => void;
			let resolveB!: (v: UpdateCheckResult) => void;
			const promiseA = new Promise<UpdateCheckResult>((r) => {
				resolveA = r;
			});
			const promiseB = new Promise<UpdateCheckResult>((r) => {
				resolveB = r;
			});

			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a") {
						return promiseA;
					}
					return promiseB;
				},
			);

			const runPromise = runUpdate();

			// Wait a tick for both to start
			await new Promise((r) => setTimeout(r, 10));

			// Both should be inflight (parallel check)
			expect(mockCheckForUpdate).toHaveBeenCalledTimes(2);

			resolveA({ status: "up-to-date" });
			resolveB({ status: "up-to-date" });

			await runPromise;
		});

		it("shows spinner during parallel checks", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
			vi.mocked(p.spinner).mockReturnValue(
				mockSpinner as ReturnType<typeof p.spinner>,
			);

			await runUpdate();

			expect(mockSpinner.start).toHaveBeenCalledWith(
				expect.stringContaining("Checking for updates"),
			);
			expect(mockSpinner.stop).toHaveBeenCalled();
		});

		it("shows all up-to-date message when all plugins are current", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry(),
				"owner/repo-b": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate();

			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("up to date"),
			);
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("processes update-available plugins via git update", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			// Migrated onto the group seam (task 1-5): all-mode resolves one target
			// per group; the HEAD-tracked entry categorizes update-available.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			expect(mockCloneSource).toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
				expect.objectContaining({
					commit: REMOTE_SHA,
					agents: ["claude"],
				}),
			);
		});

		it("processes local plugins via re-copy", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate();

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: LOCAL_KEY,
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("shows info for newer-tags plugins without updating", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate();

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			// Summary should mention newer tags
			const allLogCalls = [
				...mockLog.info.mock.calls.map((c) => c[0]),
				...mockLog.message.mock.calls.map((c) => c[0]),
			];
			const hasNewerTagsInfo = allLogCalls.some(
				(msg) => typeof msg === "string" && msg.includes("newer tags"),
			);
			expect(hasNewerTagsInfo).toBe(true);
		});

		it("notes check-failed plugins in summary", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			await runUpdate();

			// Should not throw (continues)
			// Summary should mention the failure
			const allLogCalls = [
				...mockLog.warn.mock.calls.map((c) => c[0]),
				...mockLog.message.mock.calls.map((c) => c[0]),
				...mockLog.info.mock.calls.map((c) => c[0]),
			];
			const hasFailedNote = allLogCalls.some(
				(msg) =>
					typeof msg === "string" &&
					(msg.includes("failed") || msg.includes("Failed")),
			);
			expect(hasFailedNote).toBe(true);
		});

		it("all-plugins update emits no check-failed warning for a v4-branch entry resolving to a real status", async () => {
			// Contrast with "notes check-failed plugins in summary": once the "v4"
			// branch ref resolves to a real status (Task 1.2), the all-plugins summary
			// must NOT warn about a check failure for that entry.
			mockReadManifestOrExit.mockResolvedValue({
				"nuxt/ui": makeEntry({ ref: "v4", commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate();

			const allLogCalls = [
				...mockLog.warn.mock.calls.map((c) => c[0]),
				...mockLog.message.mock.calls.map((c) => c[0]),
				...mockLog.info.mock.calls.map((c) => c[0]),
			];
			const hasFailedNote = allLogCalls.some(
				(msg) =>
					typeof msg === "string" &&
					(msg.includes("failed") || msg.includes("Failed")),
			);
			expect(hasFailedNote).toBe(false);
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("up to date"),
			);
		});

		// NOTE: the former 'performs single manifest write for multiple updates'
		// test asserted a SINGLE end-of-run write. Under task 1-6 per-group
		// persistence that expectation is wrong (N groups → N writes); it is
		// superseded by 'writes the manifest once per updatable group (two groups
		// -> two writes)' in the "per-group manifest persistence (task 1-6)" block.

		it("continues processing when one plugin fails during update", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			// Migrated onto the group seam (task 1-5): both resolve update-available;
			// group A's clone fails (group-fatal → failed outcome), group B succeeds.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});

			// First clone fails, second succeeds
			mockCloneSource
				.mockRejectedValueOnce(new Error("clone failed"))
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			// Partial failure: B is still processed and written, but the run exits
			// non-zero because A hard-errored. Catch so the assertions below run.
			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// B should have been processed despite A failing
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("handles mixed types in a single run", async () => {
			const gitEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/git-skill/"],
			});
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/local-skill/"],
				cloneUrl: null,
			};
			const tagEntry = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/tagged-skill/"],
			});
			const upToDateEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/current-skill/"],
			});

			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-git": gitEntry,
				"/local/path": localEntry,
				"owner/repo-tag": tagEntry,
				"owner/repo-current": upToDateEntry,
			});

			// Migrated onto the group seam (task 1-5): the local entry is excluded
			// from grouping (handled as a group-of-one, no target). Each remaining
			// group resolves one target; categorizeMember derives the per-member
			// verdict against its own installed commit.
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				if (key === "owner/repo-git")
					return { kind: "head", resolvedSha: REMOTE_SHA };
				if (key === "owner/repo-tag")
					return { kind: "tag", tag: "v1.0", newerTags: ["v2.0"] };
				return { kind: "head", resolvedSha: INSTALLED_SHA };
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/some-skill/"],
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);

			await runUpdate();

			// Git update should clone
			expect(mockCloneSource).toHaveBeenCalled();
			// Local update should stat
			expect(mockStat).toHaveBeenCalled();
			// Tag-pinned should not clone or nuke.
			// Per-group persistence (task 1-6): the git group and the local
			// group-of-one each persist independently → two writes (tag-pinned and
			// up-to-date never mutate, so they add no write).
			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
		});

		it("shows per-plugin summary", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});

			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return { status: "update-available", remoteCommit: REMOTE_SHA };
					return { status: "up-to-date" };
				},
			);

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate();

			// Should have per-plugin info in the output
			const allMessages = [
				...mockLog.info.mock.calls.map((c) => c[0]),
				...mockLog.message.mock.calls.map((c) => c[0]),
				...mockLog.success.mock.calls.map((c) => c[0]),
			];
			const hasRepoA = allMessages.some(
				(msg) => typeof msg === "string" && msg.includes("owner/repo-a"),
			);
			const hasRepoB = allMessages.some(
				(msg) => typeof msg === "string" && msg.includes("owner/repo-b"),
			);
			expect(hasRepoA).toBe(true);
			expect(hasRepoB).toBe(true);
		});

		it("emits dropped-agent warning for git update in all-plugins mode", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});

		it("emits dropped-agent warning for local update in all-plugins mode", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude", "codex"],
				files: [".claude/skills/my-plugin/", ".agents/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate();

			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});

		it("does not write manifest when nothing was updated", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry(),
				"owner/repo-b": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-b")
						return { status: "newer-tags", tags: ["v2.0"] };
					return { status: "up-to-date" };
				},
			);

			await runUpdate();

			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("cleans up temp dirs for git updates", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("group-first all-mode wiring (task 1-5)", () => {
		it("a 3-member collection clones once and runs one group check", async () => {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^1.2.3",
					agents: ["claude"],
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			// One (cloneUrl, versionIntent) for all three → a single group.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockResolveGroupTarget).toHaveBeenCalledTimes(1);
		});

		it("a local entry reinstalls as a group-of-one without cloning", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate();

			// Excluded from grouping: no group check, no clone; reinstalled in place.
			expect(mockResolveGroupTarget).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: LOCAL_KEY }),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("the grouped path does not emit the per-clone Cloning repository... spinner", async () => {
			const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
			vi.mocked(p.spinner).mockReturnValue(
				mockSpinner as ReturnType<typeof p.spinner>,
			);
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					agents: ["claude"],
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: INSTALLED_SHA,
					agents: ["claude"],
					files: [".claude/skills/b/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			const startCalls = mockSpinner.start.mock.calls.map(
				(c) => c[0] as string,
			);
			// The per-clone spinner lives only in cloneAndReinstall (singletons/locals).
			expect(startCalls.some((m) => m.includes("Cloning repository"))).toBe(
				false,
			);
			// The single leading check spinner still frames the group resolution.
			expect(startCalls.some((m) => m.includes("Checking for updates"))).toBe(
				true,
			);
		});

		it("single-key still routes through cloneAndReinstall (per-clone spinner, no group check)", async () => {
			const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
			vi.mocked(p.spinner).mockReturnValue(
				mockSpinner as ReturnType<typeof p.spinner>,
			);
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					commit: INSTALLED_SHA,
					agents: ["claude"],
					files: [".claude/skills/my-skill/"],
				}),
			});
			// Single-key keeps using checkForUpdate; the group seam is not touched.
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			const startCalls = mockSpinner.start.mock.calls.map(
				(c) => c[0] as string,
			);
			expect(startCalls.some((m) => m.includes("Cloning repository"))).toBe(
				true,
			);
			expect(mockResolveGroupTarget).not.toHaveBeenCalled();
			expect(mockCheckForUpdate).toHaveBeenCalledWith(
				"owner/repo",
				expect.anything(),
			);
		});
	});

	describe("per-group manifest persistence (task 1-6)", () => {
		it("writes the manifest once per updatable group (two groups -> two writes)", async () => {
			// Two distinct repos → two groups-of-one, each update-available. Per-group
			// persistence writes once per group (N groups → N writes), replacing the
			// old single end-of-run write.
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/updated/"],
			});

			await runUpdate();

			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			// The final (cumulative) write reflects both groups' updates.
			const lastWrite = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(lastWrite["owner/repo-a"]!.commit).toBe(REMOTE_SHA);
			expect(lastWrite["owner/repo-b"]!.commit).toBe(REMOTE_SHA);
		});

		it("a copy-failed member removes its entry from that group write; siblings' updates persist", async () => {
			// Group 1 = a 2-member collection: member `a` copy-fails (entry removed),
			// sibling `b` updates (entry added) — folded into ONE group write. Group 2
			// = a standalone repo that updates → its own write. N groups → N writes.
			const memberA = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/a/"],
			});
			const memberB = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/b/"],
			});
			const standalone = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/c/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": memberA,
				"owner/repo/b": memberB,
				"zother/repo": standalone,
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// Member `a` (first reinstall) copy-fails; `b` and the standalone succeed.
			mockCopyBareSkill
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValue({ copiedFiles: [".claude/skills/updated/"] });

			const err = await runUpdate().catch((e) => e);

			// Copy-failed trips the non-zero exit; both groups still persisted.
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			expect(mockRemoveEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo/a",
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo/b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			// Group 1's write (first): member `a` removed, sibling `b` persisted.
			const groupOneWrite = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(groupOneWrite["owner/repo/a"]).toBeUndefined();
			expect(groupOneWrite["owner/repo/b"]).toBeDefined();
		});

		it("aborted / blocked / no-agents / up-to-date members leave the manifest entry intact (no add/remove)", async () => {
			// Four standalone repos, each a group-of-one, hitting a non-mutating
			// category: aborted (derive gate), blocked (symlink escape), no-agents
			// (config drops the installed agent), and up-to-date (never actioned).
			// None add or remove — so no group writes the manifest at all.
			const aborted = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/abort/"],
			});
			const blocked = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/block/"],
			});
			const noAgents = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["codex"],
				files: [".agents/skills/noagents/"],
			});
			const upToDate = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/current/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/abort": aborted,
				"owner/block": blocked,
				"owner/noagents": noAgents,
				"owner/current": upToDate,
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				return key === "owner/current"
					? { kind: "head", resolvedSha: INSTALLED_SHA }
					: { kind: "head", resolvedSha: REMOTE_SHA };
			});
			// Distinct clones so the abort/block mocks can key on the group's tempDir.
			mockCloneSource
				.mockResolvedValueOnce({
					tempDir: "/tmp/clone-abort",
					commit: REMOTE_SHA,
				})
				.mockResolvedValueOnce({
					tempDir: "/tmp/clone-block",
					commit: REMOTE_SHA,
				})
				.mockResolvedValueOnce({
					tempDir: "/tmp/clone-noagents",
					commit: REMOTE_SHA,
				});
			// Re-cloned config supports only claude → the codex-only entry drops to
			// no-agents.
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// abort clone: recorded SKILL.md gone → derive gate aborts (others present).
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-abort")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			// block clone: escaping symlink → copy-safety block (others clean).
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (
						typeof sourceDir === "string" &&
						sourceDir.includes("/clone-block")
					) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			// aborted + blocked trip the non-zero exit; catch so assertions run.
			await runUpdate().catch(() => {});

			// No member mutated the manifest → no add/remove and no group write.
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("each group write reflects prior groups' updates (matching disk at group boundaries)", async () => {
			// Two update-available repos with DISTINCT resolved commits. Group A writes
			// first; group B's later write must still carry group A's update (prior
			// groups recorded), while group A's write shows group B still at its old
			// commit (not-yet-run groups untouched).
			const SHA_A = "c".repeat(40);
			const SHA_B = "d".repeat(40);
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				return {
					kind: "head",
					resolvedSha: key === "owner/repo-a" ? SHA_A : SHA_B,
				};
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/updated/"],
			});

			await runUpdate();

			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			// Group A's write: A updated, B still at its pre-run commit (not yet run).
			const firstWrite = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(firstWrite["owner/repo-a"]!.commit).toBe(SHA_A);
			expect(firstWrite["owner/repo-b"]!.commit).toBe(INSTALLED_SHA);
			// Group B's write: A's earlier update still present, B now updated.
			const secondWrite = mockWriteManifest.mock.calls[1]![1] as Manifest;
			expect(secondWrite["owner/repo-a"]!.commit).toBe(SHA_A);
			expect(secondWrite["owner/repo-b"]!.commit).toBe(SHA_B);
		});

		it("outcomes[] still trips hasFailedOutcome for copy-failed/aborted/blocked (non-zero exit)", async () => {
			// Three standalone repos, each a group-of-one producing one hard-failure
			// outcome. Per-group persistence doesn't change exit accounting: every
			// member outcome still accumulates into outcomes[], so any
			// copy-failed/aborted/blocked trips the non-zero exit.
			const cf = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/cf/"],
			});
			const ab = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/ab/"],
			});
			const bl = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/bl/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/cf": cf,
				"owner/ab": ab,
				"owner/bl": bl,
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-cf", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-ab", commit: REMOTE_SHA })
				.mockResolvedValueOnce({
					tempDir: "/tmp/clone-bl",
					commit: REMOTE_SHA,
				});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// ab clone: SKILL.md gone → aborted (cf's present so it reaches copy).
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-ab")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			// bl clone: escaping symlink → blocked.
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (
						typeof sourceDir === "string" &&
						sourceDir.includes("/clone-bl")
					) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			// cf clone: copy throws → copy-failed (removes its entry).
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// All three failure outcomes were collected and reported (accumulated into
			// outcomes[]), and the copy-failed one persisted its removal per group.
			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			expect(errorCalls.some((m) => m.includes("owner/cf"))).toBe(true);
			expect(errorCalls.some((m) => m.includes("owner/ab"))).toBe(true);
			expect(errorCalls.some((m) => m.includes("owner/bl"))).toBe(true);
			expect(mockRemoveEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/cf",
			);
		});
	});

	describe("empty manifest", () => {
		it("displays message and exits 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith("No plugins installed.");
			expect(mockCheckForUpdate).not.toHaveBeenCalled();
		});
	});

	describe("non-existent key", () => {
		it("exits 1 with error message", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"other/plugin": makeEntry(),
			});

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				"Plugin owner/repo is not installed.",
			);
		});
	});

	describe("up-to-date", () => {
		it("displays up-to-date message and exits 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				"owner/repo is already up to date.",
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("single-key update of a v4-branch entry that is up-to-date exits 0", async () => {
			// Cross-surface recovery: a branch ref that looks like a tag ("v4") now
			// resolves to a real status. The single-key path must take the up-to-date
			// branch (outro + exit 0), NOT the check-failed exit-1 branch it hit
			// before Task 1.2's classification fix.
			mockReadManifestOrExit.mockResolvedValue({
				"nuxt/ui": makeEntry({ ref: "v4", commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			const err = await runUpdate("nuxt/ui").catch((e) => e);

			// Resolves (no ExitSignal) — up-to-date, not the check-failed exit-1 path.
			expect(err).toBeUndefined();
			expect(mockOutro).toHaveBeenCalledWith("nuxt/ui is already up to date.");
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockLog.error).not.toHaveBeenCalled();
		});
	});

	describe("check-failed", () => {
		it("exits 1 with error when update check fails", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				"Update check failed for owner/repo: network timeout",
			);
		});
	});

	describe("update-available — full pipeline", () => {
		it("clones before nuking existing files", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const callOrder: string[] = [];
			mockCloneSource.mockImplementation(async () => {
				callOrder.push("clone");
				return { tempDir: "/tmp/agntc-clone", commit: REMOTE_SHA };
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});

			await runUpdate("owner/repo");

			expect(callOrder).toEqual(["clone", "nuke"]);
		});

		it("copies from temp dir after nuke", async () => {
			const entry = makeEntry({
				type: "plugin",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/new-skill/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runUpdate("owner/repo");

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: "/tmp/agntc-clone",
					projectDir: "/fake/project",
				}),
			);
		});

		it("updates manifest with new commit and files", async () => {
			const entry = makeEntry({
				ref: null,
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/old-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ "owner/repo": entry },
				"owner/repo",
				expect.objectContaining({
					ref: null,
					commit: REMOTE_SHA,
					agents: ["claude"],
					files: [".claude/skills/my-skill/"],
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("shows summary with old and new commit", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining(INSTALLED_SHA.slice(0, 7)),
			);
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining(REMOTE_SHA.slice(0, 7)),
			);
		});
	});

	describe("no confirmation needed", () => {
		it("does not prompt for confirmation before updating", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// No confirm mock was set up — would throw if called
			// Also explicitly verify no confirm import usage
			expect(mockWriteManifest).toHaveBeenCalled();
		});
	});

	describe("agent compatibility — effective agents", () => {
		it("uses intersection of entry.agents and new config.agents", async () => {
			const entry = makeEntry({
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version only supports claude (dropped codex)
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// Should only install for claude (effective agents)
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					agents: [expect.objectContaining({ id: "claude" })],
				}),
			);
			// Manifest updated with effective agents
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
				expect.objectContaining({
					agents: ["claude"],
				}),
			);
		});

		it("proceeds normally when agents have not changed", async () => {
			const entry = makeEntry({
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockLog.warn).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					agents: [
						expect.objectContaining({ id: "claude" }),
						expect.objectContaining({ id: "codex" }),
					],
				}),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
				expect.objectContaining({
					agents: ["claude", "codex"],
				}),
			);
		});

		it("ignores new agents added by plugin author", async () => {
			const entry = makeEntry({
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version adds codex support, but entry only has claude
			mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// Only claude is used (intersection), codex is ignored
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					agents: [expect.objectContaining({ id: "claude" })],
				}),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
				expect.objectContaining({
					agents: ["claude"],
				}),
			);
			// No warnings for new agents
			expect(mockLog.warn).not.toHaveBeenCalled();
		});

		it("includes dropped agent info in summary when partial drop", async () => {
			const entry = makeEntry({
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			const summaryCall = mockOutro.mock.calls[0]![0] as string;
			expect(summaryCall).toContain("codex support removed");
		});

		it("warns when agents are dropped by new version", async () => {
			const entry = makeEntry({
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});
	});

	describe("all-agents-dropped", () => {
		it("aborts without nuking when all agents are dropped", async () => {
			const entry = makeEntry({
				agents: ["codex"],
				files: [".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version only supports claude, entry has codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			await runUpdate("owner/repo");

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining(
					"no longer supports any of your installed agents",
				),
			);
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("shows remove command in all-agents-dropped warning", async () => {
			const entry = makeEntry({
				agents: ["codex"],
				files: [".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			await runUpdate("owner/repo");

			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("npx agntc remove owner/repo"),
			);
		});

		it("exits 0 when all agents dropped (preserves existing files)", async () => {
			const entry = makeEntry({
				agents: ["codex"],
				files: [".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			// Should not throw — exits 0
			await runUpdate("owner/repo");

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("irreconcilable-change abort (derive-before-delete)", () => {
		function arrangeRecordedSkillAbort(key = "owner/repo"): ManifestEntry {
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ [key]: entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			// Recorded skill's SKILL.md is gone in the re-clone -> derive gate aborts.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			return entry;
		}

		it("single-key update of aborting entry exits non-zero", async () => {
			arrangeRecordedSkillAbort();

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("abort message names recorded type, current structure change, and remove+add remedy", async () => {
			arrangeRecordedSkillAbort();

			await runUpdate("owner/repo").catch(() => {});

			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			const msg = errorCalls.find((m) => m.includes("owner/repo"));
			expect(msg).toBeDefined();
			expect(msg).toContain("skill");
			expect(msg).toContain("SKILL.md");
			expect(msg).toContain("unchanged");
			expect(msg).toContain("npx agntc remove owner/repo");
			expect(msg).toContain("npx agntc add");
		});

		it("does not nuke or mutate the manifest on abort (install intact)", async () => {
			arrangeRecordedSkillAbort();

			await runUpdate("owner/repo").catch(() => {});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		it("is distinct from copy-failed: install intact, no entry removal, no retry hint", async () => {
			arrangeRecordedSkillAbort();

			await runUpdate("owner/repo").catch(() => {});

			// Copy-failed removes the entry + writes the manifest; abort must not.
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			// Copy-failed hint tells the user the unit is currently uninstalled;
			// abort must NOT use that wording (install is intact).
			const hasRetryHint = errorCalls.some((m) =>
				m.includes("currently uninstalled"),
			);
			expect(hasRetryHint).toBe(false);
		});

		it("all-updates: aborted outcome does not mutate the manifest", async () => {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// repo-a's SKILL.md gone -> abort; repo-b's present -> succeeds.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/skill-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			// All-updates partial abort exits non-zero (after writing successful
			// siblings); catch so the manifest assertions below still run.
			await runUpdate().catch(() => {});

			// Manifest write must NOT include any add/remove for the aborted entry.
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			const writeCalls = mockWriteManifest.mock.calls;
			for (const call of writeCalls) {
				const written = call[1] as Manifest;
				// aborted entry stays exactly as it was, never removed.
				expect(written["owner/repo-a"]).toBeDefined();
			}
		});

		it("all-updates: aborted outcome reports loud per-unit message naming remedy", async () => {
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockAccess.mockRejectedValue(new Error("ENOENT"));

			// All-updates abort exits non-zero after rendering the loud summary;
			// catch so the summary assertions below still run.
			await runUpdate().catch(() => {});

			const allMessages = [
				...mockLog.error.mock.calls,
				...mockLog.warn.mock.calls,
			].map((c) => c[0] as string);
			const msg = allMessages.find(
				(m) => m.includes("owner/repo") && m.includes("skill"),
			);
			expect(msg).toBeDefined();
			expect(msg).toContain("SKILL.md");
			expect(msg).toContain("unchanged");
			expect(msg).toContain("npx agntc remove owner/repo");
		});
	});

	describe("symlink-escape copy-safety block (distinct from derive-before-delete abort)", () => {
		function arrangeSymlinkEscape(key = "owner/repo"): ManifestEntry {
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ [key]: entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			// The recorded unit is still structurally present (derive gate would
			// pass), but the re-clone contains an escaping symlink -> copy-safety block.
			mockAccess.mockResolvedValue(undefined);
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);
			return entry;
		}

		it("single-key update with an escaping symlink exits non-zero", async () => {
			arrangeSymlinkEscape();

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("reports a copy-safety message describing the symlink escape, NOT a type change or remove+add", async () => {
			arrangeSymlinkEscape();

			await runUpdate("owner/repo").catch(() => {});

			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			const msg = errorCalls.find((m) => m.includes("owner/repo"));
			expect(msg).toBeDefined();
			expect(msg).toContain("evil-link");
			expect(msg?.toLowerCase()).toContain("symlink");
			expect(msg).toContain("unchanged");
			// Must NOT use the derive-before-delete framing or remedy.
			expect(msg).not.toContain("no longer supports that type");
			expect(msg).not.toContain("npx agntc remove");
			expect(msg).not.toContain("To migrate");
		});

		it("does not nuke or mutate the manifest on a symlink-escape block (install intact)", async () => {
			arrangeSymlinkEscape();

			await runUpdate("owner/repo").catch(() => {});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		it("all-updates: a symlink-escape member produces a non-success outcome (non-zero exit), manifest untouched, sibling still updates", async () => {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			// Distinct temp dirs per sequential clone so the scan can be made to
			// fail for repo-a (first) and pass for repo-b (second).
			mockCloneSource
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-a",
					commit: REMOTE_SHA,
				})
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// repo-a's re-clone has an escaping symlink -> blocked; repo-b is clean.
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (
						typeof sourceDir === "string" &&
						sourceDir.includes("/agntc-clone-a")
					) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			const err = await runUpdate().catch((e) => e);

			// Non-zero exit from the blocked member.
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);

			// Blocked member's manifest entry never removed; sibling still written.
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			const writeCalls = mockWriteManifest.mock.calls;
			expect(writeCalls.length).toBeGreaterThan(0);
			for (const call of writeCalls) {
				const written = call[1] as Manifest;
				expect(written["owner/repo-a"]).toBeDefined();
			}

			// Copy-safety message rendered for the blocked member.
			const allMessages = [
				...mockLog.error.mock.calls,
				...mockLog.warn.mock.calls,
			].map((c) => c[0] as string);
			const blockedMsg = allMessages.find((m) => m.includes("owner/repo-a"));
			expect(blockedMsg).toBeDefined();
			expect(blockedMsg).toContain("evil-link");
			expect(blockedMsg).not.toContain("no longer supports that type");
		});
	});

	describe("all-updates partial-success exit (per-entry abort granularity)", () => {
		// repo-a (recorded skill) aborts because its SKILL.md is gone in the
		// re-clone; repo-b (sibling collection member / skill) and owner/x both
		// update cleanly. Models per-entry isolation: one unit aborting must not
		// stop the others, and the successful units must still be written.
		function arrangePartialAbort(): {
			entryA: ManifestEntry;
			entryB: ManifestEntry;
		} {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			// Distinct temp dirs per sequential clone so the derive gate can be made
			// to fail for repo-a (first) and pass for repo-b (second).
			mockCloneSource
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-a",
					commit: REMOTE_SHA,
				})
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// repo-a's recorded SKILL.md is gone -> derive gate aborts; repo-b stays.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/agntc-clone-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});
			return { entryA, entryB };
		}

		it("one member aborting does not stop siblings — sibling is updated and written", async () => {
			arrangePartialAbort();

			await runUpdate().catch(() => {});

			// Sibling repo-b was processed (copied) and added to the manifest.
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo-b"]).toBeDefined();
			expect(writtenManifest["owner/repo-b"]!.commit).toBe(REMOTE_SHA);
		});

		it("partial abort exits non-zero", async () => {
			arrangePartialAbort();

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("writes successful updates BEFORE throwing the non-zero exit", async () => {
			arrangePartialAbort();

			const callOrder: string[] = [];
			mockWriteManifest.mockImplementation(async () => {
				callOrder.push("write");
			});

			const err = await runUpdate().catch((e) => {
				callOrder.push("throw");
				return e;
			});

			expect(err).toBeInstanceOf(ExitSignal);
			expect(callOrder).toEqual(["write", "throw"]);
		});

		it("does not roll back the successful sibling when a member aborts", async () => {
			arrangePartialAbort();

			await runUpdate().catch(() => {});

			// No coherence rollback: repo-b's successful entry is never removed.
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
			);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo-b"]).toBeDefined();
		});

		it("leaves the aborted entry's manifest entry unchanged (install intact)", async () => {
			const { entryA } = arrangePartialAbort();

			await runUpdate().catch(() => {});

			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo-a"]).toEqual(entryA);
		});

		it("reports the aborted unit loudly in the per-unit summary", async () => {
			arrangePartialAbort();

			await runUpdate().catch(() => {});

			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			const msg = errorCalls.find((m) => m.includes("owner/repo-a"));
			expect(msg).toBeDefined();
			expect(msg).toContain("skill");
			expect(msg).toContain("unchanged");
			expect(msg).toContain("npx agntc remove owner/repo-a");
		});

		it("lists per-unit outcomes for both the aborted and the succeeded unit", async () => {
			arrangePartialAbort();

			await runUpdate().catch(() => {});

			const successCalls = mockLog.success.mock.calls.map(
				(c) => c[0] as string,
			);
			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			expect(successCalls.some((m) => m.includes("owner/repo-b"))).toBe(true);
			expect(errorCalls.some((m) => m.includes("owner/repo-a"))).toBe(true);
		});

		it("reports each aborted entry with its own reason (two distinct loud lines)", async () => {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// Both recorded skills are gone in the re-clone -> both abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));

			await runUpdate().catch(() => {});

			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			const msgA = errorCalls.find((m) => m.includes("owner/repo-a"));
			const msgB = errorCalls.find((m) => m.includes("owner/repo-b"));
			expect(msgA).toBeDefined();
			expect(msgB).toBeDefined();
			expect(msgA).toContain("npx agntc remove owner/repo-a");
			expect(msgB).toContain("npx agntc remove owner/repo-b");
		});

		it("exits non-zero once even when multiple units abort", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
					agents: ["claude"],
					files: [".claude/skills/skill-a/"],
				}),
				"owner/repo-b": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
					agents: ["claude"],
					files: [".claude/skills/skill-b/"],
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockAccess.mockRejectedValue(new Error("ENOENT"));

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("abort is not swallowed by the all-up-to-date early return", async () => {
			// owner/repo-current is up to date; owner/repo-a aborts. The abort must
			// still be reported and force a non-zero exit (not the up-to-date path).
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-current": makeEntry({
					commit: INSTALLED_SHA,
					agents: ["claude"],
					files: [".claude/skills/current/"],
				}),
				"owner/repo-a": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
					agents: ["claude"],
					files: [".claude/skills/skill-a/"],
				}),
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-current") return { status: "up-to-date" };
					return { status: "update-available", remoteCommit: REMOTE_SHA };
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockAccess.mockRejectedValue(new Error("ENOENT"));

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockOutro).not.toHaveBeenCalledWith(
				expect.stringContaining("up to date"),
			);
			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			expect(errorCalls.some((m) => m.includes("owner/repo-a"))).toBe(true);
		});

		it("plugin single-entry abort is atomic — the entry stays intact and exits non-zero", async () => {
			const entry = makeEntry({
				type: "plugin",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-plugin/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			// Recorded plugin's marker is gone in the re-clone -> derive gate aborts.
			mockAccess.mockRejectedValue(new Error("ENOENT"));

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Whole-entry atomic: no nuke, no manifest mutation for the one entry.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
			);
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("a no-agents unit alongside a successful sibling exits 0 (benign skip)", async () => {
			// repo-a's re-clone no longer supports its installed agent (no-agents) —
			// a benign skip, NOT a hard error/abort. repo-b updates cleanly. The run
			// must exit 0 (no ExitSignal), write the sibling, warn (not error) about
			// the no-agents unit, and leave the no-agents entry untouched.
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["codex"],
				files: [".agents/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// Re-cloned config only supports claude: repo-a (codex) drops to
			// no-agents; repo-b (claude) updates cleanly.
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			const err = await runUpdate().catch((e) => e);

			// Exits 0 — no ExitSignal thrown for a benign no-agents skip.
			expect(err).toBeUndefined();
			// Sibling repo-b is written; no-agents repo-a entry left untouched.
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo-b"]).toBeDefined();
			expect(writtenManifest["owner/repo-b"]!.commit).toBe(REMOTE_SHA);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
				expect.anything(),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			// Reported as a benign warning, not a loud error.
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			expect(warnCalls.some((m) => m.includes("owner/repo-a"))).toBe(true);
			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			expect(errorCalls.some((m) => m.includes("owner/repo-a"))).toBe(false);
		});
	});

	describe("temp dir cleanup", () => {
		it("cleans up temp dir on successful update", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up temp dir when copy fails", async () => {
			const entry = makeEntry();
			const manifest = { "owner/repo": entry };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up temp dir when all agents dropped", async () => {
			const entry = makeEntry({ agents: ["codex"] });
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			await runUpdate("owner/repo");

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("clone failure", () => {
		it("does not modify existing files when clone fails", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("shows error message on clone failure", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockRejectedValue(
				new Error("git clone failed after 3 attempts: network error"),
			);

			await runUpdate("owner/repo").catch(() => {});

			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("git clone failed"),
			);
		});
	});

	describe("constructs ParsedSource for cloneSource", () => {
		it("creates github-shorthand ParsedSource from manifest key and entry ref", async () => {
			const entry = makeEntry({ ref: "dev" });
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "github-shorthand",
					owner: "owner",
					repo: "repo",
					ref: "dev",
				}),
			);
		});

		it("uses stored cloneUrl for cloneSource when available", async () => {
			const entry = makeEntry({
				ref: "dev",
				cloneUrl: "https://gitlab.com/owner/repo.git",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					cloneUrl: "https://gitlab.com/owner/repo.git",
				}),
			);
		});

		it("falls back to github-shorthand when cloneUrl is null", async () => {
			const entry = makeEntry({ ref: "dev", cloneUrl: null });
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "github-shorthand",
					owner: "owner",
					repo: "repo",
				}),
			);
		});

		it("uses null ref for HEAD-tracking plugins", async () => {
			const entry = makeEntry({ ref: null });
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: null,
				}),
			);
		});
	});

	describe("plugin type detection — plugin with asset dirs", () => {
		it("uses copyPluginAssets for plugin type", async () => {
			const entry = makeEntry({
				type: "plugin",
				agents: ["claude"],
				files: [".claude/skills/old-skill/", ".claude/agents/executor.md"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			// Recorded plugin: skills/ and agents/ remain, hooks/ does not.
			mockAccess.mockImplementation(async (path) => {
				if (String(path).endsWith("/hooks")) {
					throw new Error("ENOENT");
				}
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [
					".claude/skills/new-skill/",
					".claude/agents/executor.md",
				],
				assetCountsByAgent: { claude: { skills: 1, agents: 1 } },
			});

			await runUpdate("owner/repo");

			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: "/tmp/agntc-clone",
					assetDirs: ["skills", "agents"],
					projectDir: "/fake/project",
				}),
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});
	});

	describe("plugin type detection — bare skill", () => {
		it("uses copyBareSkill for bare-skill type", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: "/tmp/agntc-clone",
					projectDir: "/fake/project",
				}),
			);
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});
	});

	describe("newer-tags", () => {
		it("shows pinned ref and newer tags available message", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate("owner/repo");

			expect(mockLog.info).toHaveBeenCalledWith(
				"Pinned to v1.0. Newer tags available:",
			);
		});

		it("lists newer tags newest-first", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0", "v4.0"],
			});

			await runUpdate("owner/repo");

			const messageCalls = mockLog.message.mock.calls.map((call) => call[0]);
			expect(messageCalls).toEqual(["  v4.0", "  v3.0", "  v2.0"]);
		});

		it("shows re-add command with newest tag", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				"To upgrade: npx agntc add owner/repo@v3.0",
			);
		});

		it("does not clone, nuke, or write manifest", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0"],
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("exits 0 (does not throw)", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0"],
			});

			await expect(runUpdate("owner/repo")).resolves.toBeUndefined();
		});

		it("shows re-add command for collection plugin key", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/go": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate("owner/repo/go");

			expect(mockOutro).toHaveBeenCalledWith(
				"To upgrade: npx agntc add owner/repo/go@v3.0",
			);
		});
	});

	describe("tag-pinned up-to-date", () => {
		it("shows up-to-date for tag-pinned plugin with no newer tags", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v3.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				"owner/repo is already up to date.",
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("local path re-copy", () => {
		const LOCAL_KEY = "/Users/lee/Code/my-plugin";
		const LOCAL_ENTRY: ManifestEntry = {
			ref: null,
			commit: null,
			installedAt: "2026-02-01T00:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/my-plugin/"],
			cloneUrl: null,
		};

		function setupLocalBase(): void {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});
		}

		it("triggers re-copy from stored path when status is local", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY);

			expect(mockStat).toHaveBeenCalledWith(LOCAL_KEY);
			expect(mockReadConfig).toHaveBeenCalledWith(LOCAL_KEY, expect.anything());
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: LOCAL_KEY,
					projectDir: "/fake/project",
				}),
			);
		});

		it("validates path exists and is a directory", async () => {
			setupLocalBase();
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);

			await runUpdate(LOCAL_KEY);

			expect(mockStat).toHaveBeenCalledWith(LOCAL_KEY);
		});

		it("errors when path does not exist", async () => {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockRejectedValue(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			);

			const err = await runUpdate(LOCAL_KEY).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining("does not exist or is not a directory"),
			);
		});

		it("errors when path is not a directory", async () => {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => false } as Stats);

			const err = await runUpdate(LOCAL_KEY).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining("does not exist or is not a directory"),
			);
		});

		it("does not use git clone for local updates", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});

		it("checks agent compatibility before nuking", async () => {
			setupLocalBase();

			const callOrder: string[] = [];
			mockReadConfig.mockImplementation(async () => {
				callOrder.push("readConfig");
				return { agents: ["claude"] };
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});

			await runUpdate(LOCAL_KEY);

			expect(callOrder.indexOf("readConfig")).toBeLessThan(
				callOrder.indexOf("nuke"),
			);
		});

		it("preserves existing files when all agents are dropped", async () => {
			const entry: ManifestEntry = {
				...LOCAL_ENTRY,
				agents: ["codex"],
				files: [".agents/skills/my-plugin/"],
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: entry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			// New config only supports claude, entry has codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			await runUpdate(LOCAL_KEY);

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining(
					"no longer supports any of your installed agents",
				),
			);
		});

		it("uses effective agents for partial drop", async () => {
			const entry: ManifestEntry = {
				...LOCAL_ENTRY,
				agents: ["claude", "codex"],
				files: [".claude/skills/my-plugin/", ".agents/skills/my-plugin/"],
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: entry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			// New version drops codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(LOCAL_KEY);

			// Should only install for claude
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					agents: [expect.objectContaining({ id: "claude" })],
				}),
			);
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});

		it("ignores new agents added by plugin author for local update", async () => {
			const entry: ManifestEntry = {
				...LOCAL_ENTRY,
				agents: ["claude"],
				files: [".claude/skills/my-plugin/"],
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: entry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			// New version adds codex, but entry only has claude
			mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(LOCAL_KEY);

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					agents: [expect.objectContaining({ id: "claude" })],
				}),
			);
			expect(mockLog.warn).not.toHaveBeenCalled();
		});

		it("includes dropped agent info in local summary", async () => {
			const entry: ManifestEntry = {
				...LOCAL_ENTRY,
				agents: ["claude", "codex"],
				files: [".claude/skills/my-plugin/", ".agents/skills/my-plugin/"],
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: entry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(LOCAL_KEY);

			const summaryCall = mockOutro.mock.calls[0]![0] as string;
			expect(summaryCall).toContain("codex support removed");
		});

		it("nukes then copies for local re-copy", async () => {
			setupLocalBase();

			const callOrder: string[] = [];
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-plugin/"] };
			});

			await runUpdate(LOCAL_KEY);

			expect(callOrder).toEqual(["nuke", "copy"]);
		});

		it("updates manifest with null ref and commit", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY);

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ [LOCAL_KEY]: LOCAL_ENTRY },
				LOCAL_KEY,
				expect.objectContaining({
					ref: null,
					commit: null,
					agents: ["claude"],
					files: [".claude/skills/my-plugin/"],
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("shows Refreshed summary", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY);

			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("Refreshed"),
			);
		});

		it("does not create a temp dir for local updates", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});

		it("proceeds when config is null (no agntc.json = no agent restriction)", async () => {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue(null);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(LOCAL_KEY);

			// Recorded skill whose SKILL.md is still present replays via copyBareSkill;
			// null config imposes no agent restriction, so the recorded agents are kept.
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
			expect(mockLog.error).not.toHaveBeenCalled();
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("Refreshed"),
			);
		});

		it("uses copyPluginAssets when recorded type is plugin", async () => {
			const pluginEntry: ManifestEntry = { ...LOCAL_ENTRY, type: "plugin" };
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: pluginEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			// Recorded plugin: derive-before-delete scans for present asset dirs.
			// skills/ and agents/ remain, hooks/ does not.
			mockAccess.mockImplementation(async (path) => {
				if (String(path).endsWith("/hooks")) {
					throw new Error("ENOENT");
				}
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				assetCountsByAgent: { claude: { skills: 1, agents: 1 } },
			});

			await runUpdate(LOCAL_KEY);

			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: LOCAL_KEY,
					assetDirs: ["skills", "agents"],
					projectDir: "/fake/project",
				}),
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});
	});

	describe("collection plugin key", () => {
		it("resolves collection key and clones from owner/repo", async () => {
			const entry = makeEntry({
				type: "skill",
				agents: ["claude"],
				files: [".claude/skills/go/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo/go": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// readConfig for the subdir go/
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			await runUpdate("owner/repo/go");

			// Clone uses owner/repo (first two segments)
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "owner",
					repo: "repo",
				}),
			);
			// readConfig and the recorded-skill validation gate use the subdir
			expect(mockReadConfig).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go",
				expect.anything(),
			);
			expect(mockAccess).toHaveBeenCalledWith("/tmp/agntc-clone/go/SKILL.md");
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
		});
	});

	describe("dropped agent summary includes 'by plugin author'", () => {
		it("git update summary says 'support removed by plugin author'", async () => {
			const entry = makeEntry({
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			const summaryCall = mockOutro.mock.calls[0]![0] as string;
			expect(summaryCall).toContain("codex support removed by plugin author.");
		});

		it("local update summary says 'support removed by plugin author'", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const entry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude", "codex"],
				files: [".claude/skills/my-plugin/", ".agents/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: entry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(LOCAL_KEY);

			const summaryCall = mockOutro.mock.calls[0]![0] as string;
			expect(summaryCall).toContain("codex support removed by plugin author.");
		});
	});

	describe("all-plugins mode dropped agent info in summary", () => {
		it("git update summary includes dropped agent info", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			const successCalls = mockLog.success.mock.calls.map(
				(c) => c[0] as string,
			);
			const updatedSummary = successCalls.find((msg) =>
				msg.includes("owner/repo"),
			);
			expect(updatedSummary).toBeDefined();
			expect(updatedSummary).toContain(
				"codex support removed by plugin author",
			);
		});

		it("local update summary includes dropped agent info in all-plugins mode", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude", "codex"],
				files: [".claude/skills/my-plugin/", ".agents/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate();

			const successCalls = mockLog.success.mock.calls.map(
				(c) => c[0] as string,
			);
			const refreshedSummary = successCalls.find((msg) =>
				msg.includes(LOCAL_KEY),
			);
			expect(refreshedSummary).toBeDefined();
			expect(refreshedSummary).toContain(
				"codex support removed by plugin author",
			);
		});
	});

	describe("manifest read error", () => {
		it("exits 1 on manifest read failure", async () => {
			mockReadManifestOrExit.mockRejectedValue(new ExitSignal(1));

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});
	});

	describe("collection prefix matching", () => {
		it("resolves owner/repo to multiple collection keys and updates each", async () => {
			const goEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/go/"],
			});
			const tsEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/ts/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/go": goEntry,
				"owner/repo/ts": tsEntry,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);

			// Return distinct copiedFiles per key so we can verify both entries
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/go/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/ts/"] });

			await runUpdate("owner/repo");

			expect(mockCheckForUpdate).toHaveBeenCalledTimes(2);
			expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo/go", goEntry);
			expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo/ts", tsEntry);

			// Manifest should be written once with BOTH updated entries
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo/go"]).toEqual(
				expect.objectContaining({
					commit: REMOTE_SHA,
					agents: ["claude"],
					files: [".claude/skills/go/"],
				}),
			);
			expect(writtenManifest["owner/repo/ts"]).toEqual(
				expect.objectContaining({
					commit: REMOTE_SHA,
					agents: ["claude"],
					files: [".claude/skills/ts/"],
				}),
			);
		});

		it("resolves owner/repo/plugin-name to exact match", async () => {
			const goEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/go/"],
			});
			const tsEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/ts/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/go": goEntry,
				"owner/repo/ts": tsEntry,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			await runUpdate("owner/repo/go");

			expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
			expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo/go", goEntry);
		});

		it("shows error for nonexistent prefix", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"other/plugin": makeEntry(),
			});

			const err = await runUpdate("nonexistent/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				"Plugin nonexistent/repo is not installed.",
			);
		});

		it("prefers exact match when key exists as both standalone and collection prefix", async () => {
			const standaloneEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/standalone/"],
			});
			const collectionEntry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/sub-plugin/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": standaloneEntry,
				"owner/repo/sub-plugin": collectionEntry,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/standalone/"],
			});

			await runUpdate("owner/repo");

			// Should only update the exact match, not the collection entry
			expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
			expect(mockCheckForUpdate).toHaveBeenCalledWith(
				"owner/repo",
				standaloneEntry,
			);
		});
	});

	describe("copy-failed — single-update git path", () => {
		it("throws ExitSignal and removes manifest entry on copy failure", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			const manifest = { "owner/repo": entry };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});

		it("logs recovery hint on copy failure", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			const manifest = { "owner/repo": entry };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await runUpdate("owner/repo").catch(() => {});

			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining("npx agntc update owner/repo"),
			);
		});
	});

	describe("copy-failed — single-update local path", () => {
		const LOCAL_KEY = "/Users/lee/Code/my-plugin";
		const LOCAL_ENTRY: ManifestEntry = {
			ref: null,
			commit: null,
			installedAt: "2026-02-01T00:00:00.000Z",
			agents: ["claude"],
			files: [".claude/skills/my-plugin/"],
			cloneUrl: null,
		};

		it("throws ExitSignal and removes manifest entry on local copy failure", async () => {
			const manifest = { [LOCAL_KEY]: LOCAL_ENTRY };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate(LOCAL_KEY).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ [LOCAL_KEY]: expect.anything() }),
			);
		});

		it("logs recovery hint on local copy failure", async () => {
			const manifest = { [LOCAL_KEY]: LOCAL_ENTRY };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await runUpdate(LOCAL_KEY).catch(() => {});

			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining(`npx agntc update ${LOCAL_KEY}`),
			);
		});
	});

	describe("constrained-update-available — single plugin", () => {
		it("triggers nuke-and-reinstall at the new tag", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
		});

		it("passes new tag as newRef and new commit as newCommit to cloneAndReinstall", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// cloneSource should be called with the new tag as ref
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: "v1.3.0",
				}),
			);
		});

		it("updates ref and commit in manifest to new resolved tag values", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ "owner/repo": entry },
				"owner/repo",
				expect.objectContaining({
					ref: "v1.3.0",
					commit: REMOTE_SHA,
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("preserves constraint value in manifest after update", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ "owner/repo": entry },
				"owner/repo",
				expect.objectContaining({
					constraint: "^1.0",
				}),
			);
		});

		it("shows update summary with old and new commit", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining(INSTALLED_SHA.slice(0, 7)),
			);
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining(REMOTE_SHA.slice(0, 7)),
			);
		});

		it("never downgrades — reports up-to-date when current ref is higher than resolved tag", async () => {
			const entry = makeEntry({
				ref: "v1.5.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.4.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockOutro).toHaveBeenCalledWith(
				"owner/repo is already up to date.",
			);
		});
	});

	describe("constrained-up-to-date — single plugin", () => {
		it("reports plugin is up to date", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				"owner/repo is already up to date.",
			);
		});

		it("does not clone, nuke, or write manifest", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate("owner/repo");

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("returns null (no manifest changes)", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await expect(runUpdate("owner/repo")).resolves.toBeUndefined();
		});
	});

	describe("constrained-no-match — single plugin", () => {
		it("reports error when no tags satisfy constraint", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining("owner/repo"),
			);
			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining("constraint"),
			);
		});

		it("does not clone, nuke, or write manifest", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			await runUpdate("owner/repo").catch(() => {});

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("leaves plugin untouched — no addEntry call", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			await runUpdate("owner/repo").catch(() => {});

			expect(mockAddEntry).not.toHaveBeenCalled();
		});
	});

	describe("constrained statuses — all-plugins mode", () => {
		it("processes constrained-update-available plugins via nuke-and-reinstall with resolved tag", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: "v1.3.0",
				}),
			);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("adds constrained-up-to-date plugins to up-to-date list", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.3.0",
					commit: INSTALLED_SHA,
					constraint: "^1.0",
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate();

			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("up to date"),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("adds constrained-no-match plugins to failed/error list in summary", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			await runUpdate();

			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			const hasNoMatchError = warnCalls.some(
				(msg) => msg.includes("owner/repo") && msg.includes("constraint"),
			);
			expect(hasNoMatchError).toBe(true);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("handles batch with all constrained plugins — mixed constrained statuses", async () => {
			const entryA = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				ref: "v2.1.0",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			const entryC = makeEntry({
				ref: "v3.0.0",
				commit: INSTALLED_SHA,
				constraint: "^4.0",
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
				"owner/repo-c": entryC,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "constrained-update-available",
							tag: "v1.3.0",
							commit: REMOTE_SHA,
							latestOverall: "v2.0.0",
						} as UpdateCheckResult;
					if (key === "owner/repo-b")
						return {
							status: "constrained-up-to-date",
							latestOverall: "v3.1.0",
						} as UpdateCheckResult;
					return {
						status: "constrained-no-match",
					} as UpdateCheckResult;
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate();

			// A should be updated (constrained-update-available)
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockWriteManifest).toHaveBeenCalled();
			// Summary should contain info for all three
			const allMessages = [
				...mockLog.success.mock.calls.map((c) => c[0] as string),
				...mockLog.message.mock.calls.map((c) => c[0] as string),
				...mockLog.warn.mock.calls.map((c) => c[0] as string),
			];
			const hasRepoA = allMessages.some((msg) => msg.includes("owner/repo-a"));
			const hasRepoB = allMessages.some((msg) => msg.includes("owner/repo-b"));
			const hasRepoC = allMessages.some((msg) => msg.includes("owner/repo-c"));
			expect(hasRepoA).toBe(true);
			expect(hasRepoB).toBe(true);
			expect(hasRepoC).toBe(true);
		});

		it("handles mix of constrained + branch-tracking + tag-pinned + local plugins", async () => {
			const constrainedEntry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/constrained-skill/"],
			});
			const branchEntry = makeEntry({
				ref: null,
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/branch-skill/"],
			});
			const tagEntry = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/tagged-skill/"],
			});
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/local-skill/"],
				cloneUrl: null,
			};

			mockReadManifestOrExit.mockResolvedValue({
				"owner/constrained": constrainedEntry,
				"owner/branch": branchEntry,
				"owner/tagged": tagEntry,
				"/local/path": localEntry,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/constrained")
						return {
							status: "constrained-update-available",
							tag: "v1.3.0",
							commit: REMOTE_SHA,
							latestOverall: null,
						} as UpdateCheckResult;
					if (key === "owner/branch")
						return {
							status: "update-available",
							remoteCommit: REMOTE_SHA,
						} as UpdateCheckResult;
					if (key === "owner/tagged")
						return {
							status: "newer-tags",
							tags: ["v2.0"],
						} as UpdateCheckResult;
					return { status: "local" } as UpdateCheckResult;
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/some-skill/"],
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);

			await runUpdate();

			// Constrained and branch should be processed (clone called)
			// Local should be processed (stat called)
			// Tagged should NOT be processed (newer-tags is info only)
			// Per-group persistence (task 1-6): constrained, branch, and local each
			// persist as their own unit → three writes (tagged never mutates).
			expect(mockWriteManifest).toHaveBeenCalledTimes(3);
			// All four should appear in the summary
			const allMessages = [
				...mockLog.success.mock.calls.map((c) => c[0] as string),
				...mockLog.message.mock.calls.map((c) => c[0] as string),
				...mockLog.info.mock.calls.map((c) => c[0] as string),
			];
			const hasConstrained = allMessages.some((msg) =>
				msg.includes("owner/constrained"),
			);
			const hasBranch = allMessages.some((msg) => msg.includes("owner/branch"));
			const hasTagged = allMessages.some((msg) => msg.includes("owner/tagged"));
			const hasLocal = allMessages.some((msg) => msg.includes("/local/path"));
			expect(hasConstrained).toBe(true);
			expect(hasBranch).toBe(true);
			expect(hasTagged).toBe(true);
			expect(hasLocal).toBe(true);
		});

		it("batch with no constrained plugins behaves identically to pre-feature", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "update-available",
							remoteCommit: REMOTE_SHA,
						};
					return { status: "newer-tags", tags: ["v2.0"] };
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate();

			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			const allMessages = [
				...mockLog.success.mock.calls.map((c) => c[0] as string),
				...mockLog.info.mock.calls.map((c) => c[0] as string),
			];
			const hasRepoA = allMessages.some((msg) => msg.includes("owner/repo-a"));
			const hasRepoB = allMessages.some((msg) => msg.includes("owner/repo-b"));
			expect(hasRepoA).toBe(true);
			expect(hasRepoB).toBe(true);
		});

		it("collects out-of-constraint info from constrained-update-available results", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			// The out-of-constraint info should be collected for rendering.
			// Since vc-3-5 handles rendering, we verify the function returns
			// successfully and the plugin is updated. The actual out-of-constraint
			// data structure is stored internally for vc-3-5 to consume.
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("collects out-of-constraint info from constrained-up-to-date results", async () => {
			const entryA = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			const entryB = makeEntry({
				ref: "v2.1.0",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "constrained-up-to-date",
							latestOverall: "v2.0.0",
						} as UpdateCheckResult;
					return {
						status: "constrained-up-to-date",
						latestOverall: null,
					} as UpdateCheckResult;
				},
			);

			await runUpdate();

			// All up-to-date, so the "all up to date" message should appear
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("up to date"),
			);
		});

		it("never downgrades constrained plugins in batch mode", async () => {
			const entry = makeEntry({
				ref: "v1.5.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.4.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});

			await runUpdate();

			// Should not clone (no downgrade)
			expect(mockCloneSource).not.toHaveBeenCalled();
			// Should be reported as up-to-date
			const allMessages = [
				...mockLog.message.mock.calls.map((c) => c[0] as string),
			];
			const hasUpToDate = allMessages.some(
				(msg) => msg.includes("owner/repo") && msg.includes("Up to date"),
			);
			expect(hasUpToDate).toBe(true);
		});

		it("constrained-update-available with all constrained-up-to-date does not show all-up-to-date message", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			// Should NOT show "All plugins are up to date" — there was an update
			expect(mockOutro).not.toHaveBeenCalledWith("All plugins are up to date.");
		});
	});

	describe("copy-failed — all-updates mode", () => {
		it("removes entry from batch manifest for git copy failure", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});

			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return { status: "update-available", remoteCommit: REMOTE_SHA };
					return { status: "update-available", remoteCommit: REMOTE_SHA };
				},
			);

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);

			// First plugin copy fails, second succeeds
			mockCopyBareSkill
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/skill-b/"],
				});

			// Copy failure makes the run exit non-zero, but the successful sibling
			// is still written first. Catch so the manifest assertions below run.
			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Per-group persistence (task 1-6): repo-a's group (copy-failed → remove)
			// and repo-b's group (updated → add) each write once → two writes.
			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			const writtenManifest = mockWriteManifest.mock.calls.at(
				-1,
			)![1] as Manifest;
			// copy-failed entry should be removed
			expect(writtenManifest["owner/repo-a"]).toBeUndefined();
			// successful entry should be present
			expect(writtenManifest["owner/repo-b"]).toBeDefined();
		});

		it("logs recovery hint in summary for copy-failed plugin", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			// Copy failure exits non-zero after the summary is rendered; catch so
			// the recovery-hint assertion below still runs.
			await runUpdate().catch(() => {});

			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			const hasRecoveryHint = errorCalls.some((msg) =>
				msg.includes("npx agntc update owner/repo"),
			);
			expect(hasRecoveryHint).toBe(true);
		});

		it("removes entry from batch manifest for local copy failure", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			// Copy failure exits non-zero after the manifest write; catch so the
			// removal assertion below still runs.
			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest[LOCAL_KEY]).toBeUndefined();
		});
	});

	describe("out-of-constraint info section", () => {
		it("renders info section in batch mode when constrained plugin has out-of-constraint version", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasHeader = infoCalls.some((msg) =>
				msg.includes("Newer versions outside constraints"),
			);
			const hasLine = infoCalls.some(
				(msg) =>
					msg.includes("owner/repo") &&
					msg.includes("v2.0.0") &&
					msg.includes("^1.0"),
			);
			expect(hasHeader).toBe(true);
			expect(hasLine).toBe(true);
		});

		it("omits info section in batch mode when no out-of-constraint versions exist", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasHeader = infoCalls.some((msg) =>
				msg.includes("Newer versions outside constraints"),
			);
			expect(hasHeader).toBe(false);
		});

		it("renders info section for multiple plugins in batch mode", async () => {
			const entryA = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				ref: "v2.1.0",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
				agents: ["claude"],
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "constrained-up-to-date",
							latestOverall: "v2.0.0",
						} as UpdateCheckResult;
					return {
						status: "constrained-up-to-date",
						latestOverall: "v3.1.0",
					} as UpdateCheckResult;
				},
			);

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasRepoA = infoCalls.some(
				(msg) => msg.includes("owner/repo-a") && msg.includes("v2.0.0"),
			);
			const hasRepoB = infoCalls.some(
				(msg) => msg.includes("owner/repo-b") && msg.includes("v3.1.0"),
			);
			expect(hasRepoA).toBe(true);
			expect(hasRepoB).toBe(true);
		});

		it("renders info section in single-plugin mode when constrained plugin has out-of-constraint version", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasHeader = infoCalls.some((msg) =>
				msg.includes("Newer versions outside constraints"),
			);
			const hasLine = infoCalls.some(
				(msg) =>
					msg.includes("owner/repo") &&
					msg.includes("v2.0.0") &&
					msg.includes("^1.0"),
			);
			expect(hasHeader).toBe(true);
			expect(hasLine).toBe(true);
		});

		it("omits info section in single-plugin mode when no out-of-constraint version", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasHeader = infoCalls.some((msg) =>
				msg.includes("Newer versions outside constraints"),
			);
			expect(hasHeader).toBe(false);
		});

		it("renders info section in single-plugin mode for constrained-up-to-date with out-of-constraint version", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: "v2.0.0",
			});

			await runUpdate("owner/repo");

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasHeader = infoCalls.some((msg) =>
				msg.includes("Newer versions outside constraints"),
			);
			const hasLine = infoCalls.some(
				(msg) =>
					msg.includes("owner/repo") &&
					msg.includes("v2.0.0") &&
					msg.includes("^1.0"),
			);
			expect(hasHeader).toBe(true);
			expect(hasLine).toBe(true);
		});

		it("does not render info line when within-constraint best equals absolute latest", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate("owner/repo");

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasHeader = infoCalls.some((msg) =>
				msg.includes("Newer versions outside constraints"),
			);
			expect(hasHeader).toBe(false);
		});
	});
});

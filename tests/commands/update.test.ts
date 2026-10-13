import type { Stats } from "node:fs";
import { basename } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { UpdateCheckResult } from "../../src/update-check.js";
import type { PluginOutcome } from "../../src/update-groups.js";

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack({ confirm: vi.fn(), isCancel: vi.fn(() => false) });
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

vi.mock("../../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../../src/copy-pack.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/copy-pack.js")>()),
	copyPack: vi.fn(),
}));

vi.mock("../../src/unmanaged-check.js", () => ({
	checkUnmanagedConflicts: vi.fn(),
}));

vi.mock("../../src/discover.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/discover.js")>()),
	discover: vi.fn(),
}));

vi.mock("../../src/copy-bare-skill.js", () => ({
	copyBareSkill: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	stat: vi.fn(),
	access: vi.fn(),
	readdir: vi.fn(async () => []),
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
import {
	failureMemberLine,
	runUpdate,
	streamGroupMemberLines,
	updateCommand,
} from "../../src/commands/update.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPack } from "../../src/copy-pack.js";
import {
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../../src/copy-safety.js";
import {
	type Discovery,
	discover,
	type FoundPack,
	PackConflictError,
} from "../../src/discover.js";
import { cleanupTempDir, cloneSource } from "../../src/git-clone.js";
import {
	addEntry,
	readManifest,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { checkUnmanagedConflicts } from "../../src/unmanaged-check.js";
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
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPack = vi.mocked(copyPack);
const mockDiscover = vi.mocked(discover);
const mockCheckUnmanaged = vi.mocked(checkUnmanagedConflicts);

const LARAVEL_PACK: FoundPack = {
	name: "repo",
	path: "",
	skills: [{ name: "new-skill", path: "skills/new-skill" }],
	assetDirs: ["agents"],
};

function onlyPack(pack: FoundPack): Discovery {
	return { packs: [pack], skills: [], strays: [] };
}

/**
 * Arranges the re-walk a skill falls back to when its recorded path no longer
 * holds one: it finds a loose skill at each path, named for its folder.
 */
function rewalkFinds(...paths: string[]): void {
	mockDiscover.mockResolvedValue({
		packs: [],
		skills: paths.map((path) => ({ name: basename(path), path })),
		strays: [],
	});
}
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockStat = vi.mocked(stat);
const mockAccess = vi.mocked(access);
const mockOutro = vi.mocked(p.outro);
const mockLog = vi.mocked(p.log);
const mockCancel = vi.mocked(p.cancel);
const mockConfirm = vi.mocked(p.confirm);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);

import { globalScope } from "../../src/scope.js";
import { interactiveUi } from "../../src/ui.js";
import { makeEntry } from "../helpers/factories.js";
import { clackCalls, runMachine } from "../helpers/machine.js";

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);
const HOME = "/home/lee";
const GLOBAL = globalScope(HOME);

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
	// Default: the recorded structural unit still exists in the re-clone, so the
	// derive-before-delete gate passes (pathExists -> access resolves).
	mockAccess.mockResolvedValue(undefined);
	// Default: no escaping symlink in the re-clone (copy-safety scan passes).
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
	mockCheckUnmanaged.mockResolvedValue([]);
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

/**
 * Installs a STABLE spinner handle shared across every `p.spinner()` call in a
 * test (the leading check spinner AND each streamed group-of-one spinner), so the
 * collapsed group-of-one stop-frames can be asserted directly. A group-of-one now
 * streams its single outcome as `spin.stop(text, code)` (code 2 = loud error ✗,
 * code 0 = success/benign ◇) — NOT a separate `p.log.*` line.
 */
function captureSpinner() {
	const handle = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
	vi.mocked(p.spinner).mockReturnValue(
		handle as unknown as ReturnType<typeof p.spinner>,
	);
	return handle;
}

type CapturedSpinner = ReturnType<typeof captureSpinner>;

/**
 * The collapsed group-of-one lines a run streamed as spinner stop-frames — every
 * two-arg `spin.stop(text, code)` call, optionally filtered to one `code`
 * (2 = error, 0 = success/benign). Excludes the leading check spinner's single-arg
 * `stop("Update checks complete.")` and the >=2-member header stop (both one arg).
 */
function stopTexts(handle: CapturedSpinner, code?: 0 | 2): string[] {
	return handle.stop.mock.calls
		.filter((c) => c.length >= 2 && (code === undefined || c[1] === code))
		.map((c) => c[0] as string);
}

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

			expect(mockOutro).toHaveBeenCalledWith("No skills or packs installed.");
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

		it("shows all up-to-date message when every entry is current", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry(),
				"owner/repo-b": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate();

			expect(mockOutro).toHaveBeenCalledWith("Everything is up to date.");
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("processes update-available plugins via git update", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
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
				}),
			);
		});

		it("processes local plugins via re-copy", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
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
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
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
				files: [".claude/skills/git-skill/"],
			});
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/local-skill/"],
				cloneUrl: null,
			};
			const tagEntry = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				files: [".claude/skills/tagged-skill/"],
			});
			const upToDateEntry = makeEntry({
				commit: INSTALLED_SHA,
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
			const handle = captureSpinner();
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate();

			// Should have per-plugin info in the output — the updated repo-a now
			// streams as its group-of-one spinner stop-frame, repo-b (up-to-date)
			// via the trailing p.log summary.
			const allMessages = [
				...mockLog.info.mock.calls.map((c) => c[0]),
				...mockLog.message.mock.calls.map((c) => c[0]),
				...mockLog.success.mock.calls.map((c) => c[0]),
				...stopTexts(handle),
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
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
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
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: INSTALLED_SHA,
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
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
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
				files: [".claude/skills/a/"],
			});
			const memberB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/b/"],
			});
			const standalone = makeEntry({
				commit: INSTALLED_SHA,
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

		it("aborted / blocked / up-to-date members leave the manifest entry intact (no add/remove)", async () => {
			// Three standalone repos, each a group-of-one, hitting a non-mutating
			// category: aborted (derive gate), blocked (symlink escape), and
			// up-to-date (never actioned). None add or remove — so no group writes
			// the manifest at all.
			const aborted = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/abort/"],
			});
			const blocked = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/block/"],
			});
			const upToDate = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/current/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/abort": aborted,
				"owner/block": blocked,
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
				});
			// abort clone: recorded SKILL.md gone and two skills now carry its name →
			// aborted (others present).
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-abort")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/abort", "y/abort");
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
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
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
			const handle = captureSpinner();
			const cf = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/cf/"],
			});
			const ab = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/ab/"],
			});
			const bl = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
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
			// ab clone: SKILL.md gone and two skills now carry its name →
			// aborted (cf's present so it reaches copy).
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-ab")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/ab", "y/ab");
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
			// Each is a group-of-one, so its loud line is the spinner stop-frame at
			// code 2 (error ✗).
			const errorCalls = stopTexts(handle, 2);
			expect(errorCalls.some((m) => m.includes("owner/cf"))).toBe(true);
			expect(
				errorCalls.some((m) =>
					m.includes("owner/ab was installed as a skill and can't be updated"),
				),
			).toBe(true);
			expect(errorCalls.some((m) => m.includes("owner/bl"))).toBe(true);
			expect(mockRemoveEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/cf",
			);
		});
	});

	describe("streamed actioned phase (task 2-4)", () => {
		const A_SUMMARY = "owner/repo-a: Updated aaaaaaa -> bbbbbbb";
		const B_SUMMARY = "owner/repo-b: Updated aaaaaaa -> bbbbbbb";
		const LOCAL_SUMMARY = "/local/path: Refreshed from local path";

		function gitEntry(name: string): ManifestEntry {
			return makeEntry({
				commit: INSTALLED_SHA,
				files: [`.claude/skills/${name}/`],
			});
		}

		function localPluginEntry(): ManifestEntry {
			return {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/local/"],
				cloneUrl: null,
			};
		}

		it("streams updatable groups and local entries in manifest order", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": gitEntry("a"),
				"/local/path": localPluginEntry(),
				"owner/repo-b": gitEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			// Each git group streams under its own Updating spinner (the local never does).
			expect(handle.start).toHaveBeenCalledWith("Updating owner/repo-a");
			expect(handle.start).toHaveBeenCalledWith("Updating owner/repo-b");
			// Streamed outcome lines appear in manifest (processing) order: git A
			// (its group-of-one spinner stop-frame), then the interleaved local
			// (p.log.success, no spinner), then git B (its stop-frame).
			expect(stopTexts(handle, 0)).toEqual([A_SUMMARY, B_SUMMARY]);
			expect(mockLog.success.mock.calls.map((c) => c[0])).toEqual([
				LOCAL_SUMMARY,
			]);
			const stopOrder = (text: string) =>
				handle.stop.mock.invocationCallOrder[
					handle.stop.mock.calls.findIndex((c) => c[0] === text)
				]!;
			const localOrder = mockLog.success.mock.invocationCallOrder[0]!;
			expect(stopOrder(A_SUMMARY)).toBeLessThan(localOrder);
			expect(localOrder).toBeLessThan(stopOrder(B_SUMMARY));
		});

		it("collapses a standalone updatable group to one Updated line", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": gitEntry("a"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			// Animation is KEPT: the group-of-one still opens an Updating spinner...
			expect(handle.start).toHaveBeenCalledWith("Updating owner/repo");
			// ...whose settled stop-frame IS the single collapsed Updated line (code 0
			// = success). No separate p.log line beneath a header.
			expect(handle.stop).toHaveBeenCalledWith(
				"owner/repo: Updated aaaaaaa -> bbbbbbb",
				0,
			);
			expect(mockLog.success).not.toHaveBeenCalled();
			// Neither the start nor the stop carries a `(1 members)` header line.
			const messages = [
				...handle.start.mock.calls.map((c) => c[0] as string),
				...handle.stop.mock.calls.map((c) => c[0] as string),
			];
			for (const m of messages) {
				expect(m).not.toContain("(1 members)");
			}
		});

		it("collapses a single updated collection member to one line keeping the /member suffix", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: REMOTE_SHA,
					files: [".claude/skills/b/"],
				}),
			});
			// One group (same repo + HEAD intent); the shared target advances a but
			// leaves b already-current — a genuine-state split, so only a updates.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});

			await runUpdate();

			// Collapsed to the spinner stop-frame carrying the FULL member key (the /a
			// suffix distinguishes it from a true standalone), code 0, no separate line.
			expect(handle.stop).toHaveBeenCalledWith(
				"owner/repo/a: Updated aaaaaaa -> bbbbbbb",
				0,
			);
			expect(mockLog.success).not.toHaveBeenCalled();
			// The spinner still starts on the bare repo label (no member suffix, no count).
			expect(handle.start).toHaveBeenCalledWith("Updating owner/repo");
		});

		it("collapses a standalone whose single member copy-fails to one error stop-frame (code 2)", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": gitEntry("a"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			// The re-copy throws after the old files are nuked → copy-failed.
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			// copy-failed trips the non-zero exit; catch so assertions run.
			await runUpdate().catch(() => {});

			// The single failure IS the spinner stop-frame at code 2 (error), carrying
			// the copy-failed member line — no separate p.log.error beneath a header.
			expect(handle.stop).toHaveBeenCalledWith(
				"owner/repo: copy failed — Update failed for owner/repo after removing old files. It is currently uninstalled. Run `npx agntc add owner/repo` to install it again.",
				2,
			);
			expect(mockLog.error).not.toHaveBeenCalled();
			expect(handle.start).toHaveBeenCalledWith("Updating owner/repo");
		});

		it("emits header + one member line per attempted member for a >=2-member group (mixed success/failure in one block)", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
				"owner/repo/c": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/c/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			// c's recorded SKILL.md is gone and two skills now carry its name → aborted.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.endsWith("/c/SKILL.md")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/c", "y/c");
			// b's re-copy throws → copy-failed; a succeeds; c never reaches copy.
			mockCopyBareSkill.mockImplementation(
				async (opts: { sourceDir: string }) => {
					if (opts.sourceDir.endsWith("/b")) {
						throw new Error("disk full");
					}
					return { copiedFiles: [".claude/skills/updated/"] };
				},
			);

			// copy-failed trips the non-zero exit; catch so assertions run.
			await runUpdate().catch(() => {});

			// One header carrying the attempted count.
			expect(handle.start).toHaveBeenCalledWith(
				"Updating owner/repo  aaaaaaa -> bbbbbbb  (3 members)",
			);
			// One member line each, all under the one header, at the matching level.
			expect(mockLog.success).toHaveBeenCalledWith("a");
			expect(mockLog.error).toHaveBeenCalledWith(
				"b: copy failed — Update failed for owner/repo/b after removing old files. It is currently uninstalled. Run `npx agntc add owner/repo/b` to install it again.",
			);
			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringMatching(/^c: owner\/repo\/c was installed as a skill/),
			);
		});

		it("emits a local entry Refreshed line with no spinner and no clone, interleaved at its manifest position", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"/local/path": localPluginEntry(),
				"owner/repo-a": gitEntry("a"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			// Local streams first (manifest index 0) via p.log.success; the git group
			// follows as its group-of-one spinner stop-frame.
			expect(mockLog.success.mock.calls.map((c) => c[0])).toEqual([
				LOCAL_SUMMARY,
			]);
			expect(stopTexts(handle, 0)).toEqual([
				"owner/repo-a: Updated aaaaaaa -> bbbbbbb",
			]);
			const aStopOrder =
				handle.stop.mock.invocationCallOrder[
					handle.stop.mock.calls.findIndex(
						(c) => c[0] === "owner/repo-a: Updated aaaaaaa -> bbbbbbb",
					)
				]!;
			expect(mockLog.success.mock.invocationCallOrder[0]!).toBeLessThan(
				aStopOrder,
			);
			// The local never clones and never opens an Updating spinner; only the git
			// group does.
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			const starts = handle.start.mock.calls.map((c) => c[0] as string);
			expect(starts.some((m) => m.includes("/local/path"))).toBe(false);
			expect(handle.start).toHaveBeenCalledWith("Updating owner/repo-a");
		});

		it("writes the group manifest before emitting that group ✓ (persistence before stream)", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": gitEntry("a"),
				"owner/repo-b": gitEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			// Two distinct repos → two groups-of-one; each ✓ is now that group's
			// spinner stop-frame (the collapsed Updated line), not a p.log line.
			const writeOrders = mockWriteManifest.mock.invocationCallOrder;
			const stopCalls = handle.stop.mock.calls;
			const stopOrder = (text: string) =>
				handle.stop.mock.invocationCallOrder[
					stopCalls.findIndex((c) => c[0] === text)
				]!;
			const stopA = stopOrder("owner/repo-a: Updated aaaaaaa -> bbbbbbb");
			const stopB = stopOrder("owner/repo-b: Updated aaaaaaa -> bbbbbbb");
			// Group A's manifest write precedes its own stop-frame (persist before show)...
			expect(writeOrders[0]).toBeLessThan(stopA);
			// ...and A's stop-frame streams before group B's write even starts (per-group
			// streaming, not a single batched end-of-run render).
			expect(stopA).toBeLessThan(writeOrders[1]!);
			expect(stopA).toBeLessThan(stopB);
		});

		it("does not tick the spinner per member during reinstall", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
				"owner/repo/c": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/c/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			// One group spinner on the header (plus the leading check spinner) — never
			// a per-member message tick across the three reinstalls.
			expect(handle.start).toHaveBeenCalledWith(
				expect.stringContaining("Updating owner/repo"),
			);
			expect(handle.message).not.toHaveBeenCalled();
		});

		it("starts no Updating spinner for a group whose members are all non-updatable", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/updatable": gitEntry("u"),
				"owner/pinned": makeEntry({ ref: "v1.0", commit: INSTALLED_SHA }),
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				return key === "owner/updatable"
					? { kind: "head", resolvedSha: REMOTE_SHA }
					: { kind: "tag", tag: "v1.0", newerTags: ["v2.0"] };
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			const starts = handle.start.mock.calls.map((c) => c[0] as string);
			// The updatable group streams under a spinner...
			expect(starts.some((m) => m.includes("Updating owner/updatable"))).toBe(
				true,
			);
			// ...but the pinned (newer-tags) group never clones and never opens one.
			expect(starts.some((m) => m.includes("owner/pinned"))).toBe(false);
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
		});
	});

	describe("grouped tag-based version move (task 3-1)", () => {
		function constrainedMember(
			name: string,
			ref: string,
			commit: string,
		): ManifestEntry {
			return makeEntry({
				ref,
				commit,
				constraint: "^1.0",
				files: [`.claude/skills/${name}/`],
			});
		}

		it("grouped streaming threads old = members entry.ref and new = resolved target.tag into the header/member move", async () => {
			const handle = captureSpinner();
			// A 2-member constrained collection sharing one old tag (v1.2.3) and one
			// old commit → shared-old header renders the tag move v1.2.3 -> v1.3.0.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a", "v1.2.3", INSTALLED_SHA),
				"owner/repo/b": constrainedMember("b", "v1.2.3", INSTALLED_SHA),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			// The resolved target.tag (v1.3.0) and the shared members' entry.ref
			// (v1.2.3) render as tags in the group header — not commit hashes.
			expect(handle.start).toHaveBeenCalledWith(
				"Updating owner/repo  v1.2.3 -> v1.3.0  (2 members)",
			);
		});

		it("divergent-old constrained members each carry their own <oldTag> -> <newTag> in tags (header target-only)", async () => {
			const handle = captureSpinner();
			const SHA_A = "c".repeat(40);
			const SHA_B = "d".repeat(40);
			// Two members at DIFFERENT old tags/commits, both constrained ^1.0, both
			// advancing to v1.3.0 → divergent-old: header shows the resolved tag only,
			// each member line carries its own <oldTag> -> <newTag> move.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a", "v1.2.0", SHA_A),
				"owner/repo/b": constrainedMember("b", "v1.1.0", SHA_B),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate();

			// Divergent olds → header carries the resolved tag target only.
			expect(handle.start).toHaveBeenCalledWith(
				"Updating owner/repo -> v1.3.0  (2 members)",
			);
			// Each member threads its OWN entry.ref as oldRef against the shared
			// target.tag → its own tag move on the member line.
			expect(mockLog.success).toHaveBeenCalledWith("a  (v1.2.0 -> v1.3.0)");
			expect(mockLog.success).toHaveBeenCalledWith("b  (v1.1.0 -> v1.3.0)");
		});
	});

	// Structural guard: streamGroupMemberLines gates the per-member move on the
	// caller-supplied `divergent` flag (single source of truth in streamGroupWork),
	// NOT on any Set re-derived from item.updating's commits. Each case feeds
	// updating commits whose Set size CONTRADICTS the passed flag to prove the flag
	// alone drives member-line placement.
	describe("streamGroupMemberLines consumes the caller-supplied divergent flag", () => {
		function successOutcome(key: string): PluginOutcome {
			return {
				status: "updated",
				key,
				summary: `${key}: Updated`,
				newEntry: makeEntry(),
			};
		}

		function groupItem(memberCommits: [string, string]) {
			const updating = [
				{
					key: "owner/repo/a",
					entry: makeEntry({ ref: "v1.2.0", commit: memberCommits[0] }),
				},
				{
					key: "owner/repo/b",
					entry: makeEntry({ ref: "v1.1.0", commit: memberCommits[1] }),
				},
			];
			return {
				kind: "group" as const,
				position: 0,
				group: {
					cloneUrl: "https://github.com/owner/repo.git",
					versionIntent: "^1.0",
					constrained: true,
					members: updating,
				},
				target: { kind: "head" as const, resolvedSha: REMOTE_SHA },
				updating,
			};
		}

		it("emits a per-member move when divergent=true even though the updating commits are identical", () => {
			// Identical commits — an internal Set derivation would say shared-old.
			const item = groupItem([INSTALLED_SHA, INSTALLED_SHA]);
			const outcomes = [
				successOutcome("owner/repo/a"),
				successOutcome("owner/repo/b"),
			];

			streamGroupMemberLines(
				item,
				outcomes,
				REMOTE_SHA,
				"v1.3.0",
				true,
				interactiveUi,
			);

			// Caller says divergent → each member line carries its own tag move.
			expect(mockLog.success).toHaveBeenCalledWith("a  (v1.2.0 -> v1.3.0)");
			expect(mockLog.success).toHaveBeenCalledWith("b  (v1.1.0 -> v1.3.0)");
		});

		it("leaves member lines bare when divergent=false even though the updating commits differ", () => {
			// Distinct commits — an internal Set derivation would say divergent-old.
			const item = groupItem(["c".repeat(40), "d".repeat(40)]);
			const outcomes = [
				successOutcome("owner/repo/a"),
				successOutcome("owner/repo/b"),
			];

			streamGroupMemberLines(
				item,
				outcomes,
				REMOTE_SHA,
				"v1.3.0",
				false,
				interactiveUi,
			);

			// Caller says shared → the move stays on the header, member lines are bare.
			expect(mockLog.success).toHaveBeenCalledWith("a");
			expect(mockLog.success).toHaveBeenCalledWith("b");
		});
	});

	describe("trailing non-actioned collapse (task 2-5)", () => {
		function member(name: string, overrides: Partial<ManifestEntry> = {}) {
			return makeEntry({
				commit: INSTALLED_SHA,
				files: [`.claude/skills/${name}/`],
				...overrides,
			});
		}

		function installPipelineMocks(): void {
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});
		}

		it("collapses N up-to-date members of a group to one N up to date line", async () => {
			captureSpinner();
			const manifest: Manifest = {};
			for (let i = 1; i <= 7; i++) {
				manifest[`owner/repo/${i}`] = member(String(i));
			}
			// A separate updating standalone keeps the run out of the
			// all-up-to-date short-circuit so the collapse actually renders.
			manifest["owner/other"] = member("other");
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				// owner/repo group: target sha == installed sha → every member up-to-date.
				// owner/other group: target sha advanced → the standalone updates.
				return key.startsWith("owner/repo")
					? { kind: "head", resolvedSha: INSTALLED_SHA }
					: { kind: "head", resolvedSha: REMOTE_SHA };
			});
			installPipelineMocks();

			await runUpdate();

			const messageCalls = mockLog.message.mock.calls.map(
				(c) => c[0] as string,
			);
			// ONE collapsed count line for the 7-member group, keyed by the group.
			expect(messageCalls).toContain("owner/repo: 7 up to date");
			// Not 7 near-identical per-member up-to-date lines.
			expect(messageCalls.filter((m) => m.includes("up to date"))).toHaveLength(
				1,
			);
		});

		it("collapses newer-tags to one line per group: its loose skills on one --skill command, each pack on its own", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/zeta": member("zeta", {
					ref: "v1.0",
					sourceSubpath: "skills/zeta",
				}),
				"owner/repo/web": member("web", { ref: "v1.0", type: "pack" }),
				"owner/repo/alpha": member("alpha", { ref: "v1.0" }),
				"owner/repo/tools": member("tools", { ref: "v1.0", type: "pack" }),
			});
			// One exact-pin group; the shared tag target reports newer tags for all.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "tag",
				tag: "v1.0",
				newerTags: ["v2.0", "v3.0"],
			});

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls).toContain(
				[
					"owner/repo: Pinned to v1.0 — newer tags available (latest: v3.0). To upgrade:",
					"    npx agntc add owner/repo@v3.0 --skill alpha zeta",
					"    npx agntc add owner/repo/web@v3.0 --pack",
					"    npx agntc add owner/repo/tools@v3.0 --pack",
				].join("\n"),
			);
			// Not one near-identical newer-tags line per member.
			expect(
				infoCalls.filter((m) => m.includes("newer tags available")),
			).toHaveLength(1);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("an exact-pin member's newer-tags command re-adds that member at the newest tag, never the bare repo", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { ref: "v1.0" }),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "tag",
				tag: "v1.0",
				newerTags: ["v2.0", "v3.0"],
			});

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls).toContain(
				"owner/repo: Pinned to v1.0 — newer tags available (latest: v3.0). To upgrade: npx agntc add owner/repo/a@v3.0",
			);
			expect(infoCalls.some((m) => m.includes("add owner/repo@"))).toBe(false);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("collapses a check-failed group to one line with the shared probe reason (exit 0)", async () => {
			const REASON = "ls-remote failed: could not read from remote";
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "check-failed",
				reason: REASON,
			});

			const err = await runUpdate().catch((e) => e);

			// All-mode check-failed warns and exits 0 (excluded from hasFailedOutcome).
			expect(err).toBeUndefined();
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			// ONE collapsed line carrying the shared probe reason — no per-member enumeration.
			expect(warnCalls).toContain(`owner/repo: check failed — ${REASON}`);
			expect(warnCalls.filter((m) => m.includes("check failed"))).toHaveLength(
				1,
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("collapses a constrained-no-match group to one line with the shared constraint", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { ref: "v1.2.3", constraint: "^2.0" }),
				"owner/repo/b": member("b", { ref: "v1.2.3", constraint: "^2.0" }),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained-no-match",
			});

			await runUpdate();

			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			// ONE collapsed line carrying the shared constraint.
			expect(warnCalls).toContain(
				"owner/repo: no tags satisfy ^2.0 — left untouched",
			);
			expect(
				warnCalls.filter((m) => m.includes("no tags satisfy")),
			).toHaveLength(1);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("renders separate @intent-disambiguated trailing lines for two distinct-intent groups of one repo", async () => {
			// Same repo, two intents → two groups: a caret group (constrained-no-match)
			// and an exact-pin group (up-to-date). Each keeps its own @intent line.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { ref: "v1.2.3", constraint: "^1.2.3" }),
				"owner/repo/b": member("b", { ref: "v2.0.0" }),
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				return group.members[0]!.entry.constraint !== undefined
					? { kind: "constrained-no-match" }
					: { kind: "tag", tag: "v2.0.0", newerTags: [] };
			});

			await runUpdate();

			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			const messageCalls = mockLog.message.mock.calls.map(
				(c) => c[0] as string,
			);
			expect(warnCalls).toContain(
				"owner/repo@^1.2.3: no tags satisfy ^1.2.3 — left untouched",
			);
			expect(messageCalls).toContain("owner/repo@v2.0.0: 1 up to date");
		});

		it("reports only the up-to-date members of a split group as the trailing count (behind members streamed, not counted here)", async () => {
			const handle = captureSpinner();
			// One HEAD group: member a is behind (streams an update), members b and c
			// are already at the resolved target (up-to-date, collapse trailing).
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { commit: INSTALLED_SHA }),
				"owner/repo/b": member("b", { commit: REMOTE_SHA }),
				"owner/repo/c": member("c", { commit: REMOTE_SHA }),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			installPipelineMocks();

			await runUpdate();

			// The behind member streamed inline (its own updated line), NOT counted here.
			expect(stopTexts(handle, 0)).toContain(
				"owner/repo/a: Updated aaaaaaa -> bbbbbbb",
			);
			const messageCalls = mockLog.message.mock.calls.map(
				(c) => c[0] as string,
			);
			// Only the two up-to-date members appear — as the collapsed count (2, not 3).
			expect(messageCalls).toContain("owner/repo: 2 up to date");
			expect(messageCalls.filter((m) => m.includes("up to date"))).toHaveLength(
				1,
			);
			// The up-to-date members never surface as per-member lines.
			expect(messageCalls.some((m) => m.startsWith("owner/repo/b"))).toBe(
				false,
			);
			expect(messageCalls.some((m) => m.startsWith("owner/repo/c"))).toBe(
				false,
			);
		});
	});

	describe("empty manifest", () => {
		it("displays message and exits 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith("No skills or packs installed.");
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
				"owner/repo is not installed.",
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
				type: "pack",
				files: [".claude/skills/my-skill/"],
			});
			mockDiscover.mockResolvedValue(onlyPack(LARAVEL_PACK));
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/new-skill/"],
				assetCounts: { skills: 1 },
			});

			await runUpdate("owner/repo");

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyPack).toHaveBeenCalledWith(
				LARAVEL_PACK,
				"/tmp/agntc-clone",
				"/fake/project",
			);
		});

		it("updates manifest with new commit and files", async () => {
			const entry = makeEntry({
				ref: null,
				commit: INSTALLED_SHA,
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
					files: [".claude/skills/my-skill/"],
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("shows summary with old and new commit", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// No confirm mock was set up — would throw if called
			// Also explicitly verify no confirm import usage
			expect(mockWriteManifest).toHaveBeenCalled();
		});
	});

	describe("legacy multi-agent entry migrates to .claude", () => {
		const legacyFiles = [
			".claude/skills/my-skill/",
			".agents/skills/my-skill/",
			".cursor/skills/my-skill/",
		];

		function setupLegacyUpdate(files: string[]): void {
			const legacyEntry = {
				...makeEntry({ type: "skill", commit: INSTALLED_SHA, files }),
				agents: ["claude", "codex", "cursor"],
			};
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": legacyEntry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});
		}

		it("nukes every recorded file and reinstalls into .claude only", async () => {
			setupLegacyUpdate(legacyFiles);

			await runUpdate("owner/repo");

			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				legacyFiles,
			);
			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/tmp/agntc-clone",
				projectDir: "/fake/project",
				skillName: "repo",
			});
		});

		it("persists the reinstalled entry with .claude files and no agents field", async () => {
			setupLegacyUpdate(legacyFiles);

			await runUpdate("owner/repo");

			const written = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(written["owner/repo"]!.files).toEqual([".claude/skills/repo/"]);
			expect(written["owner/repo"]).not.toHaveProperty("agents");
		});

		it("migrates a Codex-only entry", async () => {
			setupLegacyUpdate([".agents/skills/my-skill/"]);

			await runUpdate("owner/repo");

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".agents/skills/my-skill/",
			]);
			const written = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(written["owner/repo"]!.files).toEqual([".claude/skills/repo/"]);
		});

		it("names no agent in the update summary", async () => {
			setupLegacyUpdate(legacyFiles);

			await runUpdate("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				"Updated owner/repo: aaaaaaa -> bbbbbbb — 1 file(s)",
			);
		});
	});

	describe("irreconcilable-change abort (derive-before-delete)", () => {
		function arrangeRecordedSkillAbort(key = "owner/repo"): ManifestEntry {
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
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
			// The recorded SKILL.md is gone and two skills now carry its name -> aborted.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("a/repo", "b/repo");
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
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
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
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-a", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			// repo-a's SKILL.md is gone and two skills now carry its name -> aborted;
			// repo-b's is present -> succeeds.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/repo-a", "y/repo-a");
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
			expect(writeCalls.length).toBeGreaterThan(0);
			for (const call of writeCalls) {
				const written = call[1] as Manifest;
				// aborted entry stays exactly as it was, never removed.
				expect(written["owner/repo-a"]).toBeDefined();
			}
		});

		it("all-updates: aborted outcome reports loud per-unit message naming remedy", async () => {
			const handle = captureSpinner();
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
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
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("a/repo", "b/repo");

			// All-updates abort exits non-zero after rendering the loud summary;
			// catch so the summary assertions below still run.
			await runUpdate().catch(() => {});

			// The single aborted member is a group-of-one → its loud line is the
			// spinner stop-frame at code 2 (error ✗).
			const msg = stopTexts(handle, 2).find(
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
			const handle = captureSpinner();
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
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

			// Copy-safety message rendered for the blocked member — a group-of-one,
			// so its loud line is the spinner stop-frame at code 2 (error ✗).
			const blockedMsg = stopTexts(handle, 2).find((m) =>
				m.includes("owner/repo-a"),
			);
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
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
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
			// repo-a's recorded SKILL.md is gone and two skills now carry its name ->
			// aborted; repo-b stays.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/agntc-clone-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/repo-a", "y/repo-a");
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
			const handle = captureSpinner();
			arrangePartialAbort();

			await runUpdate().catch(() => {});

			// repo-a aborts as a group-of-one → its loud line is the spinner
			// stop-frame at code 2 (error ✗).
			const msg = stopTexts(handle, 2).find((m) => m.includes("owner/repo-a"));
			expect(msg).toBeDefined();
			expect(msg).toContain("skill");
			expect(msg).toContain("unchanged");
			expect(msg).toContain("npx agntc remove owner/repo-a");
		});

		it("lists per-unit outcomes for both the aborted and the succeeded unit", async () => {
			const handle = captureSpinner();
			arrangePartialAbort();

			await runUpdate().catch(() => {});

			// Each is its own group-of-one: repo-b succeeds (stop code 0), repo-a
			// aborts (stop code 2).
			expect(stopTexts(handle, 0).some((m) => m.includes("owner/repo-b"))).toBe(
				true,
			);
			expect(stopTexts(handle, 2).some((m) => m.includes("owner/repo-a"))).toBe(
				true,
			);
		});

		it("reports each aborted entry with its own reason (two distinct loud lines)", async () => {
			const handle = captureSpinner();
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
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
			// Both recorded skills are gone and each name now matches two skills ->
			// both abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("x/repo-a", "y/repo-a", "x/repo-b", "y/repo-b");

			await runUpdate().catch(() => {});

			// Two standalone repos, each a group-of-one → two distinct loud
			// stop-frames at code 2 (error ✗).
			const errorCalls = stopTexts(handle, 2);
			const msgA = errorCalls.find((m) => m.includes("owner/repo-a"));
			const msgB = errorCalls.find((m) => m.includes("owner/repo-b"));
			expect(msgA).toBeDefined();
			expect(msgB).toBeDefined();
			expect(msgA).toContain(
				"2 skills are now named repo-a: x/repo-a, y/repo-a",
			);
			expect(msgB).toContain(
				"2 skills are now named repo-b: x/repo-b, y/repo-b",
			);
			expect(msgA).toContain("npx agntc remove owner/repo-a");
			expect(msgB).toContain("npx agntc remove owner/repo-b");
		});

		it("exits non-zero once even when multiple units abort", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
					files: [".claude/skills/skill-a/"],
				}),
				"owner/repo-b": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
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
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("x/repo-a", "y/repo-a", "x/repo-b", "y/repo-b");

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("abort is not swallowed by the all-up-to-date early return", async () => {
			// owner/repo-current is up to date; owner/repo-a aborts. The abort must
			// still be reported and force a non-zero exit (not the up-to-date path).
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-current": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/current/"],
				}),
				"owner/repo-a": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
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
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("x/repo-a", "y/repo-a");

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockOutro).not.toHaveBeenCalledWith(
				expect.stringContaining("up to date"),
			);
			// repo-a aborts as a group-of-one → loud stop-frame at code 2 (error ✗).
			expect(stopTexts(handle, 2).some((m) => m.includes("owner/repo-a"))).toBe(
				true,
			);
		});

		it("pack single-entry abort is atomic — the entry stays intact and exits non-zero", async () => {
			const entry = makeEntry({
				type: "pack",
				commit: INSTALLED_SHA,
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
			// The pack's folder now holds declared packs -> derive gate aborts.
			mockDiscover.mockRejectedValue(
				new PackConflictError("contains packs", "contains-packs"),
			);

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
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
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

			expect(mockCancel).toHaveBeenCalledOnce();
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("git clone failed"),
			);
			expect(mockLog.error).not.toHaveBeenCalled();
		});
	});

	describe("clone-fatal fan-out & grouped rendering — all-mode group (task 1-7 / 2-6)", () => {
		// A 3-member collection sharing one (cloneUrl, versionIntent) → one group,
		// one shared clone. When that clone throws, every member of the group's
		// UPDATING subset becomes a `failed` outcome attributed to its own key (the
		// MODEL — Phase 1 task 1-7, preserved). The DISPLAY (task 2-6) collapses those
		// N failed outcomes to ONE enumerated grouped error line naming the affected
		// members — never N identical anonymous lines — while the model + exit stay
		// exactly as Phase 1 built them.
		function threeMemberCollection(): void {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
		}

		it("renders a group clone failure as one enumerated error line, not N lines", async () => {
			const handle = captureSpinner();
			threeMemberCollection();
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await runUpdate().catch(() => {});

			// ONE enumerated grouped error line naming the affected member basenames
			// alongside the count — emitted in place of the header's per-member lines.
			expect(mockLog.error.mock.calls.map((c) => c[0])).toEqual([
				"owner/repo: clone failed — affects 3 members: a, b, c",
			]);
			// The interim per-member `<key>: Failed — …` warn lines are gone: the
			// N-outcome fan-out is a DISPLAY-only collapse now (never one line per member).
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			expect(warnCalls.some((m) => m.includes("Failed"))).toBe(false);
			// The >=2-member group still opens (and settles) its Updating header spinner.
			expect(handle.start).toHaveBeenCalledWith(
				expect.stringContaining("Updating owner/repo"),
			);
		});

		it("mutates no manifest state for the clone-failed group", async () => {
			threeMemberCollection();
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await runUpdate().catch(() => {});

			// clone-failed removes no entries (only copy-failed does) → the persistence
			// fold sees only `failed` outcomes → no add/remove → no write for the group.
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("keeps N failed outcomes in the model so the run exits non-zero (ExitSignal 1)", async () => {
			threeMemberCollection();
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const err = await runUpdate().catch((e) => e);

			// The DISPLAY collapsed to one line, but the model still holds N `failed`
			// outcomes → hasFailedOutcome trips → runAllUpdates throws ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("a sibling group still streams and persists when another group clone fails", async () => {
			// Two 2-member collections → two groups. Group A (manifest-first) clone
			// throws (group-fatal → enumerated error line); group B clones and streams
			// its member lines. Isolation: A removes/writes nothing; B streams both
			// member ✓ lines and persists; the run exits non-zero because A failed.
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a/x": member("x"),
				"owner/repo-a/y": member("y"),
				"owner/repo-b/m": member("m"),
				"owner/repo-b/n": member("n"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			// Group A (manifest-first) clone fails; group B clone succeeds.
			mockCloneSource
				.mockRejectedValueOnce(new Error("git clone failed"))
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Group A collapses to ONE enumerated error line; group B streams both
			// member ✓ lines under its own header.
			expect(mockLog.error.mock.calls.map((c) => c[0])).toEqual([
				"owner/repo-a: clone failed — affects 2 members: x, y",
			]);
			expect(mockLog.success.mock.calls.map((c) => c[0])).toEqual(["m", "n"]);
			// Only group B persisted; group A (clone-failed) wrote nothing.
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b/m",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b/n",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("owner/repo-a"),
				expect.anything(),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		it("a group-of-one clone failure renders ONE collapsed spin.stop line, not a header + enumerated line", async () => {
			// A standalone repo → a group-of-one (attempted count === 1). Its clone
			// throws. Per the task-2-4 collapse principle it stays a SINGLE physical
			// line — the red ▲ spinner stop-frame (code 2) — NOT a header stop plus a
			// separate enumerated `affects 1 members` line (which would be redundant
			// with the repo name AND regress the group-of-one collapse).
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/solo/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await runUpdate().catch(() => {});

			// The single collapsed failed line IS the spinner stop-frame at code 2.
			expect(stopTexts(handle, 2)).toEqual([
				"owner/repo: Failed — git clone failed",
			]);
			// No enumerated grouped line for a group-of-one — no "affects" text anywhere.
			const errorCalls = mockLog.error.mock.calls.map((c) => c[0] as string);
			expect(errorCalls.some((m) => m.includes("clone failed — affects"))).toBe(
				false,
			);
			expect(mockLog.error).not.toHaveBeenCalled();
		});
	});

	describe("check/resolve-fatal fan-out — all-mode group (task 1-8)", () => {
		// A group's single resolution probe (resolveGroupTarget) can itself fail —
		// dead remote / ls-remote error — BEFORE any clone. By analogy to a clone
		// failure, every member of the group becomes a check-failed outcome
		// attributed to its own key and carrying the shared probe reason; no clone or
		// reinstall runs, so no manifest mutation occurs. Per the ratified exit
		// posture, all-mode check-failed WARNS and exits 0 (it is excluded from
		// hasFailedOutcome); the single-key path still exits 1 (see the "check-failed"
		// block above — untouched here).
		const PROBE_REASON = "ls-remote failed: could not read from remote";

		function threeMemberCollection(): void {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			// The group's single resolution probe fails BEFORE any clone.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "check-failed",
				reason: PROBE_REASON,
			});
		}

		it("collapses a group probe failure to one check-failed line carrying the shared reason", async () => {
			threeMemberCollection();

			const err = await runUpdate().catch((e) => e);

			// All-mode check-failed warns and exits 0 (excluded from hasFailedOutcome).
			expect(err).toBeUndefined();
			// The MODEL stays N check-failed outcomes (exit accounting); the DISPLAY
			// count-collapses to ONE group line (task 2-5) — a group-level probe
			// failure is one shared reason, never one line per member.
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			const checkFailedLines = warnCalls.filter((m) =>
				m.includes("check failed"),
			);
			expect(checkFailedLines).toEqual([
				`owner/repo: check failed — ${PROBE_REASON}`,
			]);
		});

		it("a check-failed group runs no clone and mutates no manifest state", async () => {
			threeMemberCollection();

			await runUpdate().catch(() => {});

			// The probe failed BEFORE any clone; no reinstall runs, so nothing persists.
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("all-mode with a check-failed group (others succeeding) exits 0", async () => {
			// Two standalone repos → two groups-of-one. Group A's probe fails
			// (check-failed → warn, no clone); group B resolves update-available and
			// updates. Per the ratified posture, the check-failed group does NOT feed
			// hasFailedOutcome, so the run exits 0 while B still updates and persists.
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				if (group.members[0]!.key === "owner/repo-a") {
					return { kind: "check-failed", reason: PROBE_REASON };
				}
				return { kind: "head", resolvedSha: REMOTE_SHA };
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone-b",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			const err = await runUpdate().catch((e) => e);

			// check-failed excluded from hasFailedOutcome → no ExitSignal (exit 0).
			expect(err).toBeUndefined();
			// B still clones, updates, and persists; A's failed probe wrote nothing.
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
				expect.anything(),
			);
		});

		it("collapses the trailing summary to the group label — no per-member enumeration", async () => {
			threeMemberCollection();

			await runUpdate().catch(() => {});

			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			// One group line keyed by the group label (task 2-5)...
			expect(warnCalls).toContain(`owner/repo: check failed — ${PROBE_REASON}`);
			// ...and the individual member keys never each surface a line.
			for (const key of ["owner/repo/a", "owner/repo/b", "owner/repo/c"]) {
				expect(warnCalls.some((m) => m.startsWith(`${key}:`))).toBe(false);
			}
		});
	});

	describe("ratified exit-code posture — safe-vs-major bump gating (task 4-3 regression lock)", () => {
		// The ratified spec ("Exit-code posture — single-key vs all-mode") pins an
		// INTENTIONAL divergence for the two non-hard-failure categories, check-failed
		// and constrained-no-match:
		//
		//   | category               | single-key      | all-mode           |
		//   | ---------------------- | --------------- | ------------------ |
		//   | check-failed           | ExitSignal(1)   | warn, exit 0       |
		//   | constrained-no-match   | ExitSignal(1)   | warn, exit 0       |
		//   | aborted                | ExitSignal(1)   | ExitSignal(1)      |
		//   | blocked                | ExitSignal(1)   | ExitSignal(1)      |
		//   | failed (clone fan-out) | ExitSignal(1)   | ExitSignal(1)      |
		//   | copy-failed            | ExitSignal(1)   | ExitSignal(1)      |
		//   | up-to-date/newer-tags  | exit 0          | exit 0             |
		//
		// Single-key exits 1 on check-failed / constrained-no-match because the
		// requested action did not happen; all-mode WARNS and exits 0 (both are
		// excluded from hasFailedOutcome — a batch is not sunk by one dead remote or
		// one stuck constraint). hasFailedOutcome membership is EXACTLY
		// aborted | blocked | failed | copy-failed. This block is a verification /
		// regression lock: the posture is already implemented (Phase 1 task 1-8 for the
		// all-mode fan-out, pre-existing runSingleUpdate code for single-key). It
		// authors one NAMED lock per matrix cell so the posture cannot drift; each cell
		// asserts the exit explicitly. Finer-grained behavioural coverage lives in the
		// "check-failed", "constrained-no-match — single plugin", "check/resolve-fatal
		// fan-out — all-mode group (task 1-8)", "constrained statuses — all-plugins
		// mode", "all-updates partial-success exit", "symlink-escape copy-safety block",
		// "clone-fatal fan-out & grouped rendering", and "copy-failed — all-updates
		// mode" blocks; these tests reference and consolidate them into the matrix.
		// A regression here is a genuine posture break, NOT a test to relax.

		function skillEntry(name: string): ManifestEntry {
			return makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [`.claude/skills/${name}/`],
			});
		}

		// --- single-key: strict, exit 1 on both non-hard-failure categories ---

		it("single-key check-failed exits 1", async () => {
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": makeEntry() });
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			const err = await runUpdate("owner/repo").catch((e) => e);

			// The requested action did not happen -> ExitSignal(1), loud error.
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				"Update check failed for owner/repo: network timeout",
			);
		});

		it("single-key constrained-no-match exits 1", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
				}),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "constrained-no-match" });

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				"No tags satisfy the constraint for owner/repo. Left untouched.",
			);
		});

		// --- all-mode: the two non-hard-failure categories warn and exit 0 ---

		it("all-mode check-failed warns and exits 0 (excluded from hasFailedOutcome), no manifest mutation", async () => {
			const REASON = "ls-remote failed: could not read from remote";
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo-b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
			});
			// Group A's resolution probe fails (Phase 1 seam); group B resolves
			// update-available and succeeds.
			mockResolveGroupTarget.mockImplementation(async (group) =>
				group.members[0]!.key === "owner/repo-a"
					? { kind: "check-failed", reason: REASON }
					: { kind: "head", resolvedSha: REMOTE_SHA },
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone-b",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/b/"],
			});

			const err = await runUpdate().catch((e) => e);

			// Excluded from hasFailedOutcome -> the batch resolves (exit 0).
			expect(err).toBeUndefined();
			// Surfaced via warn, NOT error.
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			expect(warnCalls).toContain(`owner/repo-a: check failed — ${REASON}`);
			expect(mockLog.error).not.toHaveBeenCalled();
			// The check-failed group mutates no manifest state (probe failed before any
			// clone); the succeeding sibling B still persists.
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
				expect.anything(),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
		});

		it("all-mode constrained-no-match warns and exits 0, entry left untouched", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained-no-match",
			});

			const err = await runUpdate().catch((e) => e);

			// Excluded from hasFailedOutcome -> the batch resolves (exit 0).
			expect(err).toBeUndefined();
			// Surfaced via warn, NOT error.
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			expect(warnCalls).toContain(
				"owner/repo: no tags satisfy ^2.0 — left untouched",
			);
			expect(mockLog.error).not.toHaveBeenCalled();
			// Entry left untouched: no clone, no write, no add/remove.
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		// --- all-mode: the four hard-failure categories each trip ExitSignal(1),
		// while a succeeding sibling still persists (partial-success) ---

		it("all-mode aborted exits 1 while the succeeded sibling persists", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": skillEntry("a"),
				"owner/repo-b": skillEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			// Distinct temp dirs so the derive gate can be failed for repo-a only.
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-a", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			// repo-a's recorded SKILL.md is gone and two skills now carry its name ->
			// derive-before-delete abort (install intact, entry untouched); repo-b clean.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/repo-a", "y/repo-a");
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/b/"],
			});

			const err = await runUpdate().catch((e) => e);

			// aborted is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Partial success: sibling B persisted; aborted A entry left intact.
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(mockWriteManifest.mock.calls.length).toBeGreaterThan(0);
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-b"],
			).toBeDefined();
			// aborted A's original entry is preserved in the persisted manifest, not
			// merely not-removed.
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-a"],
			).toBeDefined();
		});

		it("all-mode blocked exits 1 while the succeeded sibling persists", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": skillEntry("a"),
				"owner/repo-b": skillEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-a", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			// repo-a's re-clone has an escaping symlink -> copy-safety block (install
			// intact, entry untouched); repo-b clean.
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (typeof sourceDir === "string" && sourceDir.includes("/clone-a")) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/b/"],
			});

			const err = await runUpdate().catch((e) => e);

			// blocked is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Partial success: sibling B persisted; blocked A entry left intact.
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-b"],
			).toBeDefined();
			// blocked A's original entry is preserved in the persisted manifest, not
			// merely not-removed.
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-a"],
			).toBeDefined();
		});

		it("all-mode failed (clone-failure fan-out) exits 1, no entries removed", async () => {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			// Two 2-member collections -> two groups. Group A's shared clone throws
			// (group-fatal), fanning out to N `failed` outcomes (Phase 1 task 1-7);
			// group B clones and updates.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a/x": member("x"),
				"owner/repo-a/y": member("y"),
				"owner/repo-b/m": member("m"),
				"owner/repo-b/n": member("n"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource
				.mockRejectedValueOnce(new Error("git clone failed"))
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			const err = await runUpdate().catch((e) => e);

			// `failed` is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// A clone failure removes NO entries (only copy-failed does).
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			// Sibling group B still streamed and persisted; group A wrote nothing.
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b/m",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("owner/repo-a"),
				expect.anything(),
			);
		});

		it("all-mode copy-failed exits 1, its entry removed, siblings persist", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo-b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			// repo-a's re-copy throws AFTER its old files are nuked -> copy-failed
			// (its entry is removed); repo-b succeeds.
			mockCopyBareSkill
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/b/"] });

			const err = await runUpdate().catch((e) => e);

			// copy-failed is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Its own entry removed; the sibling still persists.
			expect(mockRemoveEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			const lastWrite = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(lastWrite["owner/repo-a"]).toBeUndefined();
			expect(lastWrite["owner/repo-b"]).toBeDefined();
		});

		// --- capstone: hasFailedOutcome membership is EXACTLY the four hard failures;
		// no non-actioned category trips the all-mode non-zero exit ---

		it("no non-actioned status (up-to-date / newer-tags / check-failed / constrained-no-match) trips the all-mode non-zero exit", async () => {
			captureSpinner();
			const CHECK_REASON = "ls-remote failed: dead remote";
			// Four groups, one per non-actioned category — none of which is a member
			// of hasFailedOutcome (aborted | blocked | failed | copy-failed).
			mockReadManifestOrExit.mockResolvedValue({
				"owner/uptodate": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/uptodate/"],
				}),
				"owner/newer": makeEntry({
					ref: "v1.0",
					commit: INSTALLED_SHA,
					files: [".claude/skills/newer/"],
				}),
				"owner/checkfail": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/checkfail/"],
				}),
				"owner/nomatch": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
					files: [".claude/skills/nomatch/"],
				}),
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				if (key === "owner/uptodate") {
					return { kind: "head", resolvedSha: INSTALLED_SHA };
				}
				if (key === "owner/newer") {
					return { kind: "tag", tag: "v1.0", newerTags: ["v2.0"] };
				}
				if (key === "owner/checkfail") {
					return { kind: "check-failed", reason: CHECK_REASON };
				}
				return { kind: "constrained-no-match" };
			});

			const err = await runUpdate().catch((e) => e);

			// None of the four categories is a hasFailedOutcome member -> exit 0.
			expect(err).toBeUndefined();
			// Every category was genuinely produced (not swallowed by an early return):
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const messageCalls = mockLog.message.mock.calls.map(
				(c) => c[0] as string,
			);
			expect(warnCalls).toContain(
				`owner/checkfail: check failed — ${CHECK_REASON}`,
			);
			expect(warnCalls).toContain(
				"owner/nomatch: no tags satisfy ^2.0 — left untouched",
			);
			expect(infoCalls.some((m) => m.includes("newer tags available"))).toBe(
				true,
			);
			expect(messageCalls.some((m) => m.includes("up to date"))).toBe(true);
			expect(mockCloneSource).not.toHaveBeenCalled();
			// No hard-failure category surfaced -> no loud error anywhere.
			expect(mockLog.error).not.toHaveBeenCalled();
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

		it.each([
			["by key", "owner/repo"],
			["in all-mode", undefined],
		])("keeps a branch entry on its branch when updated %s", async (_, key) => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "dev", commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(key);

			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{
					"owner/repo": expect.objectContaining({
						ref: "dev",
						commit: REMOTE_SHA,
					}),
				},
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

	describe("recorded type replay — pack", () => {
		it("re-walks a pack entry and copies what it holds now", async () => {
			const entry = makeEntry({
				type: "pack",
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
			mockDiscover.mockResolvedValue(onlyPack(LARAVEL_PACK));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [
					".claude/skills/new-skill/",
					".claude/agents/executor.md",
				],
				assetCounts: { skills: 1, agents: 1 },
			});

			await runUpdate("owner/repo");

			expect(mockDiscover).toHaveBeenCalledWith("/tmp/agntc-clone", {
				startPath: "",
				forcePack: true,
				rootName: "repo",
			});
			expect(mockCopyPack).toHaveBeenCalledWith(
				LARAVEL_PACK,
				"/tmp/agntc-clone",
				"/fake/project",
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
				expect.objectContaining({
					type: "pack",
					files: [".claude/skills/new-skill/", ".claude/agents/executor.md"],
				}),
			);
		});

		it("reports a pack entry that is now a single skill before the outro", async () => {
			const entry = makeEntry({
				type: "pack",
				files: [".claude/agents/openai.yaml"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo/swift": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockDiscover.mockRejectedValue(
				new PackConflictError("single skill", "single-skill"),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/swift/"],
			});

			await runUpdate("owner/repo/swift");

			const note =
				"owner/repo/swift is a single skill — reinstalled as a skill";
			expect(mockLog.info).toHaveBeenCalledWith(note);
			expect(mockLog.info.mock.invocationCallOrder.at(-1)).toBeLessThan(
				mockOutro.mock.invocationCallOrder.at(-1)!,
			);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/agents/openai.yaml",
			]);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo/swift",
				expect.objectContaining({
					type: "skill",
					files: [".claude/skills/swift/"],
				}),
			);
		});
	});

	describe("all-mode reinstall notes", () => {
		it("prints a member's note after its group settles", async () => {
			const handle = captureSpinner();
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/swift": makeEntry({
					type: "pack",
					files: [".claude/agents/openai.yaml"],
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
			mockDiscover.mockRejectedValue(
				new PackConflictError("single skill", "single-skill"),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/swift/"],
			});

			await runUpdate();

			expect(mockLog.info).toHaveBeenCalledWith(
				"owner/repo/swift is a single skill — reinstalled as a skill",
			);
			const settled = handle.stop.mock.invocationCallOrder.at(-1)!;
			expect(mockLog.info.mock.invocationCallOrder[0]).toBeGreaterThan(settled);
		});
	});

	describe("recorded type replay — skill", () => {
		it("uses copyBareSkill for a skill entry", async () => {
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
			expect(mockCopyPack).not.toHaveBeenCalled();
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

		it("single-key exact-pin standalone outros npx agntc add owner/repo@<newest>", async () => {
			// Regression-lock (task 4-2): the single-key path for an exact-pin
			// standalone stays key-scoped — it suggests the newest tag as
			// `add owner/repo@v3.0` (update.ts:151, pre-existing), NEVER the bare
			// caret footer form `add owner/repo` (which would silently switch the
			// user into caret tracking).
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
			// Exact-pin keeps the @<newest> suffix — never the bare caret re-add.
			expect(mockOutro).not.toHaveBeenCalledWith(
				"To upgrade: npx agntc add owner/repo",
			);
		});

		it("single-key exact-pin collection member outros npx agntc add owner/repo/<member>@<newest>", async () => {
			// Regression-lock (task 4-2): a single-key COLLECTION MEMBER stays
			// member-scoped — the command targets the one plugin
			// (`add owner/repo/go@v3.0`), NOT the repo-level collapse
			// (`add owner/repo@v3.0`) the all-mode collapsed line uses.
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
			// Member-scoped, NOT the repo-level command the all-mode collapse uses.
			expect(mockOutro).not.toHaveBeenCalledWith(
				"To upgrade: npx agntc add owner/repo@v3.0",
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
			files: [".claude/skills/my-plugin/"],
			cloneUrl: null,
		};

		function setupLocalBase(): void {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});
		}

		it("triggers re-copy from stored path when status is local", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY);

			expect(mockStat).toHaveBeenCalledWith(LOCAL_KEY);
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
				`${LOCAL_KEY}: path does not exist`,
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
				`${LOCAL_KEY}: path is not a directory`,
			);
		});

		it("does not use git clone for local updates", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
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

		it("re-walks a local pack entry from its folder", async () => {
			const pluginEntry: ManifestEntry = { ...LOCAL_ENTRY, type: "pack" };
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: pluginEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockDiscover.mockResolvedValue(onlyPack(LARAVEL_PACK));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				assetCounts: { skills: 1, agents: 1 },
			});

			await runUpdate(LOCAL_KEY);

			expect(mockDiscover).toHaveBeenCalledWith(LOCAL_KEY, {
				startPath: "",
				forcePack: true,
				rootName: basename(LOCAL_KEY),
			});
			expect(mockCopyPack).toHaveBeenCalledWith(
				LARAVEL_PACK,
				LOCAL_KEY,
				"/fake/project",
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("says why when its recorded path leads outside its folder", async () => {
			setupLocalBase();
			mockReadManifestOrExit.mockResolvedValue({
				[LOCAL_KEY]: {
					...LOCAL_ENTRY,
					localRoot: LOCAL_KEY,
					sourceSubpath: "../x",
				},
			});

			const err = await runUpdate(LOCAL_KEY).catch((e) => e);

			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledTimes(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringMatching(new RegExp(`^${LOCAL_KEY}: .*"\\.\\./x"`)),
			);
			expect(mockCancel).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});
	});

	describe("collection plugin key", () => {
		it("resolves collection key and clones from owner/repo", async () => {
			const entry = makeEntry({
				type: "skill",
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
			// The recorded-skill validation gate uses the subdir
			expect(mockAccess).toHaveBeenCalledWith("/tmp/agntc-clone/go/SKILL.md");
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
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
				files: [".claude/skills/go/"],
			});
			const tsEntry = makeEntry({
				commit: INSTALLED_SHA,
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

			// Return distinct copiedFiles per key so we can verify both entries
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/go/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/ts/"] });

			await runUpdate("owner/repo");

			expect(mockCheckForUpdate).toHaveBeenCalledTimes(2);
			expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo/go", goEntry);
			expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo/ts", tsEntry);

			// Each key is recorded as it finishes: go alone, then BOTH
			const goUpdated = expect.objectContaining({
				commit: REMOTE_SHA,
				files: [".claude/skills/go/"],
			});
			expect(
				mockWriteManifest.mock.calls.map(([, written]) => written),
			).toEqual([
				{ "owner/repo/go": goUpdated, "owner/repo/ts": tsEntry },
				{
					"owner/repo/go": goUpdated,
					"owner/repo/ts": expect.objectContaining({
						commit: REMOTE_SHA,
						files: [".claude/skills/ts/"],
					}),
				},
			]);
		});

		it("resolves owner/repo/plugin-name to exact match", async () => {
			const goEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/go/"],
			});
			const tsEntry = makeEntry({
				commit: INSTALLED_SHA,
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
				"nonexistent/repo is not installed.",
			);
		});

		it("prefers exact match when key exists as both standalone and collection prefix", async () => {
			const standaloneEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/standalone/"],
			});
			const collectionEntry = makeEntry({
				commit: INSTALLED_SHA,
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
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await runUpdate("owner/repo").catch(() => {});

			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining("npx agntc add owner/repo"),
			);
		});
	});

	describe("copy-failed — single-update local path", () => {
		const LOCAL_KEY = "/Users/lee/Code/my-plugin";
		const LOCAL_ENTRY: ManifestEntry = {
			ref: null,
			commit: null,
			installedAt: "2026-02-01T00:00:00.000Z",
			files: [".claude/skills/my-plugin/"],
			cloneUrl: null,
		};

		it("throws ExitSignal and removes manifest entry on local copy failure", async () => {
			const manifest = { [LOCAL_KEY]: LOCAL_ENTRY };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
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
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await runUpdate(LOCAL_KEY).catch(() => {});

			expect(mockLog.error).toHaveBeenCalledWith(
				expect.stringContaining(`npx agntc add ${LOCAL_KEY}`),
			);
		});
	});

	describe("constrained-update-available — single plugin", () => {
		it("triggers nuke-and-reinstall at the new tag", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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

		it("single-key runSinglePluginUpdate passes entry.ref and result.manifestEntry.ref into renderGitUpdateSummary", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// oldRef = pre-update entry.ref (v1.2.3), newRef = post-update
			// result.manifestEntry.ref (resolved v1.3.0) → the shared formatVersionMove
			// renders the tag move, not commit hashes.
			expect(mockOutro).toHaveBeenCalledWith(
				"Updated owner/repo: v1.2.3 -> v1.3.0 — 1 file(s)",
			);
		});

		it("updates ref and commit in manifest to new resolved tag values", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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

		it("shows update summary with old and new version (tags for a constrained update)", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// Both refs are semver tags and the ref moved (v1.2.3 -> v1.3.0) → the
			// shared formatVersionMove renders tags, not the commit hashes.
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("v1.2.3 -> v1.3.0"),
			);
		});

		it("never downgrades — reports up-to-date when current ref is higher than resolved tag", async () => {
			const entry = makeEntry({
				ref: "v1.5.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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

		it("collapses a constrained-no-match group to one trailing line with the shared constraint", async () => {
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
			// Collapsed group line carrying the shared constraint (task 2-5).
			expect(warnCalls).toContain(
				"owner/repo: no tags satisfy ^2.0 — left untouched",
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("handles batch with all constrained plugins — mixed constrained statuses", async () => {
			const handle = captureSpinner();
			const entryA = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate();

			// A should be updated (constrained-update-available)
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockWriteManifest).toHaveBeenCalled();
			// Summary should contain info for all three — the updated repo-a streams
			// as its group-of-one stop-frame; repo-b/repo-c via trailing p.log lines.
			const allMessages = [
				...mockLog.success.mock.calls.map((c) => c[0] as string),
				...mockLog.message.mock.calls.map((c) => c[0] as string),
				...mockLog.warn.mock.calls.map((c) => c[0] as string),
				...stopTexts(handle),
			];
			const hasRepoA = allMessages.some((msg) => msg.includes("owner/repo-a"));
			const hasRepoB = allMessages.some((msg) => msg.includes("owner/repo-b"));
			const hasRepoC = allMessages.some((msg) => msg.includes("owner/repo-c"));
			expect(hasRepoA).toBe(true);
			expect(hasRepoB).toBe(true);
			expect(hasRepoC).toBe(true);
		});

		it("handles mix of constrained + branch-tracking + tag-pinned + local plugins", async () => {
			const handle = captureSpinner();
			const constrainedEntry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/constrained-skill/"],
			});
			const branchEntry = makeEntry({
				ref: null,
				commit: INSTALLED_SHA,
				files: [".claude/skills/branch-skill/"],
			});
			const tagEntry = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				files: [".claude/skills/tagged-skill/"],
			});
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
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
			// All four should appear in the summary — the updated constrained/branch
			// standalones stream as group-of-one stop-frames; tagged (info) and local
			// (p.log.success) via trailing p.log lines.
			const allMessages = [
				...mockLog.success.mock.calls.map((c) => c[0] as string),
				...mockLog.message.mock.calls.map((c) => c[0] as string),
				...mockLog.info.mock.calls.map((c) => c[0] as string),
				...stopTexts(handle),
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
			const handle = captureSpinner();
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate();

			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			// The updated repo-a streams as its group-of-one stop-frame; repo-b
			// (newer-tags) via the trailing p.log.info summary.
			const allMessages = [
				...mockLog.success.mock.calls.map((c) => c[0] as string),
				...mockLog.info.mock.calls.map((c) => c[0] as string),
				...stopTexts(handle),
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
			// The never-downgraded member is demoted to up-to-date and reported via the
			// collapsed per-group count line (task 2-5): one member → "1 up to date".
			const messageCalls = mockLog.message.mock.calls.map(
				(c) => c[0] as string,
			);
			expect(messageCalls).toContain("owner/repo: 1 up to date");
		});

		it("constrained-update-available with all constrained-up-to-date does not show all-up-to-date message", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			// Should NOT show "Everything is up to date." — there was an update
			expect(mockOutro).not.toHaveBeenCalledWith("Everything is up to date.");
		});
	});

	describe("copy-failed — all-updates mode", () => {
		it("removes entry from batch manifest for git copy failure", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
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
			const handle = captureSpinner();
			const entry = makeEntry({
				commit: INSTALLED_SHA,
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
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			// Copy failure exits non-zero after the summary is rendered; catch so
			// the recovery-hint assertion below still runs.
			await runUpdate().catch(() => {});

			// The copy-failed standalone is a group-of-one → its loud recovery-hint
			// line is the spinner stop-frame at code 2 (error ✗).
			const hasRecoveryHint = stopTexts(handle, 2).some((msg) =>
				msg.includes("npx agntc add owner/repo"),
			);
			expect(hasRecoveryHint).toBe(true);
		});

		it("removes entry from batch manifest for local copy failure", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
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
		it("all-mode footer names the post-bump landed tag as current when a safe bump applies this run", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate();

			// A same-run safe bump lands v1.3.0; the footer names that POST-BUMP
			// landed tag (group target.tag), not the pre-bump ref, so it agrees with
			// the inline Updated line.
			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls).toContain(
				"  owner/repo  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/repo",
			);
			expect(infoCalls).toContain("Newer versions outside constraints:");
		});

		it("omits info section in batch mode when no out-of-constraint versions exist", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				ref: "v2.1.0",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
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

		it("single-key names the post-bump landed tag as current (v1.3.0 -> v2.0.0), consistent with the inline Updated line", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo");

			// current is the LANDED tag (checkResult.tag = v1.3.0), NOT the pre-bump
			// entry.ref (v1.2.3) — matching the inline `Updated ... -> v1.3.0` line.
			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls).toContain(
				"  owner/repo  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/repo",
			);
			expect(infoCalls).toContain("Newer versions outside constraints:");
		});

		it("omits info section in single-plugin mode when no out-of-constraint version", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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

		it("single-key constrained-up-to-date names entry.ref as current (pre/post coincide)", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: "v2.0.0",
			});

			await runUpdate("owner/repo");

			// No safe bump this run: pre/post coincide, so current = entry.ref = v1.3.0.
			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls).toContain(
				"  owner/repo  v1.3.0 -> v2.0.0 available. To upgrade: npx agntc add owner/repo",
			);
			expect(infoCalls).toContain("Newer versions outside constraints:");
		});

		it("a ^0.3.3 entry with 0.4.0 out of constraint renders the same actionable line (0.x-minor gate)", async () => {
			const entry = makeEntry({
				ref: "v0.3.3",
				commit: INSTALLED_SHA,
				constraint: "^0.3.3",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: "v0.4.0",
			});

			await runUpdate("owner/repo");

			// A 0.x-minor (^0.3.3 gates 0.4.0) rides the SAME out-of-constraint path as
			// a major — identical actionable wording, current from the check result.
			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls).toContain(
				"  owner/repo  v0.3.3 -> v0.4.0 available. To upgrade: npx agntc add owner/repo",
			);
		});

		it("does not render info line when within-constraint best equals absolute latest", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
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

		// --- Per-group footer collapse (task 2-7) ---
		// A constrained member (constraint ^1.0) already at the resolved best tag,
		// with a newer out-of-constraint version available (latestOverall v2.0.0).
		const constrainedMember = (name: string): ManifestEntry =>
			makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [`.claude/skills/${name}/`],
			});

		it("renders one footer line per group for a constrained mixed collection: one bare --skill command for its loose skills, one per pack", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a"),
				"owner/repo/b": {
					...constrainedMember("b"),
					sourceSubpath: "skills/b",
				},
				"owner/repo/tools": { ...constrainedMember("tools"), type: "pack" },
			});
			// ONE constrained group whose shared target is out of constraint
			// (latestOverall set) and at the members' installed tag (all up to date).
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			// ONE footer line for the whole collection: current = group target.tag,
			// keyed by the group label, the group's bare re-add commands.
			expect(infoCalls).toContain(
				[
					"  owner/repo  v1.2.3 -> v2.0.0 available. To upgrade:",
					"    npx agntc add owner/repo --skill a b",
					"    npx agntc add owner/repo/tools --pack",
				].join("\n"),
			);
			// Not N near-identical per-member footer lines.
			expect(infoCalls.filter((m) => m.includes("To upgrade"))).toHaveLength(1);
		});

		it("a multi-group repo renders two @intent-prefixed footer lines, each with its member's bare re-add command", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^1.2.3",
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					ref: "v2.0.0",
					commit: INSTALLED_SHA,
					constraint: "^2.0.0",
					files: [".claude/skills/b/"],
				}),
			});
			// Same repo, two intents → two groups, each out of constraint at its own
			// installed tag.
			mockResolveGroupTarget.mockImplementation(async (group) => {
				return group.members[0]!.entry.constraint === "^1.2.3"
					? {
							kind: "constrained",
							tag: "v1.2.3",
							commit: INSTALLED_SHA,
							latestOverall: "v3.0.0",
						}
					: {
							kind: "constrained",
							tag: "v2.0.0",
							commit: INSTALLED_SHA,
							latestOverall: "v3.0.0",
						};
			});

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			// Two footer lines: prefix disambiguated by @intent, command stays bare
			// (no @intent). current = each group's own target.tag.
			expect(infoCalls).toContain(
				"  owner/repo@^1.2.3  v1.2.3 -> v3.0.0 available. To upgrade: npx agntc add owner/repo/a",
			);
			expect(infoCalls).toContain(
				"  owner/repo@^2.0.0  v2.0.0 -> v3.0.0 available. To upgrade: npx agntc add owner/repo/b",
			);
			expect(infoCalls.filter((m) => m.includes("To upgrade"))).toHaveLength(2);
		});

		it("all-mode footer names the group target tag as current and the group's bare --skill re-add command", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a"),
				"owner/repo/b": constrainedMember("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate();

			// The footer is the ONLY info output on this all-up-to-date path, so the
			// exact two lines pin the actionable wording verbatim: current = group
			// target.tag (v1.2.3), a bare --skill command, no (constraint: ...) tail.
			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			expect(infoCalls).toEqual([
				"Newer versions outside constraints:",
				"  owner/repo  v1.2.3 -> v2.0.0 available. To upgrade: npx agntc add owner/repo --skill a b",
			]);
			// No (constraint: ...) tail survives the reword.
			const footer = infoCalls.join("\n");
			expect(footer).not.toContain("available (constraint");
		});

		it("the out-of-constraint footer keeps the all-mode (and single-key) exit at 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a"),
				"owner/repo/b": constrainedMember("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			const allModeErr = await runUpdate().catch((e) => e);

			// The footer does not feed hasFailedOutcome, so all-mode exit stays 0.
			expect(allModeErr).toBeUndefined();
			expect(mockLog.info.mock.calls.map((c) => c[0] as string)).toContain(
				"  owner/repo  v1.2.3 -> v2.0.0 available. To upgrade: npx agntc add owner/repo --skill a b",
			);

			// Single-key path: constrained-up-to-date, out of constraint — also exit 0.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.3.0",
					commit: INSTALLED_SHA,
					constraint: "^1.0",
					files: [".claude/skills/my-skill/"],
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: "v2.0.0",
			});

			const singleKeyErr = await runUpdate("owner/repo").catch((e) => e);
			expect(singleKeyErr).toBeUndefined();
		});

		// --- Caret disjointness (task 4-2) ---
		// A CONSTRAINED (caret) entry — constraint ^1.2.3, ref v1.2.3 — with a newer
		// OUT-OF-CONSTRAINT major (latestOverall v2.0.0). It resolves to a
		// constrained-* status, so it can only ever reach the task 4-1 caret footer;
		// it is NEVER routed onto the exact-pin @<newest> newer-tags surface. This
		// proves the two surfaces are disjoint: a caret user is never told to
		// `add …@<newest>`.
		const caretMember = (name: string): ManifestEntry =>
			makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.2.3",
				files: [`.claude/skills/${name}/`],
			});

		it("a caret entry with an out-of-constraint major is never routed to a @<newest> newer-tags line", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": caretMember("a"),
				"owner/repo/b": caretMember("b"),
			});
			// Constrained target at the members' installed tag (all up to date) with a
			// newer out-of-constraint major available.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate();

			const allLines = [
				...mockLog.info.mock.calls.map((c) => c[0]),
				...mockLog.message.mock.calls.map((c) => c[0]),
				...mockLog.warn.mock.calls.map((c) => c[0]),
				...mockOutro.mock.calls.map((c) => c[0]),
			].filter((m): m is string => typeof m === "string");
			// No newer-tags surface at all: neither the "newer tags available" notice...
			expect(allLines.some((m) => m.includes("newer tags available"))).toBe(
				false,
			);
			// ...nor any @<newest> re-add command (`npx agntc add <anything>@…`). The
			// caret footer's command is the BARE `npx agntc add owner/repo` (no @).
			expect(allLines.some((m) => /npx agntc add \S+@/.test(m))).toBe(false);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("a caret entry with an out-of-constraint major emits the bare re-add footer instead", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": caretMember("a"),
				"owner/repo/b": caretMember("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate();

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			// The caret out-of-constraint footer: current -> newer with the group's
			// BARE re-add command (no @ suffix), collapsed to one line for the group.
			expect(infoCalls).toContain("Newer versions outside constraints:");
			expect(infoCalls).toContain(
				"  owner/repo  v1.2.3 -> v2.0.0 available. To upgrade: npx agntc add owner/repo --skill a b",
			);
			expect(infoCalls.filter((m) => m.includes("To upgrade"))).toHaveLength(1);
		});
	});
});

describe("failureMemberLine (shared loud member-line rendering)", () => {
	// The collapsed group-of-one path (collapsedMemberLine) and the streamed
	// multi-member path (emitMemberLine) both route their loud outcomes
	// through this ONE helper, differing only by the display `name` they supply
	// (the collapsed path passes the FULL member key; the streamed path passes the
	// member basename). Asserting the helper directly proves the three loud
	// arms live in exactly one place and render identically — modulo that name —
	// across both paths.

	it("renders copy-failed at error level with the recovery hint, honouring the passed name", () => {
		const outcome: PluginOutcome = {
			status: "copy-failed",
			key: "owner/repo/design",
			summary: "re-run update",
		};

		// Collapsed path name source: the full member key.
		expect(failureMemberLine(outcome, "owner/repo/design")).toEqual({
			level: "error",
			text: "owner/repo/design: copy failed — re-run update",
		});
		// Streamed path name source: the member basename. Same shape, only the
		// name differs — proving the name is a parameter, not baked in.
		expect(failureMemberLine(outcome, "design")).toEqual({
			level: "error",
			text: "design: copy failed — re-run update",
		});
	});

	it("renders aborted at error level carrying the summary as the inline message", () => {
		const outcome: PluginOutcome = {
			status: "aborted",
			key: "owner/repo/design",
			summary: "recorded as skill but SKILL.md missing; run remove then add",
		};

		expect(failureMemberLine(outcome, "owner/repo/design")).toEqual({
			level: "error",
			text: "owner/repo/design: recorded as skill but SKILL.md missing; run remove then add",
		});
		expect(failureMemberLine(outcome, "design")).toEqual({
			level: "error",
			text: "design: recorded as skill but SKILL.md missing; run remove then add",
		});
	});

	it("renders blocked at error level carrying the summary as the inline message", () => {
		const outcome: PluginOutcome = {
			status: "blocked",
			key: "owner/repo/design",
			summary: "symlink target escapes the clone",
		};

		expect(failureMemberLine(outcome, "owner/repo/design")).toEqual({
			level: "error",
			text: "owner/repo/design: symlink target escapes the clone",
		});
		expect(failureMemberLine(outcome, "design")).toEqual({
			level: "error",
			text: "design: symlink target escapes the clone",
		});
	});

	it("returns null for a bare `failed` — its rendering is NOT shared (each caller renders it itself)", () => {
		// Both paths render a bare `failed` at ERROR (red ✗) but by different mechanics:
		// the collapsed path settles a red error spinner stop-frame (code 2), the
		// streamed path emits p.log.error via renderFailedOutcome. A single shared
		// MemberLine cannot reproduce both, so the helper declines (null) and each
		// caller keeps its own bare-`failed` fallback.
		const outcome: PluginOutcome = {
			status: "failed",
			key: "owner/repo",
			summary: "owner/repo: Failed — git clone failed",
		};

		expect(failureMemberLine(outcome, "owner/repo")).toBeNull();
	});
});

describe("bare-`failed` member-line severity (uniform red across layouts)", () => {
	// A bare `failed` member outcome (a per-member reinstall that threw, or a
	// group-fatal clone failure fanned out per member) must render at ERROR (red ✗)
	// severity on EVERY layout — the streamed multi-member path, the local path, and
	// the group-of-one collapsed spinner stop-frame — never the yellow warn glyph.
	// clack's spin.stop has no warn code, so the group-of-one collapse can only be
	// green or red; red is the honest choice, so the other paths normalise UP to red
	// (renderFailedOutcome emits p.log.error for `failed`). Exit accounting is
	// unchanged: `failed` still trips hasFailedOutcome → ExitSignal(1).

	it("renders a streamed multi-member `failed` via p.log.error (not p.log.warn)", async () => {
		// A 2-member collection → one group, one shared clone that SUCCEEDS. Member a
		// reinstalls cleanly (✓); member b's per-member symlink scan throws, propagating
		// to reinstallMember's defensive catch → a bare `failed` outcome with
		// cloneFailed === false, so it streams through emitMemberLine →
		// renderFailedOutcome (NOT the enumerated clone-failure line).
		captureSpinner();
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/a": makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/a/"],
			}),
			"owner/repo/b": makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/b/"],
			}),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "head",
			resolvedSha: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/clone",
			commit: REMOTE_SHA,
		});
		// b's per-member reinstall throws BEFORE the copy try/catch (a non-escape
		// error from the symlink scan) → a bare `failed` outcome (not copy-failed);
		// a succeeds.
		mockScanForEscapingSymlinks.mockImplementation(async (dir: unknown) => {
			if (typeof dir === "string" && dir.endsWith("/b")) {
				throw new Error("boom");
			}
		});
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/a/"],
		});

		// `failed` trips the non-zero exit; catch so assertions run.
		await runUpdate().catch(() => {});

		// The bare `failed` member renders RED via p.log.error…
		expect(mockLog.error).toHaveBeenCalledWith("owner/repo/b: Failed — boom");
		// …and never the yellow warn glyph.
		const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
		expect(warnCalls.some((m) => m.includes("Failed"))).toBe(false);
		// The successful sibling still streams its ✓ line under the shared header.
		expect(mockLog.success).toHaveBeenCalledWith("a");
	});

	it("renders a local `failed` red via p.log.error (not p.log.warn)", async () => {
		// A lone local entry (commit null) is streamed via streamLocalWork with NO
		// spinner. Its source path fails validation (stat rejects) → processLocalUpdate
		// returns a bare `failed` outcome → streamCollapsedOutcome → emitMemberLine →
		// renderFailedOutcome. It must render RED, matching the git layouts.
		const LOCAL_KEY = "/local/path";
		mockReadManifestOrExit.mockResolvedValue({
			[LOCAL_KEY]: {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/local/"],
				cloneUrl: null,
			},
		});
		// Local source path no longer exists → validateLocalSourcePath fails →
		// `failed` outcome carrying the "path does not exist" reason.
		mockStat.mockRejectedValue(new Error("ENOENT"));

		// `failed` trips the non-zero exit; catch so assertions run.
		await runUpdate().catch(() => {});

		expect(mockLog.error).toHaveBeenCalledWith(
			`${LOCAL_KEY}: Failed — ${LOCAL_KEY}: path does not exist`,
		);
		const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
		expect(warnCalls.some((m) => m.includes("Failed"))).toBe(false);
	});

	it("renders a group-of-one collapsed `failed` at error (spin.stop code 2), never warn — uniform with the other layouts", async () => {
		// A standalone repo → a group-of-one whose shared clone throws. It collapses to
		// ONE red spinner stop-frame at code 2 (clack has no warn code), NOT a separate
		// p.log.* line. This is the third layout: together with the streamed and local
		// paths above, a bare `failed` is now uniformly RED everywhere.
		const handle = captureSpinner();
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo": makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/solo/"],
			}),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "head",
			resolvedSha: REMOTE_SHA,
		});
		mockCloneSource.mockRejectedValue(new Error("git clone failed"));

		await runUpdate().catch(() => {});

		// The collapsed `failed` line IS the spinner stop-frame at code 2 (red ✗).
		expect(stopTexts(handle, 2)).toEqual([
			"owner/repo: Failed — git clone failed",
		]);
		// No warn glyph for the collapsed failure.
		const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
		expect(warnCalls.some((m) => m.includes("Failed"))).toBe(false);
	});
});

describe("update without a terminal", () => {
	function targetsByKey(targets: Record<string, GroupTarget>): void {
		mockResolveGroupTarget.mockImplementation(async ({ members: [first] }) => {
			const target = first && targets[first.key];
			if (!target) throw new Error(`no target for ${first?.key}`);
			return target;
		});
	}

	it("prints one document of every entry, a move carrying both ends, and never touches clack", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/caret": makeEntry({
				type: "skill",
				ref: "v1.0.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0.0",
				files: [".claude/skills/caret/"],
			}),
			"owner/pinned": makeEntry({ ref: "v3.0.0", commit: INSTALLED_SHA }),
		});
		targetsByKey({
			"owner/caret": {
				kind: "constrained",
				tag: "v1.1.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			},
			"owner/pinned": { kind: "tag", tag: "v3.0.0", newerTags: ["v3.1.0"] },
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/caret/"],
		});

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document).toEqual({
			ok: true,
			command: "update",
			scope: "project",
			items: [
				{
					key: "owner/caret",
					type: "skill",
					status: "updated",
					ref: "v1.1.0",
					commit: REMOTE_SHA,
					constraint: "^1.0.0",
					previousRef: "v1.0.0",
					previousCommit: INSTALLED_SHA,
					latestOutsideConstraint: "v2.0.0",
				},
				{
					key: "owner/pinned",
					type: "skill",
					status: "newer-tags",
					ref: "v3.0.0",
					commit: INSTALLED_SHA,
					constraint: null,
					newerTags: ["v3.1.0"],
				},
			],
			warnings: [],
			notes: [],
		});
		expect(clackCalls(p)).toEqual([]);
	});

	it("reports each entry when one fails, exiting 1", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/a": makeEntry({ commit: INSTALLED_SHA }),
			"owner/b": makeEntry({ commit: INSTALLED_SHA }),
		});
		targetsByKey({
			"owner/a": { kind: "head", resolvedSha: REMOTE_SHA },
			"owner/b": { kind: "head", resolvedSha: REMOTE_SHA },
		});
		mockCloneSource
			.mockRejectedValueOnce(new Error("network down"))
			.mockResolvedValueOnce({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/b/"],
		});

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document.ok).toBe(false);
		expect(run.document.items).toEqual([
			{
				key: "owner/a",
				type: "skill",
				status: "failed",
				ref: null,
				commit: INSTALLED_SHA,
				constraint: null,
				message: "owner/a: Failed — network down",
			},
			expect.objectContaining({ key: "owner/b", status: "updated" }),
		]);
	});

	it("reports a check that failed with its reason, and stays ok as all-mode does", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/a": makeEntry({ commit: INSTALLED_SHA }),
		});
		targetsByKey({ "owner/a": { kind: "check-failed", reason: "timeout" } });

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document).toMatchObject({
			ok: true,
			items: [{ key: "owner/a", status: "check-failed", reason: "timeout" }],
		});
	});

	it("carries a reinstall's note as a note", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/swift": makeEntry({
				type: "pack",
				files: [".claude/agents/openai.yaml"],
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
		mockDiscover.mockRejectedValue(
			new PackConflictError("single skill", "single-skill"),
		);
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/swift/"],
		});

		const run = await runMachine(updateCommand, []);

		expect(run.document.notes).toEqual([
			"owner/repo/swift is a single skill — reinstalled as a skill",
		]);
		expect(run.document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/swift", type: "skill" }),
		]);
	});

	describe("for one key", () => {
		it("prints the entry it updated", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: null, commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toEqual({
				ok: true,
				command: "update",
				scope: "project",
				items: [
					{
						key: "owner/repo",
						type: "skill",
						status: "updated",
						ref: null,
						commit: REMOTE_SHA,
						constraint: null,
						previousRef: null,
						previousCommit: INSTALLED_SHA,
					},
				],
				warnings: [],
				notes: [],
			});
			expect(clackCalls(p)).toEqual([]);
		});

		it("reports a failed check and exits 1, as at a terminal", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toMatchObject({
				ok: false,
				items: [
					{
						key: "owner/repo",
						status: "check-failed",
						reason: "network timeout",
					},
				],
			});
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("prints an error document for a key that isn't installed", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"other/plugin": makeEntry(),
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toEqual({
				ok: false,
				command: "update",
				scope: "project",
				error: { message: "owner/repo is not installed." },
				warnings: [],
				notes: [],
			});
		});
	});
});

describe("single-key update stopping at a failure", () => {
	it("still records the entries it updated before the failure", async () => {
		const goEntry = makeEntry({
			commit: INSTALLED_SHA,
			files: [".claude/skills/go/"],
		});
		const tsEntry = makeEntry({
			commit: INSTALLED_SHA,
			files: [".claude/skills/ts/"],
		});
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/go": goEntry,
			"owner/repo/ts": tsEntry,
		});
		mockCheckForUpdate
			.mockResolvedValueOnce({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			})
			.mockResolvedValueOnce({ status: "check-failed", reason: "timeout" });
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/go/"],
		});

		const err = await runUpdate("owner/repo").catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect((err as ExitSignal).code).toBe(1);
		expect(mockWriteManifest).toHaveBeenCalledTimes(1);
		expect(mockWriteManifest).toHaveBeenCalledWith(expect.any(String), {
			"owner/repo/go": expect.objectContaining({ commit: REMOTE_SHA }),
			"owner/repo/ts": tsEntry,
		});
	});
});

describe("an entry gone upstream", () => {
	const GONE_KEY = "owner/repo/go";

	function goneEntry(): ManifestEntry {
		return makeEntry({
			type: "skill",
			commit: INSTALLED_SHA,
			files: [".claude/skills/go/"],
		});
	}

	function looseEntry(name: string): ManifestEntry {
		return makeEntry({
			type: "skill",
			commit: INSTALLED_SHA,
			files: [`.claude/skills/${name}/`],
		});
	}

	/** go's SKILL.md is gone from the source and nothing named go turns up anywhere. */
	function arrangeGone(manifest: Manifest = { [GONE_KEY]: goneEntry() }): void {
		mockReadManifestOrExit.mockResolvedValue(manifest);
		mockCheckForUpdate.mockResolvedValue({
			status: "update-available",
			remoteCommit: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockAccess.mockImplementation(async (path: unknown) => {
			if (typeof path === "string" && path.endsWith("/go/SKILL.md")) {
				throw new Error("ENOENT");
			}
			return undefined;
		});
		rewalkFinds("skills/other");
	}

	function recordOrder(): string[] {
		const order: string[] = [];
		mockNukeManifestFiles.mockImplementation(async () => {
			order.push("nuke");
			return { removed: [], skipped: [] };
		});
		mockWriteManifest.mockImplementation(async () => {
			order.push("write");
		});
		return order;
	}

	describe("for one key at a terminal", () => {
		it("asks whether to remove it, no by default", async () => {
			arrangeGone();
			mockConfirm.mockResolvedValue(false);

			await runUpdate(GONE_KEY);

			expect(mockConfirm).toHaveBeenCalledExactlyOnceWith({
				message: "owner/repo/go is gone upstream — remove it?",
				initialValue: false,
			});
		});

		it("keeps its files and entry on no, says update will ask again, and exits 0", async () => {
			arrangeGone();
			mockConfirm.mockResolvedValue(false);

			const err = await runUpdate(GONE_KEY).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockLog.warn).toHaveBeenCalledWith(
				"Kept owner/repo/go — it's gone upstream; update will ask again",
			);
		});

		it("removes its files and then its entry on yes, and exits 0", async () => {
			const other = looseEntry("other");
			arrangeGone({ [GONE_KEY]: goneEntry(), "owner/other": other });
			mockConfirm.mockResolvedValue(true);
			const order = recordOrder();

			const err = await runUpdate(GONE_KEY).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/go/"],
			);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/other": other },
			);
			expect(order).toEqual(["nuke", "write"]);
			expect(mockLog.success).toHaveBeenCalledWith(
				"Removed owner/repo/go — it's gone upstream",
			);
		});

		it("removes it without asking under -y", async () => {
			arrangeGone();

			await runUpdate(GONE_KEY, { yes: true });

			expect(mockConfirm).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});

		it("treats a local entry the same way, its folder standing in for the repo", async () => {
			const localKey = "/Users/lee/Code/go";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/go/"],
				cloneUrl: null,
				type: "skill",
			};
			mockReadManifestOrExit.mockResolvedValue({ [localKey]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds();
			mockConfirm.mockResolvedValue(true);

			const err = await runUpdate(localKey).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockDiscover).toHaveBeenCalledWith(localKey, { rootName: "go" });
			expect(mockConfirm).toHaveBeenCalledWith({
				message: "/Users/lee/Code/go is gone upstream — remove it?",
				initialValue: false,
			});
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});
	});

	describe("in all-mode at a terminal", () => {
		it("asks only once the group's spinner has stopped, after the group's lines", async () => {
			const handle = captureSpinner();
			arrangeGone({ "owner/repo/a": looseEntry("a"), [GONE_KEY]: goneEntry() });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});
			mockConfirm.mockResolvedValue(false);

			await runUpdate();

			const asked = mockConfirm.mock.invocationCallOrder[0]!;
			const beforeAsking = (order: number[]) => order.filter((o) => o < asked);
			// The check spinner and the group's spinner both started and stopped
			// before the question, and no spinner starts after it.
			expect(beforeAsking(handle.start.mock.invocationCallOrder)).toHaveLength(
				2,
			);
			expect(beforeAsking(handle.stop.mock.invocationCallOrder)).toHaveLength(
				2,
			);
			expect(handle.start).toHaveBeenCalledTimes(2);
			expect(handle.stop).toHaveBeenLastCalledWith(
				"Updating owner/repo  aaaaaaa -> bbbbbbb  (2 members)",
			);
			// a's member line is out before the question; the answer follows it.
			expect(mockLog.success).toHaveBeenCalledWith("a");
			expect(mockLog.success.mock.invocationCallOrder[0]).toBeLessThan(asked);
			expect(mockLog.warn.mock.invocationCallOrder[0]).toBeGreaterThan(asked);
		});

		it("stops a group of one on its header before asking", async () => {
			const handle = captureSpinner();
			arrangeGone();
			mockConfirm.mockResolvedValue(false);

			await runUpdate();

			expect(handle.stop).toHaveBeenLastCalledWith("Updating owner/repo");
			expect(handle.stop.mock.invocationCallOrder.at(-1)).toBeLessThan(
				mockConfirm.mock.invocationCallOrder[0]!,
			);
		});

		it("keeps it on no and exits 0 while its sibling updates", async () => {
			const entryA = looseEntry("a");
			const gone = goneEntry();
			arrangeGone({ "owner/repo/a": entryA, [GONE_KEY]: gone });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});
			mockConfirm.mockResolvedValue(false);

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(written[GONE_KEY]).toEqual(gone);
			expect(written["owner/repo/a"]!.commit).toBe(REMOTE_SHA);
			expect(mockLog.warn).toHaveBeenCalledWith(
				"Kept owner/repo/go — it's gone upstream; update will ask again",
			);
		});

		it("removes its files and then its entry on yes", async () => {
			arrangeGone({ "owner/repo/a": looseEntry("a"), [GONE_KEY]: goneEntry() });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});
			mockConfirm.mockResolvedValue(true);

			const err = await runUpdate().catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(Object.keys(written)).toEqual(["owner/repo/a"]);
			expect(mockLog.success).toHaveBeenCalledWith(
				"Removed owner/repo/go — it's gone upstream",
			);
		});

		it("removes it without asking under -y", async () => {
			arrangeGone();

			await runUpdate(undefined, { yes: true });

			expect(mockConfirm).not.toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenLastCalledWith("/fake/project", {});
		});
	});

	describe("without a terminal", () => {
		const KEPT = {
			key: GONE_KEY,
			type: "skill",
			status: "gone-kept",
			ref: null,
			commit: INSTALLED_SHA,
			constraint: null,
			message:
				"Kept owner/repo/go — it's gone upstream; npx agntc update owner/repo/go -y removes it",
			flags: ["-y"],
		};

		it("keeps it without -y, naming the flag that removes it, and exits 0", async () => {
			arrangeGone();

			const run = await runMachine(updateCommand, [GONE_KEY]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toEqual({
				ok: true,
				command: "update",
				scope: "project",
				items: [KEPT],
				warnings: [],
				notes: [],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(clackCalls(p)).toEqual([]);
		});

		it("keeps it the same way in all-mode", async () => {
			arrangeGone();

			const run = await runMachine(updateCommand, []);

			expect(run.exitCode).toBe(0);
			expect(run.document).toMatchObject({ ok: true, items: [KEPT] });
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it.each([
			["one key", [GONE_KEY, "-y"]],
			["all-mode", ["--yes"]],
		])("removes it under -y (%s) and reports it removed", async (_mode, args) => {
			arrangeGone();

			const run = await runMachine(updateCommand, args);

			expect(run.exitCode).toBe(0);
			expect(run.document.items).toEqual([
				{
					key: GONE_KEY,
					type: "skill",
					status: "gone-removed",
					ref: null,
					commit: INSTALLED_SHA,
					constraint: null,
					message: "Removed owner/repo/go — it's gone upstream",
				},
			]);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});
	});
});

describe("a pack taking over loose skills from its own source", () => {
	const PACK_KEY = "owner/repo/tools";
	const TOOLS: FoundPack = {
		name: "tools",
		path: "tools",
		skills: [
			{ name: "a", path: "tools/skills/a" },
			{ name: "b", path: "tools/skills/b" },
		],
		assetDirs: [],
	};
	const NOTE = "owner/repo/tools now includes a, installed on its own before";

	function packEntry(): ManifestEntry {
		return makeEntry({
			type: "pack",
			commit: INSTALLED_SHA,
			files: [".claude/skills/b/"],
		});
	}

	function looseA(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
		return makeEntry({
			type: "skill",
			commit: INSTALLED_SHA,
			files: [".claude/skills/a/"],
			...overrides,
		});
	}

	/** The pack now holds a as well as b. */
	function arrangeTakeover(manifest: Manifest): void {
		mockReadManifestOrExit.mockResolvedValue(manifest);
		mockCheckForUpdate.mockResolvedValue({
			status: "update-available",
			remoteCommit: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockDiscover.mockResolvedValue(onlyPack(TOOLS));
		mockCopyPack.mockResolvedValue({
			copiedFiles: [".claude/skills/a/", ".claude/skills/b/"],
			assetCounts: { skills: 2 },
		});
	}

	it("all-mode updates the pack first, then skips the loose entry it took over in its group", async () => {
		arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });

		await runUpdate();

		expect(mockCloneSource).toHaveBeenCalledOnce();
		expect(mockCopyPack).toHaveBeenCalledOnce();
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
			"/fake/project",
			[".claude/skills/b/", ".claude/skills/a/"],
		);
		const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
		expect(Object.keys(written)).toEqual([PACK_KEY]);
		expect(written[PACK_KEY]!.files).toEqual([
			".claude/skills/a/",
			".claude/skills/b/",
		]);
		expect(mockLog.info).toHaveBeenCalledWith(NOTE);
	});

	it("all-mode skips a taken-over loose entry whose own group comes after the pack's", async () => {
		arrangeTakeover({
			[PACK_KEY]: packEntry(),
			"owner/repo/a": looseA({ ref: "main" }),
		});

		await runUpdate();

		// Two groups (head and main), but only the pack's ever clones.
		expect(mockCloneSource).toHaveBeenCalledOnce();
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
		expect(Object.keys(written)).toEqual([PACK_KEY]);
	});

	it("reports the loose entry as absorbed into the pack, with the pack's note", async () => {
		arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			{
				key: "owner/repo/a",
				type: "skill",
				status: "absorbed",
				ref: null,
				commit: INSTALLED_SHA,
				constraint: null,
				message: "owner/repo/a is now part of the pack owner/repo/tools",
			},
			expect.objectContaining({
				key: PACK_KEY,
				type: "pack",
				status: "updated",
			}),
		]);
		expect(run.document.notes).toEqual([NOTE]);
	});

	describe("when the pack's copy then fails", () => {
		const LOOSE_MESSAGE =
			"owner/repo/a was removed — the pack owner/repo/tools took it over, then failed to install";
		const PACK_MESSAGE =
			"Update failed for owner/repo/tools after removing old files, and the skill it took over was removed: owner/repo/a. It is currently uninstalled. Run `npx agntc add owner/repo/tools --pack` to install it again.";

		it("all-mode drops the loose entry with the pack's, since its files are gone", async () => {
			arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });
			mockCopyPack.mockRejectedValue(new Error("disk full"));

			const run = await runMachine(updateCommand, []);

			expect(run.exitCode).toBe(1);
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/b/", ".claude/skills/a/"],
			);
			expect(mockWriteManifest).toHaveBeenLastCalledWith("/fake/project", {});
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(run.document.items).toEqual([
				{
					key: "owner/repo/a",
					type: "skill",
					status: "absorbed",
					ref: null,
					commit: INSTALLED_SHA,
					constraint: null,
					message: LOOSE_MESSAGE,
				},
				{
					key: PACK_KEY,
					type: "pack",
					status: "copy-failed",
					ref: null,
					commit: INSTALLED_SHA,
					constraint: null,
					message: PACK_MESSAGE,
				},
			]);
			expect(run.document.notes).toEqual([]);
		});

		it("a key naming both drops the loose entry with the pack's", async () => {
			arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });
			mockCopyPack.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{},
			);
			expect(mockLog.error).toHaveBeenCalledWith(PACK_MESSAGE);
		});
	});

	it("a key naming both updates the pack and skips the loose entry", async () => {
		arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });

		await runUpdate("owner/repo");

		expect(mockCheckForUpdate).toHaveBeenCalledExactlyOnceWith(
			PACK_KEY,
			expect.anything(),
		);
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith("/fake/project", {
			[PACK_KEY]: expect.objectContaining({ commit: REMOTE_SHA }),
		});
		expect(mockLog.info).toHaveBeenCalledWith(NOTE);
	});

	it("aborts the pack, install intact, when its skills would land on another source's files", async () => {
		const other = looseA();
		arrangeTakeover({ [PACK_KEY]: packEntry(), "other/repo/a": other });
		mockResolveGroupTarget.mockImplementation(async ({ members: [first] }) =>
			first!.key === PACK_KEY
				? { kind: "head", resolvedSha: REMOTE_SHA }
				: { kind: "head", resolvedSha: INSTALLED_SHA },
		);

		const err = await runUpdate().catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockCopyPack).not.toHaveBeenCalled();
		expect(mockWriteManifest).not.toHaveBeenCalled();
	});

	it("names the other entry and its files when it aborts", async () => {
		arrangeTakeover({ [PACK_KEY]: packEntry(), "other/repo/a": looseA() });

		await runUpdate(PACK_KEY).catch(() => {});

		expect(mockLog.error).toHaveBeenCalledWith(
			"owner/repo/tools can't be updated: files of other/repo/a are in the way: .claude/skills/a/. The existing install is unchanged. Clear them and update again, or replace them: npx agntc remove owner/repo/tools then npx agntc add owner/repo/tools --pack --overwrite",
		);
	});

	it("aborts, install intact, when files agntc didn't install sit at a new skill's target", async () => {
		arrangeTakeover({ [PACK_KEY]: packEntry() });
		mockCheckUnmanaged.mockResolvedValue([".claude/skills/a/"]);

		const err = await runUpdate(PACK_KEY).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect(mockCheckUnmanaged).toHaveBeenCalledWith(
			[".claude/skills/a/", ".claude/skills/b/"],
			{ [PACK_KEY]: packEntry() },
			"/fake/project",
		);
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockCopyPack).not.toHaveBeenCalled();
		expect(mockWriteManifest).not.toHaveBeenCalled();
		expect(mockLog.error).toHaveBeenCalledWith(
			"owner/repo/tools can't be updated: files agntc didn't install are in the way: .claude/skills/a/. The existing install is unchanged. Clear them and update again, or replace them: npx agntc remove owner/repo/tools then npx agntc add owner/repo/tools --pack --overwrite",
		);
	});

	it("checks and names the remedy in the global scope for a global entry", async () => {
		arrangeTakeover({ [PACK_KEY]: packEntry() });
		mockCheckUnmanaged.mockResolvedValue([".claude/skills/a/"]);

		await runUpdate(PACK_KEY, {}, interactiveUi, GLOBAL).catch(() => {});

		expect(mockReadManifestOrExit).toHaveBeenCalledWith(HOME, interactiveUi);
		expect(mockCheckUnmanaged).toHaveBeenCalledWith(
			[".claude/skills/a/", ".claude/skills/b/"],
			{ [PACK_KEY]: packEntry() },
			HOME,
		);
		expect(mockLog.error).toHaveBeenCalledWith(
			expect.stringContaining(
				"replace them: npx agntc remove -g owner/repo/tools then npx agntc add -g owner/repo/tools --pack --overwrite",
			),
		);
	});
});

describe("a global update", () => {
	it("titles itself global", async () => {
		mockReadManifestOrExit.mockResolvedValue({});

		await runUpdate(undefined, {}, interactiveUi, GLOBAL);

		expect(vi.mocked(p.intro)).toHaveBeenCalledWith("agntc update · global");
		expect(mockReadManifestOrExit).toHaveBeenCalledWith(HOME, interactiveUi);
	});

	it("carries -g in a pinned key's upgrade command", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo": makeEntry({ ref: "v1.0" }),
		});
		mockCheckForUpdate.mockResolvedValue({
			status: "newer-tags",
			tags: ["v2.0", "v3.0"],
		});

		await runUpdate("owner/repo", {}, interactiveUi, GLOBAL);

		expect(mockOutro).toHaveBeenCalledWith(
			"To upgrade: npx agntc add -g owner/repo@v3.0",
		);
	});

	it("carries -g in a key's out-of-constraint upgrade command", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo": makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0.0",
			}),
		});
		mockCheckForUpdate.mockResolvedValue({
			status: "constrained-up-to-date",
			latestOverall: "v2.0.0",
		});

		await runUpdate("owner/repo", {}, interactiveUi, GLOBAL);

		expect(mockLog.info).toHaveBeenCalledWith(
			"  owner/repo  v1.2.3 -> v2.0.0 available. To upgrade: npx agntc add -g owner/repo",
		);
	});

	it("carries -g on every line of a pinned group's upgrade commands", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/a": makeEntry({ ref: "v1.0", commit: INSTALLED_SHA }),
			"owner/repo/tools": makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				type: "pack",
			}),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "tag",
			tag: "v1.0",
			newerTags: ["v3.0"],
		});

		await runUpdate(undefined, {}, interactiveUi, GLOBAL);

		expect(mockLog.info).toHaveBeenCalledWith(
			[
				"owner/repo: Pinned to v1.0 — newer tags available (latest: v3.0). To upgrade:",
				"    npx agntc add -g owner/repo/a@v3.0",
				"    npx agntc add -g owner/repo/tools@v3.0 --pack",
			].join("\n"),
		);
	});

	it("carries -g in a constrained group's out-of-constraint upgrade command", async () => {
		const member = () =>
			makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.2.3",
			});
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/a": member(),
			"owner/repo/b": member(),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "constrained",
			tag: "v1.2.3",
			commit: INSTALLED_SHA,
			latestOverall: "v2.0.0",
		});

		await runUpdate(undefined, {}, interactiveUi, GLOBAL);

		expect(mockLog.info).toHaveBeenCalledWith(
			"  owner/repo  v1.2.3 -> v2.0.0 available. To upgrade: npx agntc add -g owner/repo --skill a b",
		);
	});
});

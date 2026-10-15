import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest, ManifestEntry } from "../src/manifest.js";

vi.mock("@clack/prompts", () => ({
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	})),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
		message: vi.fn(),
	},
}));

vi.mock("../src/manifest.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/manifest.js")>()),
	writeManifest: vi.fn(),
	removeEntry: vi.fn(),
}));

vi.mock("../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/fs-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/fs-utils.js")>()),
	pathExists: vi.fn(),
}));

vi.mock("../src/copy-pack.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/copy-pack.js")>()),
	copyPack: vi.fn(),
}));

vi.mock("../src/discover.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/discover.js")>()),
	discover: vi.fn(),
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

import * as p from "@clack/prompts";
import type {
	CloneFailureHandlers,
	CloneReinstallResult,
} from "../src/clone-reinstall.js";
import {
	buildAbortMessage,
	buildCopySafetyMessage,
	cloneAndReinstall,
	cloneRepoOnce,
	failureMessage,
	isCloneReinstallFailure,
	mapCloneFailure,
	recordCopyFailure,
	recordReinstall,
} from "../src/clone-reinstall.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPack } from "../src/copy-pack.js";
import {
	assertSubpathWithinClone,
	PathTraversalError,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import { discover, PackConflictError } from "../src/discover.js";
import { pathExists } from "../src/fs-utils.js";
import { cleanupTempDir, cloneSource } from "../src/git-clone.js";
import { removeEntry, writeManifest } from "../src/manifest.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { projectScope } from "../src/scope.js";
import { resolveGuardedSourceDir } from "../src/source-parser.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockRemoveEntry = vi.mocked(removeEntry);

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPack = vi.mocked(copyPack);
const mockDiscover = vi.mocked(discover);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockPathExists = vi.mocked(pathExists);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);
const mockAssertSubpathWithinClone = vi.mocked(assertSubpathWithinClone);

import { interactiveUi } from "../src/ui.js";
import { makeEntry } from "./helpers/factories.js";

const REMOTE_SHA = "b".repeat(40);

beforeEach(() => {
	vi.clearAllMocks();
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockPathExists.mockResolvedValue(true);
	mockWriteManifest.mockResolvedValue(undefined);
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
	// Default no-op (real guard no-ops for contained subpaths); per-test bodies
	// override with a throwing impl to drive the traversal-rejection path.
	mockAssertSubpathWithinClone.mockImplementation(() => {});
	mockRemoveEntry.mockImplementation((manifest, key) => {
		const { [key]: _, ...rest } = manifest;
		return rest;
	});
});

describe("cloneAndReinstall", () => {
	describe("git (remote) path — success", () => {
		it("returns success with manifest entry and copied files", async () => {
			const entry = makeEntry({
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.commit).toBe(REMOTE_SHA);
				expect(result.copiedFiles).toEqual([".claude/skills/my-skill/"]);
			}
		});

		it("clones, nukes, copies in correct order", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
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
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-skill/"] };
			});

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(callOrder).toEqual(["clone", "nuke", "copy"]);
		});

		it("cleans up temp dir on success", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up temp dir on failure", async () => {
			const entry = makeEntry({ type: "skill" });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("uses spinner for clone", async () => {
			const entry = makeEntry();
			const mockSpinner = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
			vi.mocked(p.spinner).mockReturnValue(
				mockSpinner as ReturnType<typeof p.spinner>,
			);

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockSpinner.start).toHaveBeenCalledWith("Cloning repository...");
			expect(mockSpinner.stop).toHaveBeenCalledWith("Cloned successfully");
		});
	});

	describe("aborted status (derive-before-delete)", () => {
		/** The skill's SKILL.md is gone and two skills now carry its name. */
		function arrangeAmbiguousMove(name = "repo"): void {
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);
			mockDiscover.mockResolvedValue({
				packs: [],
				skills: [
					{ name, path: `a/${name}` },
					{ name, path: `b/${name}` },
				],
				strays: [],
			});
		}

		it("plumbs aborted up with its reason when several skills now carry the moved skill's name", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			arrangeAmbiguousMove();

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result).toMatchObject({
				status: "aborted",
				reason:
					"its SKILL.md is gone from repo and 2 skills are now named repo: a/repo, b/repo",
			});
		});

		it("does not nuke files when aborted", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			arrangeAmbiguousMove();

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("does not remove the manifest entry when aborted (install intact)", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			const manifest: Manifest = { "owner/repo": entry };
			arrangeAmbiguousMove();

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
					manifest,
				},
				interactiveUi,
				manifest,
			);

			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("cleans up temp dir on abort", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			arrangeAmbiguousMove();

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("member subdir vanished re-walks the clone and aborts on several matches", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/go/"],
			});
			arrangeAmbiguousMove("go");

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/go",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("aborted");
			expect(mockPathExists).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go/SKILL.md",
			);
			expect(mockDiscover).toHaveBeenCalledWith("/tmp/agntc-clone", {
				rootName: "repo",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("skills-only member with sourceSubpath relocates the source to skills/<name> (cycle-9)", async () => {
			// Regression: a skills-only inner skill is keyed by basename
			// (owner/repo/go) but its source lives at <clone>/skills/go. The stored
			// sourceSubpath must override the basename-key-derived dir so
			// derive-before-delete and the copy both target the relocated dir; without
			// the fix the SKILL.md check hits /tmp/agntc-clone/go and aborts.
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/go/"],
				sourceSubpath: "skills/go",
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/go",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("success");
			// Derive-before-delete checked the RELOCATED source, not the key-derived dir.
			expect(mockPathExists).toHaveBeenCalledWith(
				"/tmp/agntc-clone/skills/go/SKILL.md",
			);
			expect(mockPathExists).not.toHaveBeenCalledWith(
				"/tmp/agntc-clone/go/SKILL.md",
			);
			// The copy re-copied from the relocated dir.
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: "/tmp/agntc-clone/skills/go" }),
			);
			// sourceSubpath survives the update so the NEXT update still resolves right.
			if (result.status === "success") {
				expect(result.manifestEntry.sourceSubpath).toBe("skills/go");
			}
		});

		it("member WITHOUT sourceSubpath still resolves via the key-derived dir (cycle-9 fallback)", async () => {
			// A root-child member (owner/repo/go -> <clone>/go) carries no
			// sourceSubpath and must keep using the key-derived dir; the new branch
			// must not divert it.
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/go/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/go",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("success");
			expect(mockPathExists).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go/SKILL.md",
			);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: "/tmp/agntc-clone/go" }),
			);
			if (result.status === "success") {
				expect(result.manifestEntry.sourceSubpath).toBeUndefined();
			}
		});
	});

	describe("copy-failed status", () => {
		it("returns failed with copy-failed reason and recovery hint", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("copy-failed");
				expect(result.message).toContain("npx agntc add owner/repo");
			}
		});

		it("removes entry from manifest when manifest is provided", async () => {
			const entry = makeEntry();
			const manifest: Manifest = { "owner/repo": entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
					manifest,
				},
				interactiveUi,
				{},
			);

			expect(mockRemoveEntry).toHaveBeenCalledWith(manifest, "owner/repo");
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});

		it("does not write manifest when manifest is not provided", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("a removal that fails part way", () => {
		it("returns failed with remove-failed, copying nothing and keeping the entry recorded", async () => {
			const entry = makeEntry();
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockNukeManifestFiles.mockRejectedValue(
				new Error("EACCES: permission denied"),
			);

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
					manifest: { "owner/repo": entry },
				},
				interactiveUi,
				{},
			);

			expect(result).toEqual({
				status: "failed",
				failureReason: "remove-failed",
				message: "couldn't remove its old files: EACCES: permission denied",
			});
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("clone failure", () => {
		it("returns failed with clone-failed reason", async () => {
			const entry = makeEntry();

			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("clone-failed");
				expect(result.message).toContain("git clone failed");
			}
		});

		it("does not nuke on clone failure", async () => {
			const entry = makeEntry();

			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("local path (no clone)", () => {
		it("returns success without cloning for local entry", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({
				commit: null,
				ref: null,
				files: [".claude/skills/my-plugin/"],
			});

			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			const result = await cloneAndReinstall(
				{
					key,
					entry,
					scope: projectScope("/fake/project"),
					sourceDir: key,
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.commit).toBeNull();
				expect(result.manifestEntry.ref).toBeNull();
			}
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});

		it("reinstalls an item with a sourceSubpath from that path below the local folder", async () => {
			const entry = makeEntry({
				commit: null,
				ref: null,
				type: "skill",
				sourceSubpath: "skills/react/hooks",
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/hooks/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "/Users/lee/Code/skills/hooks",
					entry,
					scope: projectScope("/fake/project"),
					sourceDir: "/Users/lee/Code/skills",
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("success");
			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/Users/lee/Code/skills/skills/react/hooks",
				source: { root: "/Users/lee/Code/skills", local: true },
				projectDir: "/fake/project",
				skillName: "hooks",
			});
			expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
				"/Users/lee/Code/skills/skills/react/hooks",
				{ root: "/Users/lee/Code/skills", local: true },
				expect.any(Function),
			);
		});

		it("refuses a local sourceSubpath escaping the folder, leaving the install intact", async () => {
			const entry = makeEntry({
				commit: null,
				ref: null,
				sourceSubpath: "../evil",
			});
			mockAssertSubpathWithinClone.mockImplementation(() => {
				throw new PathTraversalError("../evil");
			});

			const result = await cloneAndReinstall(
				{
					key: "/Users/lee/Code/skills/evil",
					entry,
					scope: projectScope("/fake/project"),
					sourceDir: "/Users/lee/Code/skills",
				},
				interactiveUi,
				{},
			);

			expect(result).toMatchObject({
				status: "failed",
				failureReason: "clone-failed",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("reinstall note", () => {
		it("passes on the note of a pack entry reinstalled as a skill", async () => {
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

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/swift",
					entry: makeEntry({
						type: "pack",
						files: [".claude/agents/openai.yaml"],
					}),
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result).toMatchObject({
				status: "success",
				notes: ["owner/repo/swift is a single skill — reinstalled as a skill"],
				manifestEntry: { type: "skill" },
			});
		});

		it("hands back the key add gives what it reinstalled, when that moved", async () => {
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

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/packs/swift",
					entry: makeEntry({ type: "pack" }),
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/swift",
				manifestEntry: { type: "skill", sourceSubpath: "packs/swift" },
			});
		});

		it("carries no notes on a plain reinstall", async () => {
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry: makeEntry({ type: "skill" }),
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result).toMatchObject({ notes: [], absorbed: [] });
		});
	});

	describe("pack absorbing a loose skill from its own source", () => {
		it("reports the absorbed entry, removes its files and leaves dropping it to the caller", async () => {
			const pack = makeEntry({ type: "pack", files: [".claude/skills/api/"] });
			const loose = makeEntry({ files: [".claude/skills/queues/"] });
			const manifest: Manifest = {
				"owner/repo/laravel": pack,
				"owner/repo/queues": loose,
			};
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockDiscover.mockResolvedValue({
				packs: [
					{
						name: "laravel",
						path: "laravel",
						skills: [
							{ name: "api", path: "laravel/api" },
							{ name: "queues", path: "laravel/queues" },
						],
						supportFolders: [],
						assetDirs: [],
					},
				],
				skills: [],
				strays: [],
			});
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/api/", ".claude/skills/queues/"],
				assetCounts: { skills: 2 },
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/laravel",
					entry: pack,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				manifest,
			);

			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/api/", ".claude/skills/queues/"],
			);
			expect(result).toMatchObject({
				status: "success",
				absorbed: ["owner/repo/queues"],
				notes: [
					"owner/repo/laravel now includes queues, installed on its own before",
				],
			});
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("drops the absorbed entry with the pack's when the copy then fails", async () => {
			const pack = makeEntry({ type: "pack", files: [".claude/skills/api/"] });
			const loose = makeEntry({ files: [".claude/skills/queues/"] });
			const other = makeEntry({ files: [".claude/skills/other/"] });
			const manifest: Manifest = {
				"owner/repo/laravel": pack,
				"owner/repo/queues": loose,
				"other/repo": other,
			};
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockDiscover.mockResolvedValue({
				packs: [
					{
						name: "laravel",
						path: "laravel",
						skills: [
							{ name: "api", path: "laravel/api" },
							{ name: "queues", path: "laravel/queues" },
						],
						supportFolders: [],
						assetDirs: [],
					},
				],
				skills: [],
				strays: [],
			});
			mockCopyPack.mockRejectedValue(new Error("disk full"));

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/laravel",
					entry: pack,
					scope: projectScope("/fake/project"),
					manifest,
				},
				interactiveUi,
				manifest,
			);

			expect(result).toEqual({
				status: "failed",
				failureReason: "copy-failed",
				message:
					"Update failed for owner/repo/laravel after removing old files (disk full), and the skill it took over was removed: owner/repo/queues. It is currently uninstalled. Run `npx agntc add owner/repo/laravel --pack` to install it again.",
				absorbed: ["owner/repo/queues"],
			});
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "other/repo": other },
			);
		});
	});

	describe("gone status", () => {
		function arrangeGoneSkill(): void {
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);
			mockDiscover.mockResolvedValue({ packs: [], skills: [], strays: [] });
		}

		it("returns gone, touching nothing, when no skill of its name is left", async () => {
			const entry = makeEntry({ type: "skill" });
			const manifest: Manifest = { "owner/repo/go": entry };
			arrangeGoneSkill();

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/go",
					entry,
					scope: projectScope("/fake/project"),
					manifest,
				},
				interactiveUi,
				manifest,
			);

			expect(result).toEqual({ status: "gone" });
			expect(isCloneReinstallFailure(result)).toBe(false);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("returns gone for a local entry whose folder no longer holds the skill", async () => {
			mockPathExists.mockResolvedValue(false);
			mockDiscover.mockResolvedValue({ packs: [], skills: [], strays: [] });

			const result = await cloneAndReinstall(
				{
					key: "/src/kit",
					entry: makeEntry({ type: "skill", commit: null }),
					scope: projectScope("/fake/project"),
					sourceDir: "/src/kit",
				},
				interactiveUi,
				{},
			);

			expect(result).toEqual({ status: "gone" });
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockDiscover).toHaveBeenCalledWith("/src/kit", {
				rootName: "kit",
			});
		});
	});

	describe("newRef and newCommit overrides", () => {
		it("uses newRef when provided", async () => {
			const entry = makeEntry({ ref: "v1.0.0" });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					scope: projectScope("/fake/project"),
					newRef: "v2.0.0",
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.ref).toBe("v2.0.0");
			}
		});

		it.each([
			["a branch entry stays on its branch", "dev"],
			["a HEAD-tracked entry stays on HEAD", null],
		])("keeps the recorded ref without a newRef: %s, at the clone's commit", async (_, ref) => {
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry: makeEntry({ ref }),
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref }),
			);
			expect(result).toMatchObject({
				status: "success",
				manifestEntry: { ref, commit: REMOTE_SHA },
			});
		});
	});

	describe("collection key", () => {
		it("resolves sourceDir from key when key has 3+ segments", async () => {
			const entry = makeEntry({
				files: [".claude/skills/go/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/go",
					entry,
					scope: projectScope("/fake/project"),
				},
				interactiveUi,
				{},
			);

			expect(result.status).toBe("success");
			// The recorded-skill validation gate reads the subdir
			expect(mockPathExists).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go/SKILL.md",
			);
		});

		describe("symlink-escape pre-flight (update re-copy)", () => {
			it("clone mode scans sourceDir against the clone root (tempDir)", async () => {
				const entry = makeEntry({ type: "skill" });

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-skill/"],
				});

				await cloneAndReinstall(
					{
						key: "owner/repo",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					"/tmp/agntc-clone",
					{ root: "/tmp/agntc-clone", local: false },
					expect.any(Function),
				);
			});

			it("member subdir is scanned against the clone root (tempDir), not the subdir", async () => {
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/go/"],
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/go/"],
				});

				await cloneAndReinstall(
					{
						key: "owner/repo/go",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					"/tmp/agntc-clone/go",
					{ root: "/tmp/agntc-clone", local: false },
					expect.any(Function),
				);
			});

			it("local-path mode scans against the provided source root (cloneRoot === sourceDir)", async () => {
				const key = "/Users/lee/Code/my-plugin";
				const entry = makeEntry({
					commit: null,
					ref: null,
					files: [".claude/skills/my-plugin/"],
				});

				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-plugin/"],
				});

				await cloneAndReinstall(
					{
						key,
						entry,
						scope: projectScope("/fake/project"),
						sourceDir: key,
					},
					interactiveUi,
					{},
				);

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					key,
					{ root: key, local: true },
					expect.any(Function),
				);
			});

			it("escaping symlink blocks before nuke (install intact, no copy, non-zero pre-flight failure)", async () => {
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/my-skill/"],
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
				);

				const result = await cloneAndReinstall(
					{
						key: "owner/repo",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(result.status).toBe("blocked");
				if (result.status === "blocked") {
					expect(result.reason).toContain("evil-link");
				}
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockCopyPack).not.toHaveBeenCalled();
			});

			it("does NOT remove the manifest entry on symlink violation (distinct from copy-failed)", async () => {
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/my-skill/"],
				});
				const manifest: Manifest = { "owner/repo": entry };

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
				);

				await cloneAndReinstall(
					{
						key: "owner/repo",
						entry,
						scope: projectScope("/fake/project"),
						manifest,
					},
					interactiveUi,
					{},
				);

				expect(mockRemoveEntry).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});

			it("surfaces the violation as a named pre-flight failure via mapCloneFailure (onBlocked)", async () => {
				mockDiscover.mockResolvedValue({
					packs: [
						{
							name: "repo",
							path: "",
							skills: [{ name: "my-skill", path: "skills/my-skill" }],
							supportFolders: [],
							assetDirs: [],
						},
					],
					skills: [],
					strays: [],
				});
				const entry = makeEntry({
					type: "pack",
					files: [".claude/skills/my-skill/"],
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
				);

				const result = await cloneAndReinstall(
					{
						key: "owner/repo",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(result.status).toBe("blocked");
				if (result.status !== "blocked") return;

				const mapped = mapCloneFailure(result, {
					onCloneFailed: () => "clone-failed",
					onCopyFailed: () => "copy-failed",
					onAborted: () => "aborted",
					onBlocked: (reason) => `blocked:${reason}`,
					onRemoveFailed: () => "remove-failed",
				});
				expect(mapped).toBe(`blocked:${result.reason}`);
				expect(mapped).toContain("evil-link");
			});

			it("guards the key-derived subpath when no sourceSubpath is recorded", async () => {
				const entry = makeEntry({ type: "skill" });

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-skill/"],
				});

				await cloneAndReinstall(
					{
						key: "owner/repo/my-skill",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
					"/tmp/agntc-clone",
					"my-skill",
				);
			});

			it("rejects a recorded sourceSubpath that lexically escapes the clone (analysis 10-2)", async () => {
				// Defense-in-depth parity with add's step-2c pre-flight: the cycle-9
				// source-derived `sourceSubpath` segment must be lexically contained
				// BEFORE the join is read. A `..`-escaping value is rejected as a clean
				// clone-failed pre-flight result — no nuke, no copy, install intact.
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/my-skill/"],
					sourceSubpath: "../evil",
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockAssertSubpathWithinClone.mockImplementation(() => {
					throw new PathTraversalError("../evil");
				});

				const result = await cloneAndReinstall(
					{
						key: "owner/repo/evil",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
					"/tmp/agntc-clone",
					"../evil",
				);
				expect(result.status).toBe("failed");
				if (result.status === "failed") {
					expect(result.failureReason).toBe("clone-failed");
					expect(result.message).toContain("../evil");
					expect(result.message).toContain("outside the clone root");
				}
				// Pre-flight: the guard precedes the source read, nuke, and copy.
				expect(mockPathExists).not.toHaveBeenCalled();
				expect(mockScanForEscapingSymlinks).not.toHaveBeenCalled();
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockCopyPack).not.toHaveBeenCalled();
			});

			it("does NOT remove the manifest entry on a sourceSubpath traversal (install intact)", async () => {
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/my-skill/"],
					sourceSubpath: "../evil",
				});
				const manifest: Manifest = { "owner/repo/evil": entry };

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockAssertSubpathWithinClone.mockImplementation(() => {
					throw new PathTraversalError("../evil");
				});

				await cloneAndReinstall(
					{
						key: "owner/repo/evil",
						entry,
						scope: projectScope("/fake/project"),
						manifest,
					},
					interactiveUi,
					{},
				);

				expect(mockRemoveEntry).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});

			it("a contained sourceSubpath (skills/<name>) passes the guard and reinstalls", async () => {
				// The guard is a no-op for a contained subpath (real assertSubpath
				// returns void); the cycle-9 relocation still resolves and copies.
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/go/"],
					sourceSubpath: "skills/go",
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/go/"],
				});

				const result = await cloneAndReinstall(
					{
						key: "owner/repo/go",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				// Guard invoked against the clone root with the recorded subpath.
				expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
					"/tmp/agntc-clone",
					"skills/go",
				);
				expect(result.status).toBe("success");
				expect(mockCopyBareSkill).toHaveBeenCalledWith(
					expect.objectContaining({ sourceDir: "/tmp/agntc-clone/skills/go" }),
				);
			});

			it("clean re-cloned tree (no escaping symlink) updates normally", async () => {
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/my-skill/"],
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockResolvedValue(undefined);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-skill/"],
				});

				const result = await cloneAndReinstall(
					{
						key: "owner/repo",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(result.status).toBe("success");
				expect(mockNukeManifestFiles).toHaveBeenCalled();
				expect(mockCopyBareSkill).toHaveBeenCalledOnce();
			});

			it("no nuke or copy runs on violation (counts stay 0)", async () => {
				const entry = makeEntry({ type: "skill" });

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil", "../escape"),
				);

				await cloneAndReinstall(
					{
						key: "owner/repo",
						entry,
						scope: projectScope("/fake/project"),
					},
					interactiveUi,
					{},
				);

				expect(mockNukeManifestFiles).toHaveBeenCalledTimes(0);
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(0);
				expect(mockCopyPack).toHaveBeenCalledTimes(0);
			});
		});
	});
});

describe("resolveGuardedSourceDir error discrimination", () => {
	// The shared helper's PathTraversalError-vs-rethrow discrimination — the
	// single security invariant both clone entry points now compose. Driven here
	// against the mocked guard so a non-PathTraversalError can be injected.

	it("narrows a PathTraversalError to a { ok: false } result carrying the message verbatim", () => {
		mockAssertSubpathWithinClone.mockImplementation(() => {
			throw new PathTraversalError("../evil");
		});

		const result = resolveGuardedSourceDir(
			"/tmp/agntc-clone",
			"owner/repo/evil",
			"../evil",
		);

		expect(result).toEqual({
			ok: false,
			message: 'subpath "../evil" resolves outside the clone root',
		});
	});

	it("RETHROWS a non-PathTraversalError from the guard (never swallowed as a failure result)", () => {
		mockAssertSubpathWithinClone.mockImplementation(() => {
			throw new Error("disk exploded");
		});

		expect(() =>
			resolveGuardedSourceDir("/tmp/agntc-clone", "owner/repo/x", "skills/x"),
		).toThrow("disk exploded");
	});
});

describe("cloneRepoOnce", () => {
	it("returns tempDir and commit from cloneSource", async () => {
		const entry = makeEntry({ ref: "v1.0.0" });
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});

		const result = await cloneRepoOnce({ key: "owner/repo", entry });

		expect(result).toEqual({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		// No override → the stored entry.ref reaches the parsed source (clone --branch).
		expect(mockCloneSource).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "v1.0.0" }),
		);
	});

	it("passes newRef as the clone --branch override when provided", async () => {
		const entry = makeEntry({ ref: "v1.0.0" });
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});

		await cloneRepoOnce({ key: "owner/repo", entry, newRef: "v2.0.0" });

		// The constrained resolved-tag override wins over entry.ref.
		expect(mockCloneSource).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "v2.0.0" }),
		);
	});

	it("rethrows when cloneSource rejects (retry is internal, throw is final)", async () => {
		const entry = makeEntry();
		mockCloneSource.mockRejectedValue(new Error("git clone failed"));

		await expect(cloneRepoOnce({ key: "owner/repo", entry })).rejects.toThrow(
			"git clone failed",
		);
	});
});

describe("mapCloneFailure", () => {
	function makeHandlers(): CloneFailureHandlers<string> {
		return {
			onCloneFailed: (msg) => `clone-failed: ${msg}`,
			onCopyFailed: (msg) => `copy-failed: ${msg}`,
			onAborted: ({ reason, inTheWay }) =>
				`aborted${inTheWay ? " (in the way)" : ""}: ${reason}`,
			onBlocked: (reason) => `blocked: ${reason}`,
			onRemoveFailed: (msg) => `remove-failed: ${msg}`,
		};
	}

	it("dispatches clone-failed to onCloneFailed handler", () => {
		const result = mapCloneFailure(
			{
				status: "failed",
				failureReason: "clone-failed",
				message: "network error",
			},
			makeHandlers(),
		);
		expect(result).toBe("clone-failed: network error");
	});

	it("dispatches copy-failed to onCopyFailed handler", () => {
		const result = mapCloneFailure(
			{
				status: "failed",
				failureReason: "copy-failed",
				message: "disk full",
				absorbed: [],
			},
			makeHandlers(),
		);
		expect(result).toBe("copy-failed: disk full");
	});

	it("dispatches remove-failed to onRemoveFailed handler", () => {
		const result = mapCloneFailure(
			{
				status: "failed",
				failureReason: "remove-failed",
				message: "couldn't remove its old files: EACCES",
			},
			makeHandlers(),
		);
		expect(result).toBe("remove-failed: couldn't remove its old files: EACCES");
	});

	it("dispatches aborted (via status, no failureReason) to onAborted handler with its cause", () => {
		const result = mapCloneFailure(
			{ status: "aborted", reason: "its folder now contains packs" },
			makeHandlers(),
		);
		expect(result).toBe("aborted: its folder now contains packs");
	});

	it("passes on that files in the way caused the abort", () => {
		const result = mapCloneFailure(
			{ status: "aborted", reason: "files are in the way", inTheWay: true },
			makeHandlers(),
		);
		expect(result).toBe("aborted (in the way): files are in the way");
	});

	it("dispatches blocked (via status, no failureReason) to onBlocked handler with reason", () => {
		const result = mapCloneFailure(
			{
				status: "blocked",
				reason:
					'symlink "evil-link" points outside the clone (target: /etc/passwd)',
			},
			makeHandlers(),
		);
		expect(result).toBe(
			'blocked: symlink "evil-link" points outside the clone (target: /etc/passwd)',
		);
	});

	it("returns the typed result from handler", () => {
		const handlers: CloneFailureHandlers<number> = {
			onCloneFailed: () => 1,
			onCopyFailed: () => 5,
			onAborted: () => 7,
			onBlocked: () => 8,
			onRemoveFailed: () => 6,
		};
		const result = mapCloneFailure(
			{ status: "blocked", reason: "test" },
			handlers,
		);
		expect(result).toBe(8);
	});
});

describe("isCloneReinstallFailure", () => {
	it("returns true for a failed result", () => {
		const result: CloneReinstallResult = {
			status: "failed",
			failureReason: "clone-failed",
			message: "network error",
		};
		expect(isCloneReinstallFailure(result)).toBe(true);
	});

	it("returns true for an aborted result", () => {
		const result: CloneReinstallResult = {
			status: "aborted",
			reason: "its folder now contains packs",
		};
		expect(isCloneReinstallFailure(result)).toBe(true);
	});

	it("returns false for a gone result, which is no failure", () => {
		const result: CloneReinstallResult = { status: "gone" };
		expect(isCloneReinstallFailure(result)).toBe(false);
	});

	it("returns true for a blocked result", () => {
		const result: CloneReinstallResult = {
			status: "blocked",
			reason:
				'symlink "evil-link" points outside the clone (target: /etc/passwd)',
		};
		expect(isCloneReinstallFailure(result)).toBe(true);
	});

	it("returns false for a success result", () => {
		const result: CloneReinstallResult = {
			status: "success",
			key: "owner/repo",
			manifestEntry: makeEntry(),
			copiedFiles: [".claude/skills/my-skill/"],
			notes: [],
			absorbed: [],
		};
		expect(isCloneReinstallFailure(result)).toBe(false);
	});

	it("narrows result to the failure union accepted by mapCloneFailure", () => {
		const result: CloneReinstallResult = {
			status: "aborted",
			reason: "its folder now contains packs",
		};
		// Type-level: after the guard, result must satisfy mapCloneFailure's param.
		if (isCloneReinstallFailure(result)) {
			const mapped = mapCloneFailure(result, {
				onCloneFailed: () => "clone",
				onCopyFailed: () => "copy",
				onAborted: () => "aborted",
				onBlocked: () => "blocked",
				onRemoveFailed: () => "remove-failed",
			});
			expect(mapped).toBe("aborted");
		}
	});
});

describe("failureMessage", () => {
	it("returns the failure's own message for clone-failed", () => {
		const msg = failureMessage(
			{
				status: "failed",
				failureReason: "clone-failed",
				message: "network error",
			},
			"owner/repo",
			makeEntry(),
			"project",
		);
		expect(msg).toBe("network error");
	});

	it("returns the failure's own message for copy-failed", () => {
		const msg = failureMessage(
			{
				status: "failed",
				failureReason: "copy-failed",
				message: "disk full hint",
				absorbed: [],
			},
			"owner/repo",
			makeEntry(),
			"project",
		);
		expect(msg).toBe("disk full hint");
	});

	it("returns the failure's own message for remove-failed", () => {
		const msg = failureMessage(
			{
				status: "failed",
				failureReason: "remove-failed",
				message: "couldn't remove its old files: EACCES",
			},
			"owner/repo",
			makeEntry(),
			"project",
		);
		expect(msg).toBe("couldn't remove its old files: EACCES");
	});

	it("returns buildAbortMessage output for aborted", () => {
		const reason = "its folder now contains packs";
		const entry = makeEntry({ type: "pack" });
		const msg = failureMessage(
			{ status: "aborted", reason },
			"owner/repo",
			entry,
			"project",
		);
		expect(msg).toBe(
			buildAbortMessage("owner/repo", entry, { reason }, "project"),
		);
	});

	it("returns buildCopySafetyMessage output for blocked", () => {
		const reason =
			'symlink "evil-link" points outside the clone (target: /etc/passwd)';
		const msg = failureMessage(
			{ status: "blocked", reason },
			"owner/repo",
			makeEntry(),
			"project",
		);
		expect(msg).toBe(buildCopySafetyMessage("owner/repo", reason));
	});
});

describe("buildCopySafetyMessage", () => {
	const reason =
		'symlink "evil-link" points outside the clone (target: /etc/passwd)';

	it("names the source key", () => {
		expect(buildCopySafetyMessage("owner/repo", reason)).toContain(
			"owner/repo",
		);
	});

	it("carries the escape reason verbatim", () => {
		expect(buildCopySafetyMessage("owner/repo", reason)).toContain(reason);
	});

	it("states the update is blocked and the existing install is left intact", () => {
		const msg = buildCopySafetyMessage("owner/repo", reason);
		expect(msg).toContain("blocked");
		expect(msg).toContain("unchanged");
	});

	it("does NOT use the type-migration wording or the remove+add remedy", () => {
		const msg = buildCopySafetyMessage("owner/repo", reason);
		expect(msg).not.toContain("no longer supports that type");
		expect(msg).not.toContain("npx agntc remove");
		expect(msg).not.toContain("To migrate");
	});

	it("doesn't call a link on the item's path an escape, as it may stay inside the clone", () => {
		const onPath =
			'symlink "skills/foo" is on the path to skills/foo — agntc won\'t copy through it';

		expect(buildCopySafetyMessage("owner/repo/foo", onPath)).toBe(
			`owner/repo/foo: ${onPath}. agntc won't follow that symlink, so the update is blocked. The existing install is unchanged.`,
		);
	});

	it("describes a symlink escaping the clone (consistent with abort being a different concern)", () => {
		const msg = buildCopySafetyMessage("owner/repo", reason);
		expect(msg.toLowerCase()).toContain("symlink");
		// Guard against accidental reuse of the derive-before-delete framing.
		expect(msg).not.toBe(
			buildAbortMessage("owner/repo", makeEntry(), { reason }, "project"),
		);
	});

	it("mirrors the add path's identity-prefixed framing (key: <escape reason> ...)", () => {
		// The add path reports the escape as `${manifestKey}: ${err.message}` where
		// err.message is the SymlinkEscapeError text ("...points outside the clone...").
		// The update copy-safety message must lead with the same identity-prefixed
		// escape framing so both paths read consistently.
		const escapeMessage =
			'symlink "evil-link" points outside the clone (target: /etc/passwd)';
		const addFraming = `owner/repo: ${escapeMessage}`;
		const updateMsg = buildCopySafetyMessage("owner/repo", escapeMessage);
		expect(updateMsg.startsWith(addFraming)).toBe(true);
		expect(updateMsg).toContain("points outside the clone");
	});
});

describe("buildAbortMessage", () => {
	it("names the recorded type and the cause, and keeps the install", () => {
		const msg = buildAbortMessage(
			"owner/repo/laravel",
			makeEntry({ type: "pack" }),
			{ reason: "its folder now contains packs" },
			"project",
		);

		expect(msg).toBe(
			"owner/repo/laravel was installed as a pack and can't be updated (its folder now contains packs). The existing install is unchanged. To migrate: npx agntc remove owner/repo/laravel then npx agntc add owner/repo/laravel --pack",
		);
	});

	it("offers no re-add when two of the source's folders install to one place, which add would refuse too", () => {
		const msg = buildAbortMessage(
			"owner/repo/laravel",
			makeEntry({ type: "pack" }),
			{
				reason:
					"laravel/skills/back/refs and laravel/skills/front/refs would both install to .claude/skills/refs",
				sourceClash: true,
			},
			"project",
			"v2.0.0",
		);

		expect(msg).toBe(
			"owner/repo/laravel can't be updated: in its source, laravel/skills/back/refs and laravel/skills/front/refs would both install to .claude/skills/refs, so it can't be installed as it stands. The existing install is left as it is.",
		);
	});

	it("re-adds a skill from its recorded path, not its key", () => {
		const msg = buildAbortMessage(
			"owner/repo/go",
			makeEntry({ type: "skill", sourceSubpath: "skills/go" }),
			{ reason: "two skills are named go" },
			"project",
		);

		expect(msg).toContain(
			"npx agntc remove owner/repo/go then npx agntc add owner/repo/skills/go",
		);
		expect(msg).not.toContain("--pack");
	});

	it("re-adds the item as replayed, under its new key, while removing the entry as installed", () => {
		const msg = buildAbortMessage(
			"owner/repo/packs/foo",
			makeEntry({ type: "pack" }),
			{
				reason:
					"files agntc didn't install are in the way: .claude/skills/foo/",
				inTheWay: true,
				replayed: {
					key: "owner/repo/foo",
					entry: makeEntry({ type: "skill", sourceSubpath: "packs/foo" }),
				},
			},
			"project",
		);

		expect(msg).toContain(
			"replace them: npx agntc remove owner/repo/packs/foo then npx agntc add owner/repo/packs/foo --overwrite",
		);
		expect(msg).not.toContain("--pack");
	});

	it("points files in the way at clearing them, or at a re-add with --overwrite", () => {
		const msg = buildAbortMessage(
			"owner/repo/laravel",
			makeEntry({ type: "pack" }),
			{
				reason:
					"files agntc didn't install are in the way: .claude/skills/queues/",
				inTheWay: true,
			},
			"project",
		);

		expect(msg).toBe(
			"owner/repo/laravel can't be updated: files agntc didn't install are in the way: .claude/skills/queues/. The existing install is unchanged. Clear them and update again, or replace them: npx agntc remove owner/repo/laravel then npx agntc add owner/repo/laravel --pack --overwrite",
		);
		expect(msg).not.toContain("To migrate");
	});

	it("quotes a local key with a space in both commands", () => {
		const key = "/src/My Skills/go";

		expect(
			buildAbortMessage(
				key,
				makeEntry({ type: "skill", commit: null, localRoot: "/src/My Skills" }),
				{ reason: "files are in the way", inTheWay: true },
				"project",
			),
		).toContain(
			"replace them: npx agntc remove '/src/My Skills/go' then npx agntc add '/src/My Skills/go' --overwrite",
		);
	});

	it("carries -g on both commands for a global entry", () => {
		const pack = makeEntry({ type: "pack" });

		expect(
			buildAbortMessage(
				"owner/repo/laravel",
				pack,
				{ reason: "its folder now contains packs" },
				"global",
			),
		).toContain(
			"To migrate: npx agntc remove -g owner/repo/laravel then npx agntc add -g owner/repo/laravel --pack",
		);
		expect(
			buildAbortMessage(
				"owner/repo/laravel",
				pack,
				{ reason: "files are in the way", inTheWay: true },
				"global",
			),
		).toContain(
			"replace them: npx agntc remove -g owner/repo/laravel then npx agntc add -g owner/repo/laravel --pack --overwrite",
		);
	});
});

describe("buildAbortMessage for a key another entry holds", () => {
	it.each([
		[
			"project",
			"owner/repo/packs/foo can't be updated: it would move to owner/repo/foo, which is already installed. The existing install is unchanged. To replace that entry with it: npx agntc remove owner/repo/foo then npx agntc update owner/repo/packs/foo",
		],
		[
			"global",
			"owner/repo/packs/foo can't be updated: it would move to owner/repo/foo, which is already installed. The existing install is unchanged. To replace that entry with it: npx agntc remove -g owner/repo/foo then npx agntc update -g owner/repo/packs/foo",
		],
	] as const)("names both keys and frees the taken one, in %s scope", (scope, message) => {
		expect(
			buildAbortMessage(
				"owner/repo/packs/foo",
				makeEntry({ type: "pack" }),
				{
					reason: "it would move to owner/repo/foo, which is already installed",
					takenKey: "owner/repo/foo",
				},
				scope,
			),
		).toBe(message);
	});
});

describe("buildAbortMessage for folders still in the source", () => {
	const cause = {
		reason:
			"it would remove workflow-shared and workflow-gates, which are still in the source but would no longer be installed",
		stillInSource: true,
		replayed: {
			key: "owner/repo",
			entry: makeEntry({ type: "pack", ref: "v1.4.0", constraint: "^1.2.0" }),
		},
	} as const;
	const entry = makeEntry({
		type: "pack",
		ref: "v1.3.0",
		constraint: "^1.2.0",
	});

	it.each([
		[
			"project",
			"owner/repo can't be updated: it would remove workflow-shared and workflow-gates, which are still in the source but would no longer be installed. The existing install is unchanged. To update it anyway: npx agntc remove owner/repo then npx agntc add 'owner/repo@^1.2.0' --pack",
		],
		[
			"global",
			"owner/repo can't be updated: it would remove workflow-shared and workflow-gates, which are still in the source but would no longer be installed. The existing install is unchanged. To update it anyway: npx agntc remove -g owner/repo then npx agntc add -g 'owner/repo@^1.2.0' --pack",
		],
	] as const)("names the folders and updates it anyway by a remove and re-add, in %s scope", (scope, message) => {
		expect(buildAbortMessage("owner/repo", entry, cause, scope)).toBe(message);
	});

	it("re-adds at the tag a version change picked", () => {
		expect(
			buildAbortMessage("owner/repo", entry, cause, "project", "v2.0.0"),
		).toBe(
			"owner/repo can't be updated: it would remove workflow-shared and workflow-gates, which are still in the source but would no longer be installed. The existing install is unchanged. To update it anyway: npx agntc remove owner/repo then npx agntc add owner/repo@v2.0.0 --pack",
		);
	});
});

describe("buildAbortMessage keeps the version the entry tracks", () => {
	it("re-adds a constrained entry on its constraint", () => {
		expect(
			buildAbortMessage(
				"owner/repo/laravel",
				makeEntry({ type: "pack", ref: "v1.4.0", constraint: "^1.2.0" }),
				{ reason: "files are in the way", inTheWay: true },
				"project",
			),
		).toContain(
			"replace them: npx agntc remove owner/repo/laravel then npx agntc add 'owner/repo/laravel@^1.2.0' --pack --overwrite",
		);
	});

	it("re-adds an entry tracking a branch on that branch", () => {
		expect(
			buildAbortMessage(
				"owner/repo/laravel",
				makeEntry({ type: "pack", ref: "main" }),
				{ reason: "its folder now contains packs" },
				"project",
			),
		).toContain(
			"To migrate: npx agntc remove owner/repo/laravel then npx agntc add owner/repo/laravel@main --pack",
		);
	});

	it("re-adds an entry on HEAD bare", () => {
		expect(
			buildAbortMessage(
				"owner/repo/laravel",
				makeEntry({ type: "pack", ref: null }),
				{ reason: "its folder now contains packs" },
				"project",
			),
		).toMatch(/then npx agntc add owner\/repo\/laravel --pack$/);
	});
});

describe("buildAbortMessage for a version change", () => {
	const replayed = {
		key: "owner/repo/foo",
		entry: makeEntry({
			type: "skill",
			ref: "v2.0.0",
			sourceSubpath: "packs/foo",
		}),
	};

	it("frees a taken key, then changes the version again, which an update wouldn't do", () => {
		expect(
			buildAbortMessage(
				"owner/repo/packs/foo",
				makeEntry({ type: "pack", ref: "v1.0.0" }),
				{
					reason: "it would move to owner/repo/foo, which is already installed",
					takenKey: "owner/repo/foo",
					replayed,
				},
				"project",
				"v2.0.0",
			),
		).toBe(
			"owner/repo/packs/foo can't be updated: it would move to owner/repo/foo, which is already installed. The existing install is unchanged. To replace that entry with it: npx agntc remove owner/repo/foo then change it to v2.0.0 again",
		);
	});

	it("changes the version again once files in the way are cleared, or re-adds at that version", () => {
		expect(
			buildAbortMessage(
				"owner/repo/packs/foo",
				makeEntry({ type: "pack", ref: "v1.0.0" }),
				{ reason: "files are in the way", inTheWay: true, replayed },
				"project",
				"v2.0.0",
			),
		).toBe(
			"owner/repo/packs/foo can't be updated: files are in the way. The existing install is unchanged. Clear them and change it to v2.0.0 again, or replace them: npx agntc remove owner/repo/packs/foo then npx agntc add owner/repo/packs/foo@v2.0.0 --overwrite",
		);
	});
});

describe("buildAbortMessage for a skill several skills now carry the name of", () => {
	/** Updates `key` from a source where its SKILL.md is gone and `go` sits at lang/go and tools/go. */
	async function abortMessage(
		key: string,
		entry: ManifestEntry,
		{
			sourceDir,
			newRef,
			version,
		}: { sourceDir?: string; newRef?: string; version?: string } = {},
	): Promise<string> {
		const name = key.split("/").at(-1) ?? "";
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockPathExists.mockResolvedValue(false);
		mockDiscover.mockResolvedValue({
			packs: [],
			skills: [
				{ name, path: `tools/${name}` },
				{ name, path: `lang/${name}` },
			],
			strays: [],
		});

		const result = await cloneAndReinstall(
			{
				key,
				entry,
				scope: projectScope("/fake/project"),
				...(sourceDir !== undefined ? { sourceDir } : {}),
				...(newRef !== undefined ? { newRef } : {}),
			},
			interactiveUi,
			{ [key]: entry },
		);

		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		if (!isCloneReinstallFailure(result)) {
			throw new Error(`expected an abort, got ${result.status}`);
		}
		return failureMessage(result, key, entry, "project", version);
	}

	it("removes a remote skill recorded at a path, then adds one of those skills", async () => {
		expect(
			await abortMessage(
				"owner/repo/go",
				makeEntry({ type: "skill", sourceSubpath: "skills/go" }),
			),
		).toBe(
			"owner/repo/go can't be updated: its SKILL.md is gone from skills/go and 2 skills are now named go: lang/go, tools/go. The existing install is unchanged. To follow one of them: npx agntc remove owner/repo/go then one of: npx agntc add owner/repo/lang/go; npx agntc add owner/repo/tools/go",
		);
	});

	it("adds a root skill's namesakes by their paths, each keyed by its folder", async () => {
		expect(await abortMessage("owner/repo", makeEntry({ type: "skill" }))).toBe(
			"owner/repo can't be updated: its SKILL.md is gone from repo and 2 skills are now named repo: lang/repo, tools/repo. The existing install is unchanged. To follow one of them: npx agntc remove owner/repo then one of: npx agntc add owner/repo/lang/repo; npx agntc add owner/repo/tools/repo",
		);
	});

	it("adds a local skill's namesakes by their folders below the root", async () => {
		expect(
			await abortMessage(
				"/src/kit/go",
				makeEntry({
					type: "skill",
					commit: null,
					localRoot: "/src/kit",
					sourceSubpath: "skills/go",
				}),
				{ sourceDir: "/src/kit" },
			),
		).toBe(
			"/src/kit/go can't be updated: its SKILL.md is gone from skills/go and 2 skills are now named go: lang/go, tools/go. The existing install is unchanged. To follow one of them: npx agntc remove /src/kit/go then one of: npx agntc add /src/kit/lang/go; npx agntc add /src/kit/tools/go",
		);
	});

	it("pins the tag a version change picked on each add", async () => {
		expect(
			await abortMessage(
				"owner/repo/go",
				makeEntry({ type: "skill", ref: "v1.0.0", sourceSubpath: "skills/go" }),
				{ newRef: "v2.0.0", version: "v2.0.0" },
			),
		).toMatch(
			/then one of: npx agntc add owner\/repo\/lang\/go@v2\.0\.0; npx agntc add owner\/repo\/tools\/go@v2\.0\.0$/,
		);
	});

	it("keeps a constrained entry's caret on each add", async () => {
		expect(
			await abortMessage(
				"owner/repo/go",
				makeEntry({
					type: "skill",
					ref: "v1.2.0",
					constraint: "^1.0.0",
					sourceSubpath: "skills/go",
				}),
				{ newRef: "v1.3.0" },
			),
		).toMatch(
			/then one of: npx agntc add 'owner\/repo\/lang\/go@\^1\.0\.0'; npx agntc add 'owner\/repo\/tools\/go@\^1\.0\.0'$/,
		);
	});
});

describe("recordReinstall", () => {
	const manifest: Manifest = {
		"owner/repo/a": makeEntry(),
		"owner/repo/old": makeEntry(),
		"owner/repo/z": makeEntry(),
	};
	const entry = makeEntry({ commit: REMOTE_SHA });

	it("records the entry over the one it replaces, in its place, when its key stays", () => {
		const next = recordReinstall(
			manifest,
			"owner/repo/old",
			"owner/repo/old",
			entry,
			[],
		);

		expect(Object.keys(next)).toEqual(Object.keys(manifest));
		expect(next["owner/repo/old"]).toBe(entry);
	});

	it("records the entry under its new key and drops the old one", () => {
		const next = recordReinstall(
			manifest,
			"owner/repo/old",
			"owner/repo/new",
			entry,
			[],
		);

		expect(Object.keys(next)).toEqual([
			"owner/repo/a",
			"owner/repo/z",
			"owner/repo/new",
		]);
		expect(next["owner/repo/new"]).toBe(entry);
	});

	it("drops the loose skills it took over, then records it, so a key one held has the entry alone", () => {
		const next = recordReinstall(
			manifest,
			"owner/repo/old",
			"owner/repo/z",
			entry,
			["owner/repo/a", "owner/repo/z"],
		);

		expect(next).toEqual({ "owner/repo/z": entry });
	});
});

describe("recordCopyFailure", () => {
	it("drops the entry whose copy failed and the loose skills it took over, leaving the rest in order", () => {
		const manifest: Manifest = {
			"owner/repo/a": makeEntry(),
			"owner/repo/pack": makeEntry({ type: "pack" }),
			"owner/repo/loose": makeEntry(),
			"owner/repo/z": makeEntry(),
		};

		const next = recordCopyFailure(manifest, "owner/repo/pack", [
			"owner/repo/loose",
		]);

		expect(Object.keys(next)).toEqual(["owner/repo/a", "owner/repo/z"]);
		expect(Object.keys(manifest)).toHaveLength(4);
	});
});

describe("failureMessage for a global entry", () => {
	it("carries -g in an abort's remedy", () => {
		const msg = failureMessage(
			{ status: "aborted", reason: "its folder now contains packs" },
			"owner/repo",
			makeEntry({ type: "pack" }),
			"global",
		);

		expect(msg).toContain(
			"npx agntc remove -g owner/repo then npx agntc add -g owner/repo --pack",
		);
	});
});

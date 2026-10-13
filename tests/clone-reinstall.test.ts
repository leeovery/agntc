import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../src/manifest.js";

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

vi.mock("../src/fs-utils.js", () => ({
	pathExists: vi.fn(),
}));

vi.mock("../src/copy-pack.js", () => ({
	copyPack: vi.fn(),
}));

vi.mock("../src/discover.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/discover.js")>()),
	discover: vi.fn(),
}));

vi.mock("../src/copy-bare-skill.js", () => ({
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
					projectDir: "/fake/project",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up temp dir on failure", async () => {
			const entry = makeEntry({ type: "skill" });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(mockSpinner.start).toHaveBeenCalledWith("Cloning repository...");
			expect(mockSpinner.stop).toHaveBeenCalledWith("Cloned successfully");
		});
	});

	describe("aborted status (derive-before-delete)", () => {
		it("plumbs aborted up with recordedType and reason when recorded skill SKILL.md is gone", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(result.status).toBe("aborted");
			if (result.status === "aborted") {
				expect(result.recordedType).toBe("skill");
				expect(result.reason).toContain("SKILL.md");
			}
		});

		it("carries status 'aborted' (the single discriminator) alongside recordedType and reason", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);

			const result = await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(result.status).toBe("aborted");
			if (result.status === "aborted") {
				expect(result.recordedType).toBe("skill");
				expect(result.reason).toContain("SKILL.md");
			}
		});

		it("does not nuke files when aborted", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("does not remove the manifest entry when aborted (install intact)", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			const manifest: Manifest = { "owner/repo": entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
					manifest,
				},
				interactiveUi,
			);

			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("cleans up temp dir on abort", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall(
				{
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("member subdir vanished aborts (recorded skill, own subdir lacks SKILL.md)", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/go/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockPathExists.mockResolvedValue(false);

			const result = await cloneAndReinstall(
				{
					key: "owner/repo/go",
					entry,
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(result.status).toBe("aborted");
			expect(mockPathExists).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go/SKILL.md",
			);
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
					projectDir: "/fake/project",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("copy-failed");
				expect(result.message).toContain("npx agntc update owner/repo");
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
					projectDir: "/fake/project",
					manifest,
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(mockWriteManifest).not.toHaveBeenCalled();
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
					projectDir: "/fake/project",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
					sourceDir: key,
				},
				interactiveUi,
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
					projectDir: "/fake/project",
					sourceDir: "/Users/lee/Code/skills",
				},
				interactiveUi,
			);

			expect(result.status).toBe("success");
			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/Users/lee/Code/skills/skills/react/hooks",
				projectDir: "/fake/project",
				skillName: "hooks",
			});
			expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
				"/Users/lee/Code/skills/skills/react/hooks",
				"/Users/lee/Code/skills",
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
					projectDir: "/fake/project",
					sourceDir: "/Users/lee/Code/skills",
				},
				interactiveUi,
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
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(result).toMatchObject({
				status: "success",
				note: "owner/repo/swift is a single skill — reinstalled as a skill",
				manifestEntry: { type: "skill" },
			});
		});

		it("carries no note on a plain reinstall", async () => {
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
					projectDir: "/fake/project",
				},
				interactiveUi,
			);

			expect(result).not.toHaveProperty("note");
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
					projectDir: "/fake/project",
					newRef: "v2.0.0",
				},
				interactiveUi,
			);

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.ref).toBe("v2.0.0");
			}
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
					projectDir: "/fake/project",
				},
				interactiveUi,
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
						projectDir: "/fake/project",
					},
					interactiveUi,
				);

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					"/tmp/agntc-clone",
					"/tmp/agntc-clone",
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
						projectDir: "/fake/project",
					},
					interactiveUi,
				);

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					"/tmp/agntc-clone/go",
					"/tmp/agntc-clone",
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
						projectDir: "/fake/project",
						sourceDir: key,
					},
					interactiveUi,
				);

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(key, key);
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
						projectDir: "/fake/project",
					},
					interactiveUi,
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
						projectDir: "/fake/project",
						manifest,
					},
					interactiveUi,
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
						projectDir: "/fake/project",
					},
					interactiveUi,
				);

				expect(result.status).toBe("blocked");
				if (result.status !== "blocked") return;

				const mapped = mapCloneFailure(result, {
					onCloneFailed: () => "clone-failed",
					onCopyFailed: () => "copy-failed",
					onAborted: () => "aborted",
					onBlocked: (reason) => `blocked:${reason}`,
					onUnknown: () => "unknown",
				});
				expect(mapped).toBe(`blocked:${result.reason}`);
				expect(mapped).toContain("evil-link");
			});

			it("does not invoke the path-traversal guard on the update path", async () => {
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
						projectDir: "/fake/project",
					},
					interactiveUi,
				);

				expect(mockAssertSubpathWithinClone).not.toHaveBeenCalled();
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
						projectDir: "/fake/project",
					},
					interactiveUi,
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
						projectDir: "/fake/project",
						manifest,
					},
					interactiveUi,
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
						projectDir: "/fake/project",
					},
					interactiveUi,
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
						projectDir: "/fake/project",
					},
					interactiveUi,
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
						projectDir: "/fake/project",
					},
					interactiveUi,
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
			onAborted: (recordedType, reason) =>
				`aborted: ${recordedType} — ${reason}`,
			onBlocked: (reason) => `blocked: ${reason}`,
			onUnknown: (msg) => `unknown: ${msg}`,
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
			{ status: "failed", failureReason: "copy-failed", message: "disk full" },
			makeHandlers(),
		);
		expect(result).toBe("copy-failed: disk full");
	});

	it("dispatches unknown to onUnknown handler", () => {
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "unknown", message: "something" },
			makeHandlers(),
		);
		expect(result).toBe("unknown: something");
	});

	it("dispatches aborted (via status, no failureReason) to onAborted handler with recordedType and reason", () => {
		const result = mapCloneFailure(
			{
				status: "aborted",
				recordedType: "skill",
				reason: "SKILL.md is no longer present in the source",
			},
			makeHandlers(),
		);
		expect(result).toBe(
			"aborted: skill — SKILL.md is no longer present in the source",
		);
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
			onUnknown: () => 6,
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
			recordedType: "skill",
			reason: "SKILL.md is no longer present in the source",
		};
		expect(isCloneReinstallFailure(result)).toBe(true);
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
			manifestEntry: makeEntry(),
			copiedFiles: [".claude/skills/my-skill/"],
		};
		expect(isCloneReinstallFailure(result)).toBe(false);
	});

	it("narrows result to the failure union accepted by mapCloneFailure", () => {
		const result: CloneReinstallResult = {
			status: "aborted",
			recordedType: "skill",
			reason: "SKILL.md is no longer present in the source",
		};
		// Type-level: after the guard, result must satisfy mapCloneFailure's param.
		if (isCloneReinstallFailure(result)) {
			const mapped = mapCloneFailure(result, {
				onCloneFailed: () => "clone",
				onCopyFailed: () => "copy",
				onAborted: () => "aborted",
				onBlocked: () => "blocked",
				onUnknown: () => "unknown",
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
		);
		expect(msg).toBe("network error");
	});

	it("returns the failure's own message for copy-failed", () => {
		const msg = failureMessage(
			{
				status: "failed",
				failureReason: "copy-failed",
				message: "disk full hint",
			},
			"owner/repo",
		);
		expect(msg).toBe("disk full hint");
	});

	it("returns the failure's own message for unknown", () => {
		const msg = failureMessage(
			{ status: "failed", failureReason: "unknown", message: "something" },
			"owner/repo",
		);
		expect(msg).toBe("something");
	});

	it("returns buildAbortMessage output for aborted", () => {
		const reason = "SKILL.md is no longer present in the source";
		const msg = failureMessage(
			{ status: "aborted", recordedType: "skill", reason },
			"owner/repo",
		);
		expect(msg).toBe(buildAbortMessage("owner/repo", "skill", reason));
	});

	it("returns buildCopySafetyMessage output for blocked", () => {
		const reason =
			'symlink "evil-link" points outside the clone (target: /etc/passwd)';
		const msg = failureMessage({ status: "blocked", reason }, "owner/repo");
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

	it("describes a symlink escaping the clone (consistent with abort being a different concern)", () => {
		const msg = buildCopySafetyMessage("owner/repo", reason);
		expect(msg.toLowerCase()).toContain("symlink");
		// Guard against accidental reuse of the derive-before-delete framing.
		expect(msg).not.toBe(buildAbortMessage("owner/repo", "skill", reason));
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

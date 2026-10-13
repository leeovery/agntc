import type { Stats } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../src/manifest.js";

// The clone-reinstall dependency surface shared with list-change-version-action
// is mocked via factory bodies authored once in ../helpers/list-action-mocks.
// vitest hoists `vi.mock` to the top of *this* file and needs the literal
// module path at hoist time, so each `vi.mock(path, ...)` call lives here; the
// factory contents are delegated to the shared helper.
vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack({ confirm: vi.fn(), isCancel: vi.fn(() => false) });
});

vi.mock("../../src/manifest.js", async (importOriginal) => {
	const { mockManifestModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockManifestModule(
		importOriginal<typeof import("../../src/manifest.js")>,
	);
});

vi.mock("../../src/git-clone.js", async () => {
	const { mockGitCloneModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockGitCloneModule();
});

vi.mock("../../src/nuke-files.js", async () => {
	const { mockNukeFilesModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockNukeFilesModule();
});

vi.mock("../../src/copy-pack.js", async (importOriginal) => {
	const { mockCopyPackModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyPackModule(
		importOriginal<typeof import("../../src/copy-pack.js")>,
	);
});

vi.mock("../../src/copy-bare-skill.js", async () => {
	const { mockCopyBareSkillModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyBareSkillModule();
});

vi.mock("../../src/discover.js", async (importOriginal) => {
	const { mockDiscoverModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockDiscoverModule(
		importOriginal<typeof import("../../src/discover.js")>,
	);
});

vi.mock("../../src/unmanaged-check.js", async () => {
	const { mockUnmanagedCheckModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockUnmanagedCheckModule();
});

// File-specific: this file also needs `stat` (local-path validation).
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

import { stat } from "node:fs/promises";
import * as p from "@clack/prompts";
import { executeUpdateAction } from "../../src/commands/list-update-action.js";
import { SymlinkEscapeError } from "../../src/copy-safety.js";
import { globalScope, projectScope } from "../../src/scope.js";
import { interactiveUi } from "../../src/ui.js";
import { makeEntry } from "../helpers/factories.js";
import {
	looseSkillsAt,
	REMOTE_SHA,
	setupListActionMocks,
} from "../helpers/list-action-mocks.js";

const mocks = setupListActionMocks();
const mockWriteManifest = mocks.writeManifest;
const mockAddEntry = mocks.addEntry;
const mockCloneSource = mocks.cloneSource;
const mockCleanupTempDir = mocks.cleanupTempDir;
const mockNukeManifestFiles = mocks.nukeManifestFiles;
const mockCopyBareSkill = mocks.copyBareSkill;
const mockAccess = mocks.access;
const mockScanForEscapingSymlinks = mocks.scanForEscapingSymlinks;
const mockDiscover = mocks.discover;
const mockConfirm = vi.mocked(p.confirm);
// File-specific handle: local-path validation via fs.stat.
const mockStat = vi.mocked(stat);

describe("executeUpdateAction", () => {
	describe("remote update (commit is not null)", () => {
		it("clones, nukes, copies, writes manifest, returns success with newEntry", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.commit).toBe(REMOTE_SHA);
			expect(result.newEntry!.files).toEqual([".claude/skills/my-skill/"]);
			expect(mockCloneSource).toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				manifest,
				key,
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
		});
	});

	describe("local update (commit is null)", () => {
		it("validates path, nukes, copies, writes manifest, returns success", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ commit: null, ref: null });
			const manifest: Manifest = { [key]: entry };

			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.commit).toBeNull();
			expect(result.newEntry!.ref).toBeNull();
			expect(result.newEntry!.files).toEqual([".claude/skills/my-plugin/"]);
			expect(mockStat).toHaveBeenCalledWith(key);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("names the recorded root, not the key, when that folder is gone", async () => {
			const key = "/Users/lee/Code/skills/go";
			const entry = makeEntry({
				commit: null,
				ref: null,
				localRoot: "/Users/lee/Code/skills",
			});
			mockStat.mockRejectedValue(new Error("ENOENT"));

			const result = await executeUpdateAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				success: false,
				message: "/Users/lee/Code/skills: path does not exist",
				notes: [],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("clone failure", () => {
		it("returns failure, does not nuke, does not write manifest", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("git clone failed");
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("temp dir cleanup", () => {
		it("cleans up on success", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up on failure", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(false);
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("collection key (3+ parts)", () => {
		it("resolves sourceDir correctly for collection plugin", async () => {
			const key = "owner/repo/go";
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/go/"],
			});
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(true);
			// Clone uses owner/repo
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "owner",
					repo: "repo",
				}),
			);
			// The recorded-skill validation gate uses the subdir
			expect(mockAccess).toHaveBeenCalledWith("/tmp/agntc-clone/go/SKILL.md");
		});
	});

	describe("copy-failed — remote update", () => {
		it("removes entry from manifest and returns failure with recovery hint", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("npx agntc add owner/repo");
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});
	});

	describe("copy-failed — local update", () => {
		it("removes entry from manifest and returns failure with recovery hint", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ commit: null, ref: null });
			const manifest: Manifest = { [key]: entry };

			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain(`npx agntc add ${key}`);
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ [key]: expect.anything() }),
			);
		});
	});

	describe("aborted (derive-before-delete)", () => {
		it("renders the canonical buildAbortMessage with recordedType + remove+add remedy, leaves install intact", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// The recorded SKILL.md is gone and two skills now carry its name → abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(false);
			expect(result.message).toBe(
				"owner/repo was installed as a skill and can't be updated (its SKILL.md is gone from repo and 2 skills are now named repo: a/repo, b/repo). The existing install is unchanged. To migrate: npx agntc remove owner/repo then npx agntc add owner/repo",
			);
			expect(result.newEntry).toBeUndefined();
			// Install intact: no nuke, no manifest write.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("carries -g in the remedy for a global entry", async () => {
			const entry = makeEntry({ type: "skill", ref: "v1.0.0" });
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));

			const result = await executeUpdateAction(
				"owner/repo",
				entry,
				{ "owner/repo": entry },
				globalScope("/home/lee"),
				interactiveUi,
			);

			expect(result.message).toContain(
				"To migrate: npx agntc remove -g owner/repo then npx agntc add -g owner/repo",
			);
		});
	});

	describe("a skill that moved upstream", () => {
		it("follows it, records its new path, and returns the move as a note", async () => {
			const key = "owner/repo/go";
			const entry = makeEntry({ type: "skill", files: [".claude/skills/go/"] });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/go"));
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(true);
			expect(result.newEntry!.sourceSubpath).toBe("skills/go");
			expect(result.notes).toEqual([
				"owner/repo/go moved from go to skills/go",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: "/tmp/agntc-clone/skills/go" }),
			);
		});
	});

	describe("an entry gone upstream", () => {
		const key = "owner/repo/go";
		const entry = makeEntry({ type: "skill", files: [".claude/skills/go/"] });
		const other = makeEntry({ files: [".claude/skills/other/"] });
		const manifest: Manifest = { [key]: entry, "owner/other": other };

		function arrangeGone(): void {
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/other"));
		}

		it("asks whether to remove it, no by default", async () => {
			arrangeGone();
			mockConfirm.mockResolvedValue(false);

			await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockConfirm).toHaveBeenCalledExactlyOnceWith({
				message: "owner/repo/go is gone upstream — remove it?",
				initialValue: false,
			});
		});

		it("keeps it on no: nothing removed or written", async () => {
			arrangeGone();
			mockConfirm.mockResolvedValue(false);

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				success: true,
				message:
					"Kept owner/repo/go — it's gone upstream; update will ask again",
				notes: [],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("removes its files and then its entry on yes", async () => {
			arrangeGone();
			mockConfirm.mockResolvedValue(true);

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				success: true,
				message: "Removed owner/repo/go — it's gone upstream",
				notes: [],
			});
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/go/"],
			);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/other": other },
			);
			expect(mockNukeManifestFiles.mock.invocationCallOrder[0]).toBeLessThan(
				mockWriteManifest.mock.invocationCallOrder[0]!,
			);
		});
	});

	describe("blocked (symlink-escape copy-safety)", () => {
		it("renders the copy-safety message (symlink escape, no type-migration remedy), leaves install intact", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("evil-link");
			expect(result.message.toLowerCase()).toContain("symlink");
			expect(result.message).toContain("unchanged");
			expect(result.message).not.toContain("no longer supports that type");
			expect(result.message).not.toContain("npx agntc remove");
			expect(result.newEntry).toBeUndefined();
			// Install intact: no nuke, no manifest write.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("constrained update overrides", () => {
		it("forwards newRef and newCommit to cloneAndReinstall when overrides provided", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0", constraint: "^1.0.0" });
			const manifest: Manifest = { [key]: entry };
			const overrideCommit = "c".repeat(40);

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: overrideCommit,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
				{ newRef: "v1.2.0", newCommit: overrideCommit },
			);

			expect(result.success).toBe(true);
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "v1.2.0" }),
			);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.ref).toBe("v1.2.0");
			expect(result.newEntry!.commit).toBe(overrideCommit);
		});

		it("behaves as before when no overrides provided", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0", constraint: "^1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.success).toBe(true);
			// Without overrides, cloneSource uses entry.ref
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "v1.0.0" }),
			);
			expect(result.newEntry!.commit).toBe(REMOTE_SHA);
		});

		it("keeps a branch entry on its branch, at the clone's commit", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "dev" });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "dev" }),
			);
			expect(result.newEntry).toMatchObject({ ref: "dev", commit: REMOTE_SHA });
			expect(mockAddEntry).toHaveBeenCalledWith(
				{ [key]: entry },
				key,
				expect.objectContaining({ ref: "dev" }),
			);
		});
	});
});

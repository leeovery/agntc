import type { Stats } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../src/manifest.js";
import type { DetectedType } from "../../src/type-detection.js";

// The clone-reinstall dependency surface shared with list-change-version-action
// is mocked via factory bodies authored once in ../helpers/list-action-mocks.
// vitest hoists `vi.mock` to the top of *this* file and needs the literal
// module path at hoist time, so each `vi.mock(path, ...)` call lives here; the
// factory contents are delegated to the shared helper.
vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack();
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

vi.mock("../../src/config.js", async () => {
	const { mockConfigModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockConfigModule();
});

vi.mock("../../src/type-detection.js", async (importOriginal) => {
	const { mockTypeDetectionModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockTypeDetectionModule(
		importOriginal<typeof import("../../src/type-detection.js")>,
	);
});

vi.mock("../../src/nuke-files.js", async () => {
	const { mockNukeFilesModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockNukeFilesModule();
});

vi.mock("../../src/copy-plugin-assets.js", async () => {
	const { mockCopyPluginAssetsModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyPluginAssetsModule();
});

vi.mock("../../src/copy-bare-skill.js", async () => {
	const { mockCopyBareSkillModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyBareSkillModule();
});

vi.mock("../../src/drivers/registry.js", async () => {
	const { mockDriversRegistryModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockDriversRegistryModule();
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
import { makeEntry } from "../helpers/factories.js";
import {
	REMOTE_SHA,
	setupListActionMocks,
} from "../helpers/list-action-mocks.js";

const mocks = setupListActionMocks();
const mockWriteManifest = mocks.writeManifest;
const mockAddEntry = mocks.addEntry;
const mockCloneSource = mocks.cloneSource;
const mockCleanupTempDir = mocks.cleanupTempDir;
const mockReadConfig = mocks.readConfig;
const mockDetectType = mocks.detectType;
const mockNukeManifestFiles = mocks.nukeManifestFiles;
const mockCopyBareSkill = mocks.copyBareSkill;
const mockAccess = mocks.access;
const mockScanForEscapingSymlinks = mocks.scanForEscapingSymlinks;
const mockLog = vi.mocked(p.log);
// File-specific handle: local-path validation via fs.stat.
const mockStat = vi.mocked(stat);

describe("executeUpdateAction", () => {
	describe("remote update (commit is not null)", () => {
		it("clones, reads config, nukes, copies, writes manifest, returns success with newEntry", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest: Manifest = { [key]: entry };

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

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.commit).toBe(REMOTE_SHA);
			expect(result.newEntry!.agents).toEqual(["claude"]);
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
		it("validates path, reads config, nukes, copies, writes manifest, returns success", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ commit: null, ref: null });
			const manifest: Manifest = { [key]: entry };

			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.commit).toBeNull();
			expect(result.newEntry!.ref).toBeNull();
			expect(result.newEntry!.agents).toEqual(["claude"]);
			expect(result.newEntry!.files).toEqual([".claude/skills/my-plugin/"]);
			expect(mockStat).toHaveBeenCalledWith(key);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalled();
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
				"/fake/project",
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("git clone failed");
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("all agents dropped (remote)", () => {
		it("returns failure, does not nuke, does not write manifest", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ agents: ["codex"] });
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version only supports claude, entry has codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain(
				"no longer supports any of your installed agents",
			);
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("all agents dropped (local)", () => {
		it("returns failure, does not nuke", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ commit: null, ref: null, agents: ["codex"] });
			const manifest: Manifest = { [key]: entry };

			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain(
				"no longer supports any of your installed agents",
			);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("agent drop warning (remote)", () => {
		it("emits warning for partial drop", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ agents: ["claude", "codex"] });
			const manifest: Manifest = { [key]: entry };

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

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});
	});

	describe("agent drop warning (local)", () => {
		it("emits warning for partial drop", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({
				commit: null,
				ref: null,
				agents: ["claude", "codex"],
			});
			const manifest: Manifest = { [key]: entry };

			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeUpdateAction(key, entry, manifest, "/fake/project");

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(false);
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("config null (no agntc.json = no agent restriction)", () => {
		it("proceeds for a remote recorded skill whose SKILL.md is still present", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ type: "skill" });
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue(null);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
			expect(mockNukeManifestFiles).toHaveBeenCalled();
		});

		it("proceeds for a local recorded skill whose SKILL.md is still present", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ type: "skill", commit: null, ref: null });
			const manifest: Manifest = { [key]: entry };

			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockReadConfig.mockResolvedValue(null);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
			expect(mockNukeManifestFiles).toHaveBeenCalled();
		});
	});

	describe("collection key (3+ parts)", () => {
		it("resolves sourceDir correctly for collection plugin", async () => {
			const key = "owner/repo/go";
			const entry = makeEntry({
				type: "skill",
				agents: ["claude"],
				files: [".claude/skills/go/"],
			});
			const manifest: Manifest = { [key]: entry };

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			// Clone uses owner/repo
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("npx agntc update owner/repo");
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain(`npx agntc update ${key}`);
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			// Recorded skill's SKILL.md is gone in the re-clone → abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(false);
			expect(result.message).toContain("installed as a skill");
			expect(result.message).toContain("unchanged");
			expect(result.message).toContain("npx agntc remove owner/repo");
			expect(result.message).toContain("npx agntc add owner/repo");
			expect(result.newEntry).toBeUndefined();
			// Install intact: no nuke, no manifest write.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeUpdateAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.success).toBe(true);
			// Without overrides, cloneSource uses entry.ref
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "v1.0.0" }),
			);
			expect(result.newEntry!.commit).toBe(REMOTE_SHA);
		});
	});
});

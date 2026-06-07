import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentId } from "../src/drivers/types.js";
import type { Manifest } from "../src/manifest.js";
import type { DetectedType } from "../src/type-detection.js";

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

vi.mock("../src/manifest.js", () => ({
	writeManifest: vi.fn(),
	removeEntry: vi.fn(),
}));

vi.mock("../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../src/config.js", () => ({
	readConfig: vi.fn(),
}));

vi.mock("../src/type-detection.js", () => ({
	detectType: vi.fn(),
}));

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/fs-utils.js", () => ({
	pathExists: vi.fn(),
}));

vi.mock("../src/copy-plugin-assets.js", () => ({
	copyPluginAssets: vi.fn(),
}));

vi.mock("../src/copy-bare-skill.js", () => ({
	copyBareSkill: vi.fn(),
}));

vi.mock("../src/drivers/registry.js", () => ({
	getDriver: vi.fn(),
}));

vi.mock("../src/copy-safety.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/copy-safety.js")>();
	return {
		...actual,
		scanForEscapingSymlinks: vi.fn(),
		assertSubpathWithinClone: vi.fn(),
	};
});

import * as p from "@clack/prompts";
import type {
	CloneFailureHandlers,
	CloneReinstallFailed,
} from "../src/clone-reinstall.js";
import {
	buildFailureMessage,
	cloneAndReinstall,
	formatAgentsDroppedWarning,
	mapCloneFailure,
} from "../src/clone-reinstall.js";
import { readConfig } from "../src/config.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import {
	assertSubpathWithinClone,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import { getDriver } from "../src/drivers/registry.js";
import { pathExists } from "../src/fs-utils.js";
import { cleanupTempDir, cloneSource } from "../src/git-clone.js";
import { removeEntry, writeManifest } from "../src/manifest.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { detectType } from "../src/type-detection.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockRemoveEntry = vi.mocked(removeEntry);

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockPathExists = vi.mocked(pathExists);
const mockLog = vi.mocked(p.log);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);
const mockAssertSubpathWithinClone = vi.mocked(assertSubpathWithinClone);

import { makeEntry, makeFakeDriver } from "./helpers/factories.js";

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);

const fakeDriver = makeFakeDriver();

beforeEach(() => {
	vi.clearAllMocks();
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockGetDriver.mockReturnValue(fakeDriver);
	mockPathExists.mockResolvedValue(true);
	mockWriteManifest.mockResolvedValue(undefined);
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
	mockRemoveEntry.mockImplementation((manifest, key) => {
		const { [key]: _, ...rest } = manifest;
		return rest;
	});
});

describe("formatAgentsDroppedWarning", () => {
	it("formats the warning with key, dropped agents, installed agents, and new agents", () => {
		const result = formatAgentsDroppedWarning(
			"owner/repo",
			["codex"] as AgentId[],
			["claude", "codex"] as AgentId[],
			["claude"] as AgentId[],
		);

		expect(result).toBe(
			"Plugin owner/repo no longer declares support for codex. " +
				"Currently installed for: claude, codex. " +
				"New version supports: claude.",
		);
	});

	it("formats with multiple dropped agents", () => {
		const result = formatAgentsDroppedWarning(
			"owner/repo",
			["claude", "codex"] as AgentId[],
			["claude", "codex"] as AgentId[],
			[] as AgentId[],
		);

		expect(result).toContain("claude, codex");
	});
});

describe("cloneAndReinstall", () => {
	describe("git (remote) path — success", () => {
		it("returns success with manifest entry, copied files, and dropped agents", async () => {
			const entry = makeEntry({
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
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

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.commit).toBe(REMOTE_SHA);
				expect(result.manifestEntry.agents).toEqual(["claude"]);
				expect(result.copiedFiles).toEqual([".claude/skills/my-skill/"]);
				expect(result.droppedAgents).toEqual([]);
			}
		});

		it("clones, nukes, copies in correct order", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);

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

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(callOrder).toEqual(["clone", "nuke", "copy"]);
		});

		it("cleans up temp dir on success", async () => {
			const entry = makeEntry();

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

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up temp dir on failure", async () => {
			const entry = makeEntry({ type: "skill" });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockSpinner.start).toHaveBeenCalledWith("Cloning repository...");
			expect(mockSpinner.stop).toHaveBeenCalledWith("Cloned successfully");
		});
	});

	describe("null config (no agntc.json)", () => {
		it("proceeds for a recorded skill whose SKILL.md is still present (null config = no restriction)", async () => {
			const entry = makeEntry({ type: "skill" });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue(null);
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
		});
	});

	describe("no-agents status", () => {
		it("returns failed with no-agents message", async () => {
			const entry = makeEntry({ agents: ["codex"] });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version only supports claude, entry has codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("no-agents");
				expect(result.message).toContain(
					"no longer supports any of your installed agents",
				);
			}
		});

		it("does not nuke files when all agents dropped", async () => {
			const entry = makeEntry({ agents: ["codex"] });

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(false);

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("aborted");
			if (result.status === "aborted") {
				expect(result.recordedType).toBe("skill");
				expect(result.reason).toContain("SKILL.md");
			}
		});

		it("carries failureReason 'aborted' alongside recordedType and reason", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(false);

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("aborted");
			if (result.status === "aborted") {
				expect(result.failureReason).toBe("aborted");
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
				manifest,
			});

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(false);

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(false);

			const result = await cloneAndReinstall({
				key: "owner/repo/go",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("aborted");
			expect(mockPathExists).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go/SKILL.md",
			);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("configless recorded-skill update proceeds (null config, copyBareSkill)", async () => {
			const entry = makeEntry({
				type: "skill",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue(null);
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
		});
	});

	describe("copy-failed status", () => {
		it("returns failed with copy-failed reason and recovery hint", async () => {
			const entry = makeEntry();

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
				manifest,
			});

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("clone failure", () => {
		it("returns failed with clone-failed reason", async () => {
			const entry = makeEntry();

			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("failed");
			if (result.status === "failed") {
				expect(result.failureReason).toBe("clone-failed");
				expect(result.message).toContain("git clone failed");
			}
		});

		it("does not nuke on clone failure", async () => {
			const entry = makeEntry();

			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("agents dropped warning", () => {
		it("emits warning when agents are partially dropped", async () => {
			const entry = makeEntry({
				agents: ["claude", "codex"],
				files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
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

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.droppedAgents).toEqual(["codex"]);
			}
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});
	});

	describe("local path (no clone)", () => {
		it("returns success without cloning for local entry", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({
				commit: null,
				ref: null,
				agents: ["claude"],
				files: [".claude/skills/my-plugin/"],
			});

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({
				type: "bare-skill",
			} as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			const result = await cloneAndReinstall({
				key,
				entry,
				projectDir: "/fake/project",
				sourceDir: key,
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.commit).toBeNull();
				expect(result.manifestEntry.ref).toBeNull();
			}
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});
	});

	describe("newRef and newCommit overrides", () => {
		it("uses newRef when provided", async () => {
			const entry = makeEntry({ ref: "v1.0.0" });

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

			const result = await cloneAndReinstall({
				key: "owner/repo",
				entry,
				projectDir: "/fake/project",
				newRef: "v2.0.0",
			});

			expect(result.status).toBe("success");
			if (result.status === "success") {
				expect(result.manifestEntry.ref).toBe("v2.0.0");
			}
		});
	});

	describe("collection key", () => {
		it("resolves sourceDir from key when key has 3+ segments", async () => {
			const entry = makeEntry({
				agents: ["claude"],
				files: [".claude/skills/go/"],
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

			const result = await cloneAndReinstall({
				key: "owner/repo/go",
				entry,
				projectDir: "/fake/project",
			});

			expect(result.status).toBe("success");
			// readConfig should be called with the subdir
			expect(mockReadConfig).toHaveBeenCalledWith(
				"/tmp/agntc-clone/go",
				expect.anything(),
			);
		});

		describe("symlink-escape pre-flight (update re-copy)", () => {
			it("clone mode scans sourceDir against the clone root (tempDir)", async () => {
				const entry = makeEntry({ type: "skill" });

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-skill/"],
				});

				await cloneAndReinstall({
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				});

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
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/go/"],
				});

				await cloneAndReinstall({
					key: "owner/repo/go",
					entry,
					projectDir: "/fake/project",
				});

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
					agents: ["claude"],
					files: [".claude/skills/my-plugin/"],
				});

				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-plugin/"],
				});

				await cloneAndReinstall({
					key,
					entry,
					projectDir: "/fake/project",
					sourceDir: key,
				});

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(key, key);
			});

			it("escaping symlink aborts before nuke (install intact, no copy, non-zero pre-flight failure)", async () => {
				const entry = makeEntry({
					type: "skill",
					files: [".claude/skills/my-skill/"],
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
				);

				const result = await cloneAndReinstall({
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				});

				expect(result.status).toBe("aborted");
				if (result.status === "aborted") {
					expect(result.failureReason).toBe("aborted");
					expect(result.reason).toContain("evil-link");
				}
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockCopyPluginAssets).not.toHaveBeenCalled();
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
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
				);

				await cloneAndReinstall({
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
					manifest,
				});

				expect(mockRemoveEntry).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});

			it("surfaces the violation as a named pre-flight failure via mapCloneFailure (onAborted)", async () => {
				const entry = makeEntry({
					type: "plugin",
					files: [".claude/skills/my-skill/"],
				});

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
				);

				const result = await cloneAndReinstall({
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				});

				expect(result.status).toBe("aborted");
				if (result.status !== "aborted") return;

				const mapped = mapCloneFailure(result, {
					onCloneFailed: () => "clone-failed",
					onNoAgents: () => "no-agents",
					onCopyFailed: () => "copy-failed",
					onAborted: (recordedType, reason) =>
						`aborted:${recordedType}:${reason}`,
					onUnknown: () => "unknown",
				});
				expect(mapped).toBe(`aborted:plugin:${result.reason}`);
				expect(mapped).toContain("evil-link");
			});

			it("does not invoke the path-traversal guard on the update path", async () => {
				const entry = makeEntry({ type: "skill" });

				mockCloneSource.mockResolvedValue({
					tempDir: "/tmp/agntc-clone",
					commit: REMOTE_SHA,
				});
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-skill/"],
				});

				await cloneAndReinstall({
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				});

				expect(mockAssertSubpathWithinClone).not.toHaveBeenCalled();
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
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockResolvedValue(undefined);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/my-skill/"],
				});

				const result = await cloneAndReinstall({
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				});

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
				mockReadConfig.mockResolvedValue({ agents: ["claude"] });
				mockPathExists.mockResolvedValue(true);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("evil", "../escape"),
				);

				await cloneAndReinstall({
					key: "owner/repo",
					entry,
					projectDir: "/fake/project",
				});

				expect(mockNukeManifestFiles).toHaveBeenCalledTimes(0);
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(0);
				expect(mockCopyPluginAssets).toHaveBeenCalledTimes(0);
			});
		});
	});
});

describe("mapCloneFailure", () => {
	function makeHandlers(): CloneFailureHandlers<string> {
		return {
			onCloneFailed: (msg) => `clone-failed: ${msg}`,
			onNoAgents: (msg) => `no-agents: ${msg}`,
			onCopyFailed: (msg) => `copy-failed: ${msg}`,
			onAborted: (recordedType, reason) =>
				`aborted: ${recordedType} — ${reason}`,
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

	it("dispatches no-agents to onNoAgents handler", () => {
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "no-agents", message: "no agents" },
			makeHandlers(),
		);
		expect(result).toBe("no-agents: no agents");
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

	it("dispatches aborted to onAborted handler with recordedType and reason", () => {
		const result = mapCloneFailure(
			{
				status: "aborted",
				failureReason: "aborted",
				recordedType: "skill",
				reason: "SKILL.md is no longer present in the source",
			},
			makeHandlers(),
		);
		expect(result).toBe(
			"aborted: skill — SKILL.md is no longer present in the source",
		);
	});

	it("returns the typed result from handler", () => {
		const handlers: CloneFailureHandlers<number> = {
			onCloneFailed: () => 1,
			onNoAgents: () => 3,
			onCopyFailed: () => 5,
			onAborted: () => 7,
			onUnknown: () => 6,
		};
		const result = mapCloneFailure(
			{ status: "failed", failureReason: "no-agents", message: "test" },
			handlers,
		);
		expect(result).toBe(3);
	});
});

describe("buildFailureMessage", () => {
	function makeFailed(
		failureReason: CloneReinstallFailed["failureReason"],
		message: string,
	): CloneReinstallFailed {
		return { status: "failed", failureReason, message };
	}

	describe("passthrough reasons (clone-failed, copy-failed, unknown)", () => {
		it("returns result.message for clone-failed", () => {
			const msg = buildFailureMessage(
				makeFailed("clone-failed", "network error"),
				"owner/repo",
			);
			expect(msg).toBe("network error");
		});

		it("returns result.message for copy-failed", () => {
			const msg = buildFailureMessage(
				makeFailed("copy-failed", "disk full hint"),
				"owner/repo",
			);
			expect(msg).toBe("disk full hint");
		});

		it("returns result.message for unknown", () => {
			const msg = buildFailureMessage(
				makeFailed("unknown", "something went wrong"),
				"owner/repo",
			);
			expect(msg).toBe("something went wrong");
		});
	});

	describe("no-agents", () => {
		it("returns standard no-agents message", () => {
			const msg = buildFailureMessage(
				makeFailed("no-agents", "ignored"),
				"owner/repo",
			);
			expect(msg).toBe(
				"Plugin owner/repo no longer supports any of your installed agents",
			);
		});
	});
});

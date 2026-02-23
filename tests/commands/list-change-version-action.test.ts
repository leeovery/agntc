import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { DetectedType } from "../../src/type-detection.js";
import type { UpdateCheckResult } from "../../src/update-check.js";

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	spinner: vi.fn(() => ({
		start: vi.fn(),
		stop: vi.fn(),
		message: vi.fn(),
	})),
	select: vi.fn(),
	isCancel: vi.fn(),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
		message: vi.fn(),
	},
	cancel: vi.fn(),
}));

vi.mock("../../src/manifest.js", () => ({
	writeManifest: vi.fn(),
	addEntry: vi.fn(),
	removeEntry: vi.fn(),
}));

vi.mock("../../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
	readConfig: vi.fn(),
}));

vi.mock("../../src/type-detection.js", () => ({
	detectType: vi.fn(),
}));

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

import * as p from "@clack/prompts";
import { executeChangeVersionAction } from "../../src/commands/list-change-version-action.js";
import { readConfig } from "../../src/config.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import { getDriver } from "../../src/drivers/registry.js";
import { cleanupTempDir, cloneSource } from "../../src/git-clone.js";
import { addEntry, removeEntry, writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { detectType } from "../../src/type-detection.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockRemoveEntry = vi.mocked(removeEntry);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockSelect = vi.mocked(p.select);
const mockIsCancel = vi.mocked(p.isCancel);
const mockLog = vi.mocked(p.log);

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
	return {
		ref: "v1.0.0",
		commit: INSTALLED_SHA,
		installedAt: "2026-02-01T00:00:00.000Z",
		agents: ["claude"],
		files: [".claude/skills/my-skill/"],
		cloneUrl: null,
		...overrides,
	};
}

function makeManifest(key: string, entry: ManifestEntry): Manifest {
	return { [key]: entry };
}

function makeNewerTagsStatus(tags: string[]): UpdateCheckResult {
	return { status: "newer-tags", tags };
}

const fakeDriver = {
	detect: vi.fn().mockResolvedValue(true),
	getTargetDir: vi.fn((assetType: string) => {
		if (assetType === "skills") return ".claude/skills";
		if (assetType === "agents") return ".claude/agents";
		if (assetType === "hooks") return ".claude/hooks";
		return null;
	}),
};

beforeEach(() => {
	vi.clearAllMocks();
	mockWriteManifest.mockResolvedValue(undefined);
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockGetDriver.mockReturnValue(fakeDriver);
	mockAddEntry.mockImplementation((manifest, key, entry) => ({
		...manifest,
		[key]: entry,
	}));
	mockRemoveEntry.mockImplementation((manifest, key) => {
		const { [key]: _, ...rest } = manifest;
		return rest;
	});
	mockIsCancel.mockReturnValue(false);
});

describe("executeChangeVersionAction", () => {
	describe("tag presentation", () => {
		it("presents tags newest-first via p.select options", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest = makeManifest(key, entry);
			// tags ordered oldest→newest from update-check
			const updateStatus = makeNewerTagsStatus(["v1.1.0", "v1.2.0", "v2.0.0"]);

			mockSelect.mockResolvedValue("v2.0.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(mockSelect).toHaveBeenCalledWith(
				expect.objectContaining({
					options: [
						{ value: "v2.0.0", label: "v2.0.0" },
						{ value: "v1.2.0", label: "v1.2.0" },
						{ value: "v1.1.0", label: "v1.1.0" },
					],
				}),
			);
		});
	});

	describe("cancel", () => {
		it("returns changed: false when user cancels", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			const cancelSymbol = Symbol("cancel");
			mockSelect.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe("Cancelled");
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("successful version change", () => {
		it("clones at selected tag, nukes, copies, writes manifest, returns changed: true", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0", "v2.0.0"]);

			mockSelect.mockResolvedValue("v2.0.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.commit).toBe(REMOTE_SHA);
			expect(result.newEntry!.ref).toBe("v2.0.0");
			expect(result.newEntry!.agents).toEqual(["claude"]);
			expect(result.newEntry!.files).toEqual([".claude/skills/my-skill/"]);
			expect(result.message).toBe("Changed owner/repo to v2.0.0");
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("clones with selected tag ref", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "owner",
					repo: "repo",
					ref: "v1.1.0",
				}),
			);
		});
	});

	describe("clone failure", () => {
		it("returns changed: false, does not nuke", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("git clone failed");
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("all agents dropped", () => {
		it("returns changed: false, does not nuke", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ agents: ["codex"] });
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version only supports claude, entry has codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain(
				"no longer supports any of your installed agents",
			);
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("agent drop warning", () => {
		it("emits warning for partial drop", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ agents: ["claude", "codex"] });
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(true);
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});
	});

	describe("temp dir cleanup", () => {
		it("cleans up on success", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up on failure", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(false);
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("manifest updated with new ref", () => {
		it("writes manifest with new ref, not old ref", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(mockAddEntry).toHaveBeenCalledWith(
				manifest,
				key,
				expect.objectContaining({
					ref: "v1.1.0",
					commit: REMOTE_SHA,
				}),
			);
		});
	});

	describe("updateStatus not newer-tags", () => {
		it("returns changed: false when status is up-to-date", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest = makeManifest(key, entry);
			const updateStatus: UpdateCheckResult = { status: "up-to-date" };

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe("No tags available for version change");
			expect(mockSelect).not.toHaveBeenCalled();
		});

		it("returns changed: false when status is local", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest = makeManifest(key, entry);
			const updateStatus: UpdateCheckResult = { status: "local" };

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe("No tags available for version change");
		});
	});

	describe("copy-failed", () => {
		it("removes entry from manifest and returns changed: false with recovery hint", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest = makeManifest(key, entry);
			const updateStatus = makeNewerTagsStatus(["v1.1.0"]);

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
				updateStatus,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("npx agntc update owner/repo");
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});
	});
});

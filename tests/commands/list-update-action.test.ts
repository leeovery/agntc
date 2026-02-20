import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { DetectedType } from "../../src/type-detection.js";
import type { Stats } from "node:fs";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
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
  cancel: vi.fn(),
}));

vi.mock("../../src/manifest.js", () => ({
  writeManifest: vi.fn(),
  addEntry: vi.fn(),
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

vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
}));

import * as p from "@clack/prompts";
import { writeManifest, addEntry } from "../../src/manifest.js";
import { cloneSource, cleanupTempDir } from "../../src/git-clone.js";
import { readConfig } from "../../src/config.js";
import { detectType } from "../../src/type-detection.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { getDriver } from "../../src/drivers/registry.js";
import { stat } from "node:fs/promises";
import { executeUpdateAction } from "../../src/commands/list-update-action.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockStat = vi.mocked(stat);
const mockLog = vi.mocked(p.log);

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    ref: null,
    commit: INSTALLED_SHA,
    installedAt: "2026-02-01T00:00:00.000Z",
    agents: ["claude"],
    files: [".claude/skills/my-skill/"],
    ...overrides,
  };
}

function makeManifest(
  key: string,
  entry: ManifestEntry,
): Manifest {
  return { [key]: entry };
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
});

describe("executeUpdateAction", () => {
  describe("remote update (commit is not null)", () => {
    it("clones, reads config, nukes, copies, writes manifest, returns success with newEntry", async () => {
      const key = "owner/repo";
      const entry = makeEntry();
      const manifest = makeManifest(key, entry);

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
      expect(mockNukeManifestFiles).toHaveBeenCalledWith(
        "/fake/project",
        [".claude/skills/my-skill/"],
      );
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
      const manifest = makeManifest(key, entry);

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
      expect(mockNukeManifestFiles).toHaveBeenCalledWith(
        "/fake/project",
        [".claude/skills/my-skill/"],
      );
      expect(mockWriteManifest).toHaveBeenCalled();
    });
  });

  describe("clone failure", () => {
    it("returns failure, does not nuke, does not write manifest", async () => {
      const key = "owner/repo";
      const entry = makeEntry();
      const manifest = makeManifest(key, entry);

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
      const manifest = makeManifest(key, entry);

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
      const manifest = makeManifest(key, entry);

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
      const manifest = makeManifest(key, entry);

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
      const manifest = makeManifest(key, entry);

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
      const manifest = makeManifest(key, entry);

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
      const manifest = makeManifest(key, entry);

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

  describe("config null (no agntc.json)", () => {
    it("returns failure for remote plugin", async () => {
      const key = "owner/repo";
      const entry = makeEntry();
      const manifest = makeManifest(key, entry);

      mockCloneSource.mockResolvedValue({
        tempDir: "/tmp/agntc-clone",
        commit: REMOTE_SHA,
      });
      mockReadConfig.mockResolvedValue(null);

      const result = await executeUpdateAction(
        key,
        entry,
        manifest,
        "/fake/project",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("no agntc.json");
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
    });

    it("returns failure for local plugin", async () => {
      const key = "/Users/lee/Code/my-plugin";
      const entry = makeEntry({ commit: null, ref: null });
      const manifest = makeManifest(key, entry);

      mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
      mockReadConfig.mockResolvedValue(null);

      const result = await executeUpdateAction(
        key,
        entry,
        manifest,
        "/fake/project",
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain("no agntc.json");
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
    });
  });

  describe("collection key (3+ parts)", () => {
    it("resolves sourceDir correctly for collection plugin", async () => {
      const key = "owner/repo/go";
      const entry = makeEntry({
        agents: ["claude"],
        files: [".claude/skills/go/"],
      });
      const manifest = makeManifest(key, entry);

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
      // readConfig and detectType use the subdir
      expect(mockReadConfig).toHaveBeenCalledWith(
        "/tmp/agntc-clone/go",
        expect.anything(),
      );
      expect(mockDetectType).toHaveBeenCalledWith(
        "/tmp/agntc-clone/go",
        expect.anything(),
      );
    });
  });
});

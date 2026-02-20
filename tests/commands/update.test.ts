import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { CloneResult } from "../../src/git-clone.js";
import type { AgntcConfig } from "../../src/config.js";
import type { DetectedType } from "../../src/type-detection.js";
import type {
  CopyPluginAssetsResult,
} from "../../src/copy-plugin-assets.js";
import type { CopyBareSkillResult } from "../../src/copy-bare-skill.js";
import type { UpdateCheckResult } from "../../src/update-check.js";
import type { NukeResult } from "../../src/nuke-files.js";
import type { Stats } from "node:fs";
import { ExitSignal } from "../../src/exit-signal.js";

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
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
  addEntry: vi.fn(),
}));

vi.mock("../../src/update-check.js", () => ({
  checkForUpdate: vi.fn(),
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
import { readManifest, writeManifest, addEntry } from "../../src/manifest.js";
import { checkForUpdate } from "../../src/update-check.js";
import { cloneSource, cleanupTempDir } from "../../src/git-clone.js";
import { readConfig } from "../../src/config.js";
import { detectType } from "../../src/type-detection.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { getDriver } from "../../src/drivers/registry.js";
import { stat } from "node:fs/promises";
import { runUpdate } from "../../src/commands/update.js";

const mockReadManifest = vi.mocked(readManifest);
const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockCheckForUpdate = vi.mocked(checkForUpdate);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockStat = vi.mocked(stat);
const mockOutro = vi.mocked(p.outro);
const mockLog = vi.mocked(p.log);
const mockCancel = vi.mocked(p.cancel);

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
  vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
  mockWriteManifest.mockResolvedValue(undefined);
  mockCleanupTempDir.mockResolvedValue(undefined);
  mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
  mockGetDriver.mockReturnValue(fakeDriver);
  mockAddEntry.mockImplementation((manifest, key, entry) => ({
    ...manifest,
    [key]: entry,
  }));
});

describe("update command", () => {
  describe("no key provided", () => {
    it("shows error and exits 1 when no key argument given", async () => {
      const err = await runUpdate().catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        "Please specify a plugin to update: npx agntc update owner/repo",
      );
    });
  });

  describe("empty manifest", () => {
    it("displays message and exits 0", async () => {
      mockReadManifest.mockResolvedValue({});

      await runUpdate("owner/repo");

      expect(mockOutro).toHaveBeenCalledWith("No plugins installed.");
      expect(mockCheckForUpdate).not.toHaveBeenCalled();
    });
  });

  describe("non-existent key", () => {
    it("exits 1 with error message", async () => {
      mockReadManifest.mockResolvedValue({
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
      mockReadManifest.mockResolvedValue({
        "owner/repo": makeEntry(),
      });
      mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

      await runUpdate("owner/repo");

      expect(mockOutro).toHaveBeenCalledWith(
        "owner/repo is already up to date.",
      );
      expect(mockCloneSource).not.toHaveBeenCalled();
    });
  });

  describe("check-failed", () => {
    it("exits 1 with error when update check fails", async () => {
      mockReadManifest.mockResolvedValue({
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
        agents: ["claude"],
        files: [".claude/skills/my-skill/"],
      });
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
        type: "plugin",
        assetDirs: ["skills"],
      } as DetectedType);
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/skills/new-skill/"],
        assetCountsByAgent: { claude: { skills: 1 } },
      });

      await runUpdate("owner/repo");

      expect(mockNukeManifestFiles).toHaveBeenCalledWith(
        "/fake/project",
        [".claude/skills/my-skill/"],
      );
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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

    it("warns when agents are dropped by new version", async () => {
      const entry = makeEntry({
        agents: ["claude", "codex"],
        files: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
      });
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
        expect.stringContaining("no longer supports any of your installed agents"),
      );
      expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
    });

    it("exits 0 when all agents dropped (preserves existing files)", async () => {
      const entry = makeEntry({
        agents: ["codex"],
        files: [".agents/skills/my-skill/"],
      });
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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

  describe("temp dir cleanup", () => {
    it("cleans up temp dir on successful update", async () => {
      const entry = makeEntry();
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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

    it("uses null ref for HEAD-tracking plugins", async () => {
      const entry = makeEntry({ ref: null });
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
        agents: ["claude"],
        files: [".claude/skills/old-skill/", ".claude/agents/executor.md"],
      });
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
        type: "plugin",
        assetDirs: ["skills", "agents"],
      } as DetectedType);
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/skills/new-skill/", ".claude/agents/executor.md"],
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
      mockReadManifest.mockResolvedValue({ "owner/repo": entry });
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
    it("treats newer-tags as up-to-date (tag-pinned)", async () => {
      mockReadManifest.mockResolvedValue({
        "owner/repo": makeEntry({ ref: "v1.0" }),
      });
      mockCheckForUpdate.mockResolvedValue({
        status: "newer-tags",
        tags: ["v2.0", "v3.0"],
      });

      await runUpdate("owner/repo");

      expect(mockOutro).toHaveBeenCalledWith(
        expect.stringContaining("owner/repo is already up to date"),
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
    };

    function setupLocalBase(): void {
      mockReadManifest.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
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
      mockReadManifest.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
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
      mockReadManifest.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
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
      mockReadManifest.mockResolvedValue({ [LOCAL_KEY]: entry });
      mockCheckForUpdate.mockResolvedValue({ status: "local" });
      mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
      // New config only supports claude, entry has codex
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });

      await runUpdate(LOCAL_KEY);

      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
      expect(mockWriteManifest).not.toHaveBeenCalled();
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("no longer supports any of your installed agents"),
      );
    });

    it("uses effective agents for partial drop", async () => {
      const entry: ManifestEntry = {
        ...LOCAL_ENTRY,
        agents: ["claude", "codex"],
        files: [".claude/skills/my-plugin/", ".agents/skills/my-plugin/"],
      };
      mockReadManifest.mockResolvedValue({ [LOCAL_KEY]: entry });
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

    it("errors when config is null (no agntc.json)", async () => {
      mockReadManifest.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
      mockCheckForUpdate.mockResolvedValue({ status: "local" });
      mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
      mockReadConfig.mockResolvedValue(null);

      const err = await runUpdate(LOCAL_KEY).catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining("no agntc.json"),
      );
    });

    it("uses copyPluginAssets when type is plugin", async () => {
      mockReadManifest.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
      mockCheckForUpdate.mockResolvedValue({ status: "local" });
      mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "plugin",
        assetDirs: ["skills", "agents"],
      } as DetectedType);
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
        agents: ["claude"],
        files: [".claude/skills/go/"],
      });
      mockReadManifest.mockResolvedValue({ "owner/repo/go": entry });
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
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
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

  describe("manifest read error", () => {
    it("exits 1 on manifest read failure", async () => {
      mockReadManifest.mockRejectedValue(new Error("Permission denied"));

      const err = await runUpdate("owner/repo").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read manifest"),
      );
    });
  });
});

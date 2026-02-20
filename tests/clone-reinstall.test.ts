import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ManifestEntry } from "../src/manifest.js";
import type { DetectedType } from "../src/type-detection.js";
import type { AgentId } from "../src/drivers/types.js";

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

vi.mock("../src/copy-plugin-assets.js", () => ({
  copyPluginAssets: vi.fn(),
}));

vi.mock("../src/copy-bare-skill.js", () => ({
  copyBareSkill: vi.fn(),
}));

vi.mock("../src/drivers/registry.js", () => ({
  getDriver: vi.fn(),
}));

import * as p from "@clack/prompts";
import { cloneSource, cleanupTempDir } from "../src/git-clone.js";
import { readConfig } from "../src/config.js";
import { detectType } from "../src/type-detection.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { getDriver } from "../src/drivers/registry.js";
import {
  cloneAndReinstall,
  formatAgentsDroppedWarning,
} from "../src/clone-reinstall.js";

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
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
    cloneUrl: null,
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
  mockCleanupTempDir.mockResolvedValue(undefined);
  mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
  mockGetDriver.mockReturnValue(fakeDriver);
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
      const entry = makeEntry();

      mockCloneSource.mockResolvedValue({
        tempDir: "/tmp/agntc-clone",
        commit: REMOTE_SHA,
      });
      mockReadConfig.mockResolvedValue(null);

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
      vi.mocked(p.spinner).mockReturnValue(mockSpinner as ReturnType<typeof p.spinner>);

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

  describe("no-config status", () => {
    it("returns failed with no-config message for remote", async () => {
      const entry = makeEntry();

      mockCloneSource.mockResolvedValue({
        tempDir: "/tmp/agntc-clone",
        commit: REMOTE_SHA,
      });
      mockReadConfig.mockResolvedValue(null);

      const result = await cloneAndReinstall({
        key: "owner/repo",
        entry,
        projectDir: "/fake/project",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.failureReason).toBe("no-config");
        expect(result.message).toContain("no agntc.json");
      }
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

  describe("invalid-type status", () => {
    it("returns failed with invalid-type message", async () => {
      const entry = makeEntry();

      mockCloneSource.mockResolvedValue({
        tempDir: "/tmp/agntc-clone",
        commit: REMOTE_SHA,
      });
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "not-agntc",
      } as DetectedType);

      const result = await cloneAndReinstall({
        key: "owner/repo",
        entry,
        projectDir: "/fake/project",
      });

      expect(result.status).toBe("failed");
      if (result.status === "failed") {
        expect(result.failureReason).toBe("invalid-type");
        expect(result.message).toContain("not a valid plugin");
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
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ManifestEntry } from "../src/manifest.js";
import type { DetectedType } from "../src/type-detection.js";

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

import { readConfig } from "../src/config.js";
import { detectType } from "../src/type-detection.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { getDriver } from "../src/drivers/registry.js";
import {
  executeNukeAndReinstall,
  type NukeReinstallOptions,
} from "../src/nuke-reinstall-pipeline.js";

const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);

const fakeDriver = {
  detect: vi.fn().mockResolvedValue(true),
  getTargetDir: vi.fn((assetType: string) => {
    if (assetType === "skills") return ".claude/skills";
    if (assetType === "agents") return ".claude/agents";
    if (assetType === "hooks") return ".claude/hooks";
    return null;
  }),
};

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    ref: null,
    commit: "a".repeat(40),
    installedAt: "2026-02-01T00:00:00.000Z",
    agents: ["claude"],
    files: [".claude/skills/my-skill/"],
    cloneUrl: null,
    ...overrides,
  };
}

function makeOptions(
  overrides: Partial<NukeReinstallOptions> = {},
): NukeReinstallOptions {
  return {
    key: "owner/repo",
    sourceDir: "/tmp/source",
    existingEntry: makeEntry(),
    projectDir: "/fake/project",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
  mockGetDriver.mockReturnValue(fakeDriver);
});

describe("executeNukeAndReinstall", () => {
  describe("successful bare-skill pipeline", () => {
    it("calls readConfig, detectType, nukeManifestFiles, copyBareSkill and returns correct ManifestEntry", async () => {
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-skill/"],
      });

      const result = await executeNukeAndReinstall(makeOptions());

      expect(result.status).toBe("success");
      if (result.status !== "success") return;

      expect(mockReadConfig).toHaveBeenCalledWith(
        "/tmp/source",
        { onWarn: undefined },
      );
      expect(mockDetectType).toHaveBeenCalledWith(
        "/tmp/source",
        { hasConfig: true, onWarn: undefined },
      );
      expect(mockNukeManifestFiles).toHaveBeenCalledWith(
        "/fake/project",
        [".claude/skills/my-skill/"],
      );
      expect(mockCopyBareSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDir: "/tmp/source",
          projectDir: "/fake/project",
        }),
      );
      expect(result.entry.agents).toEqual(["claude"]);
      expect(result.entry.files).toEqual([".claude/skills/my-skill/"]);
      expect(result.copiedFiles).toEqual([".claude/skills/my-skill/"]);
    });
  });

  describe("successful plugin pipeline", () => {
    it("routes to copyPluginAssets for plugin type", async () => {
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "plugin",
        assetDirs: ["skills", "agents"],
      } as DetectedType);
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/skills/new-skill/", ".claude/agents/exec.md"],
        assetCountsByAgent: { claude: { skills: 1, agents: 1 } },
      });

      const result = await executeNukeAndReinstall(makeOptions());

      expect(result.status).toBe("success");
      if (result.status !== "success") return;

      expect(mockCopyPluginAssets).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDir: "/tmp/source",
          assetDirs: ["skills", "agents"],
          projectDir: "/fake/project",
        }),
      );
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
      expect(result.copiedFiles).toEqual([
        ".claude/skills/new-skill/",
        ".claude/agents/exec.md",
      ]);
    });
  });

  describe("dropped-agents callback", () => {
    it("invokes onAgentsDropped when new config removes agents", async () => {
      const onAgentsDropped = vi.fn();
      const options = makeOptions({
        existingEntry: makeEntry({ agents: ["claude", "codex"] }),
        onAgentsDropped,
      });

      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-skill/"],
      });

      const result = await executeNukeAndReinstall(options);

      expect(result.status).toBe("success");
      if (result.status !== "success") return;

      expect(onAgentsDropped).toHaveBeenCalledWith(["codex"], ["claude"]); // dropped, newConfigAgents
      expect(result.droppedAgents).toEqual(["codex"]);
      expect(result.entry.agents).toEqual(["claude"]);
    });
  });

  describe("all agents dropped", () => {
    it("returns no-agents failure when all agents are dropped", async () => {
      const options = makeOptions({
        existingEntry: makeEntry({ agents: ["codex"] }),
      });

      mockReadConfig.mockResolvedValue({ agents: ["claude"] });

      const result = await executeNukeAndReinstall(options);

      expect(result.status).toBe("no-agents");
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
      expect(mockCopyPluginAssets).not.toHaveBeenCalled();
    });
  });

  describe("null config (no agntc.json)", () => {
    it("returns no-config failure", async () => {
      mockReadConfig.mockResolvedValue(null);

      const result = await executeNukeAndReinstall(makeOptions());

      expect(result.status).toBe("no-config");
      expect(mockDetectType).not.toHaveBeenCalled();
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
    });
  });

  describe("invalid type", () => {
    it("returns invalid-type failure for not-agntc", async () => {
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "not-agntc",
      } as DetectedType);

      const result = await executeNukeAndReinstall(makeOptions());

      expect(result.status).toBe("invalid-type");
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
    });

    it("returns invalid-type failure for collection", async () => {
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "collection",
        plugins: ["a"],
      } as DetectedType);

      const result = await executeNukeAndReinstall(makeOptions());

      expect(result.status).toBe("invalid-type");
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
    });
  });

  describe("ref and commit overrides", () => {
    it("uses newRef and newCommit when provided", async () => {
      const options = makeOptions({
        newRef: "v2.0.0",
        newCommit: "b".repeat(40),
      });

      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-skill/"],
      });

      const result = await executeNukeAndReinstall(options);

      expect(result.status).toBe("success");
      if (result.status !== "success") return;

      expect(result.entry.ref).toBe("v2.0.0");
      expect(result.entry.commit).toBe("b".repeat(40));
    });

    it("preserves existing entry ref/commit when overrides not provided", async () => {
      const options = makeOptions({
        existingEntry: makeEntry({ ref: "v1.0", commit: "a".repeat(40) }),
      });

      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-skill/"],
      });

      const result = await executeNukeAndReinstall(options);

      expect(result.status).toBe("success");
      if (result.status !== "success") return;

      expect(result.entry.ref).toBe("v1.0");
      expect(result.entry.commit).toBe("a".repeat(40));
    });
  });

  describe("onWarn callback", () => {
    it("passes onWarn to readConfig and detectType", async () => {
      const onWarn = vi.fn();
      const options = makeOptions({ onWarn });

      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-skill/"],
      });

      await executeNukeAndReinstall(options);

      expect(mockReadConfig).toHaveBeenCalledWith(
        "/tmp/source",
        expect.objectContaining({ onWarn }),
      );
      expect(mockDetectType).toHaveBeenCalledWith(
        "/tmp/source",
        expect.objectContaining({ onWarn }),
      );
    });
  });

  describe("copy failure after nuke", () => {
    it("returns copy-failed with recovery message when copyBareSkill throws", async () => {
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockRejectedValue(new Error("ENOSPC: no space left on device"));

      const result = await executeNukeAndReinstall(makeOptions());

      expect(result.status).toBe("copy-failed");
      if (result.status !== "copy-failed") return;

      expect(result.errorMessage).toBe("ENOSPC: no space left on device");
      expect(result.recoveryHint).toBe(
        "Update failed for owner/repo after removing old files. The plugin is currently uninstalled. Run `npx agntc update owner/repo` to retry installation.",
      );
    });

    it("returns copy-failed with recovery message when copyPluginAssets throws", async () => {
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "plugin",
        assetDirs: ["skills"],
      } as DetectedType);
      mockCopyPluginAssets.mockRejectedValue(new Error("EACCES: permission denied"));

      const result = await executeNukeAndReinstall(makeOptions());

      expect(result.status).toBe("copy-failed");
      if (result.status !== "copy-failed") return;

      expect(result.errorMessage).toBe("EACCES: permission denied");
      expect(result.recoveryHint).toBe(
        "Update failed for owner/repo after removing old files. The plugin is currently uninstalled. Run `npx agntc update owner/repo` to retry installation.",
      );
    });

    it("confirms nuke was called before copy failed", async () => {
      mockReadConfig.mockResolvedValue({ agents: ["claude"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

      await executeNukeAndReinstall(makeOptions());

      expect(mockNukeManifestFiles).toHaveBeenCalledWith(
        "/fake/project",
        [".claude/skills/my-skill/"],
      );
    });
  });

  describe("agent+driver pair construction", () => {
    it("builds agents with drivers from effective agents", async () => {
      const options = makeOptions({
        existingEntry: makeEntry({ agents: ["claude", "codex"] }),
      });

      mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
      mockDetectType.mockResolvedValue({
        type: "bare-skill",
      } as DetectedType);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
      });

      const result = await executeNukeAndReinstall(options);

      expect(result.status).toBe("success");
      expect(mockGetDriver).toHaveBeenCalledWith("claude");
      expect(mockGetDriver).toHaveBeenCalledWith("codex");
      expect(mockCopyBareSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          agents: [
            expect.objectContaining({ id: "claude" }),
            expect.objectContaining({ id: "codex" }),
          ],
        }),
      );
    });
  });
});

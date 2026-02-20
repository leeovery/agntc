import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentId } from "../../src/drivers/types.js";
import type { ParsedSource } from "../../src/source-parser.js";
import type { CloneResult } from "../../src/git-clone.js";
import type { AgntcConfig } from "../../src/config.js";
import type { DetectedType } from "../../src/type-detection.js";
import type { CopyBareSkillResult } from "../../src/copy-bare-skill.js";
import type {
  CopyPluginAssetsResult,
} from "../../src/copy-plugin-assets.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import { ExitSignal } from "../../src/exit-signal.js";

// Mock all dependencies before importing the module under test
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
  },
  cancel: vi.fn(),
}));

vi.mock("../../src/source-parser.js", () => ({
  parseSource: vi.fn(),
}));

vi.mock("../../src/git-clone.js", () => ({
  cloneSource: vi.fn(),
  cleanupTempDir: vi.fn(),
}));

vi.mock("../../src/config.js", () => ({
  readConfig: vi.fn(),
  ConfigError: class ConfigError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ConfigError";
    }
  },
}));

vi.mock("../../src/type-detection.js", () => ({
  detectType: vi.fn(),
}));

vi.mock("../../src/drivers/registry.js", () => ({
  getRegisteredAgentIds: vi.fn(),
  getDriver: vi.fn(),
}));

vi.mock("../../src/agent-select.js", () => ({
  selectAgents: vi.fn(),
}));

vi.mock("../../src/collection-select.js", () => ({
  selectCollectionPlugins: vi.fn(),
}));

vi.mock("../../src/copy-bare-skill.js", () => ({
  copyBareSkill: vi.fn(),
}));

vi.mock("../../src/copy-plugin-assets.js", () => ({
  copyPluginAssets: vi.fn(),
}));

vi.mock("../../src/manifest.js", () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
  addEntry: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
  nukeManifestFiles: vi.fn(),
}));

import * as p from "@clack/prompts";
import { parseSource } from "../../src/source-parser.js";
import { cloneSource, cleanupTempDir } from "../../src/git-clone.js";
import { readConfig } from "../../src/config.js";
import { detectType } from "../../src/type-detection.js";
import {
  getRegisteredAgentIds,
  getDriver,
} from "../../src/drivers/registry.js";
import { selectAgents } from "../../src/agent-select.js";
import { selectCollectionPlugins } from "../../src/collection-select.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import { readManifest, writeManifest, addEntry } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { runAdd } from "../../src/commands/add.js";

const mockParseSource = vi.mocked(parseSource);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockGetRegisteredAgentIds = vi.mocked(getRegisteredAgentIds);
const mockGetDriver = vi.mocked(getDriver);
const mockSelectAgents = vi.mocked(selectAgents);
const mockSelectCollectionPlugins = vi.mocked(selectCollectionPlugins);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockReadManifest = vi.mocked(readManifest);
const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockIntro = vi.mocked(p.intro);
const mockOutro = vi.mocked(p.outro);
const mockSpinner = vi.mocked(p.spinner);
const mockCancel = vi.mocked(p.cancel);
const mockLog = vi.mocked(p.log);

const PARSED: ParsedSource = {
  type: "github-shorthand",
  owner: "owner",
  repo: "my-skill",
  ref: "main",
  manifestKey: "owner/my-skill",
};

const CLONE_RESULT: CloneResult = {
  tempDir: "/tmp/agntc-abc123",
  commit: "abc123def456",
};

const CONFIG: AgntcConfig = { agents: ["claude"] };

const BARE_SKILL: DetectedType = { type: "bare-skill" };

const FAKE_DRIVER = {
  detect: vi.fn().mockResolvedValue(true),
  getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
};

const COPY_RESULT: CopyBareSkillResult = {
  copiedFiles: [".claude/skills/my-skill/"],
};

const EMPTY_MANIFEST: Manifest = {};

const MANIFEST_ENTRY: ManifestEntry = {
  ref: "main",
  commit: "abc123def456",
  installedAt: expect.any(String),
  agents: ["claude"],
  files: [".claude/skills/my-skill/"],
};

const UPDATED_MANIFEST: Manifest = {
  "owner/my-skill": MANIFEST_ENTRY,
};

function setupHappyPath(): void {
  mockParseSource.mockReturnValue(PARSED);
  mockCloneSource.mockResolvedValue(CLONE_RESULT);
  mockReadConfig.mockResolvedValue(CONFIG);
  mockDetectType.mockResolvedValue(BARE_SKILL);
  mockGetRegisteredAgentIds.mockReturnValue(["claude"] as AgentId[]);
  mockGetDriver.mockReturnValue(FAKE_DRIVER);
  mockSelectAgents.mockResolvedValue(["claude"] as AgentId[]);
  mockCopyBareSkill.mockResolvedValue(COPY_RESULT);
  mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
  mockAddEntry.mockReturnValue(UPDATED_MANIFEST);
  mockWriteManifest.mockResolvedValue(undefined);
  mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
  mockCleanupTempDir.mockResolvedValue(undefined);
}

let mockCwd: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCwd = vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
  setupHappyPath();
});

describe("add command", () => {
  describe("happy path", () => {
    it("runs full pipeline: parse, clone, config, detect, select, copy, manifest, summary, cleanup", async () => {
      await runAdd("owner/my-skill");

      expect(mockParseSource).toHaveBeenCalledWith("owner/my-skill");
      expect(mockCloneSource).toHaveBeenCalledWith(PARSED);
      expect(mockReadConfig).toHaveBeenCalledWith(
        CLONE_RESULT.tempDir,
        expect.objectContaining({ onWarn: expect.any(Function) }),
      );
      expect(mockDetectType).toHaveBeenCalledWith(
        CLONE_RESULT.tempDir,
        expect.objectContaining({
          hasConfig: true,
          onWarn: expect.any(Function),
        }),
      );
      expect(mockGetRegisteredAgentIds).toHaveBeenCalled();
      expect(mockSelectAgents).toHaveBeenCalled();
      expect(mockCopyBareSkill).toHaveBeenCalled();
      expect(mockReadManifest).toHaveBeenCalledWith("/fake/project");
      expect(mockWriteManifest).toHaveBeenCalled();
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("shows intro and outro", async () => {
      await runAdd("owner/my-skill");

      expect(mockIntro).toHaveBeenCalledWith("agntc add");
      expect(mockOutro).toHaveBeenCalled();
    });

    it("uses spinners during clone and copy", async () => {
      const spinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      mockSpinner.mockReturnValue(spinnerInstance);

      await runAdd("owner/my-skill");

      expect(mockSpinner).toHaveBeenCalled();
      expect(spinnerInstance.start).toHaveBeenCalledTimes(2);
      const startCalls = spinnerInstance.start.mock.calls.map(
        (c) => c[0] as string,
      );
      expect(startCalls.some((msg) => msg.includes("Clon"))).toBe(true);
      expect(startCalls.some((msg) => msg.includes("Copy"))).toBe(true);
      expect(spinnerInstance.stop).toHaveBeenCalled();
    });

    it("uses process.cwd() as project dir", async () => {
      await runAdd("owner/my-skill");

      expect(mockCwd).toHaveBeenCalled();
      expect(mockReadManifest).toHaveBeenCalledWith("/fake/project");
    });

    it("uses skillName from parsed.repo", async () => {
      await runAdd("owner/my-skill");

      // copyBareSkill should use the repo name, not the tempDir basename
      const copyCall = mockCopyBareSkill.mock.calls[0]![0];
      // The sourceDir should be the tempDir (which contains the repo)
      expect(copyCall.sourceDir).toBe(CLONE_RESULT.tempDir);
    });
  });

  describe("detect agents", () => {
    it("calls detect on all registered agents", async () => {
      const claudeDriver = {
        detect: vi.fn().mockResolvedValue(true),
        getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
      };
      const codexDriver = {
        detect: vi.fn().mockResolvedValue(false),
        getTargetDir: vi.fn().mockReturnValue(".codex/skills"),
      };

      mockGetRegisteredAgentIds.mockReturnValue([
        "claude",
        "codex",
      ] as AgentId[]);
      mockGetDriver.mockImplementation((id: AgentId) => {
        if (id === "claude") return claudeDriver;
        return codexDriver;
      });
      mockSelectAgents.mockResolvedValue(["claude"] as AgentId[]);

      await runAdd("owner/my-skill");

      expect(claudeDriver.detect).toHaveBeenCalledWith("/fake/project");
      expect(codexDriver.detect).toHaveBeenCalledWith("/fake/project");
    });

    it("passes correct declaredAgents and detectedAgents to selectAgents", async () => {
      const claudeDriver = {
        detect: vi.fn().mockResolvedValue(true),
        getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
      };
      const codexDriver = {
        detect: vi.fn().mockResolvedValue(false),
        getTargetDir: vi.fn().mockReturnValue(".codex/skills"),
      };

      mockGetRegisteredAgentIds.mockReturnValue([
        "claude",
        "codex",
      ] as AgentId[]);
      mockGetDriver.mockImplementation((id: AgentId) => {
        if (id === "claude") return claudeDriver;
        return codexDriver;
      });
      mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
      mockSelectAgents.mockResolvedValue(["claude"] as AgentId[]);

      await runAdd("owner/my-skill");

      expect(mockSelectAgents).toHaveBeenCalledWith({
        declaredAgents: ["claude", "codex"],
        detectedAgents: ["claude"],
      });
    });
  });

  describe("copy bare skill", () => {
    it("passes correct args to copyBareSkill", async () => {
      await runAdd("owner/my-skill");

      expect(mockCopyBareSkill).toHaveBeenCalledWith({
        sourceDir: CLONE_RESULT.tempDir,
        projectDir: "/fake/project",
        agents: [{ id: "claude", driver: FAKE_DRIVER }],
      });
    });
  });

  describe("manifest", () => {
    it("reads existing manifest before adding", async () => {
      const existingManifest: Manifest = {
        "other/repo": {
          ref: "v1",
          commit: "old123",
          installedAt: "2026-01-01T00:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/repo/"],
        },
      };
      mockReadManifest.mockResolvedValue(existingManifest);

      await runAdd("owner/my-skill");

      expect(mockAddEntry).toHaveBeenCalledWith(
        existingManifest,
        "owner/my-skill",
        expect.objectContaining({
          ref: "main",
          commit: "abc123def456",
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        }),
      );
    });

    it("creates correct manifest entry fields", async () => {
      await runAdd("owner/my-skill");

      expect(mockAddEntry).toHaveBeenCalledWith(
        EMPTY_MANIFEST,
        "owner/my-skill",
        expect.objectContaining({
          ref: "main",
          commit: "abc123def456",
          installedAt: expect.any(String),
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        }),
      );

      // Verify installedAt is a valid ISO string
      const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
      expect(new Date(entry.installedAt).toISOString()).toBe(
        entry.installedAt,
      );
    });

    it("writes updated manifest", async () => {
      await runAdd("owner/my-skill");

      expect(mockWriteManifest).toHaveBeenCalledWith(
        "/fake/project",
        UPDATED_MANIFEST,
      );
    });
  });

  describe("summary", () => {
    it("shows key, ref, and per-agent skill count", async () => {
      await runAdd("owner/my-skill");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("owner/my-skill");
      expect(outroCall).toContain("main");
      expect(outroCall).toContain("claude");
      expect(outroCall).toContain("1");
    });
  });

  describe("warnings", () => {
    it("forwards config warnings to clack log.warn", async () => {
      mockReadConfig.mockImplementation(async (_dir, options) => {
        options?.onWarn?.("unknown agent warning");
        return CONFIG;
      });

      await runAdd("owner/my-skill");

      expect(mockLog.warn).toHaveBeenCalledWith("unknown agent warning");
    });

    it("forwards type-detection warnings to clack log.warn", async () => {
      mockDetectType.mockImplementation(async (_dir, options) => {
        options.onWarn?.("not-agntc warning");
        return BARE_SKILL;
      });

      await runAdd("owner/my-skill");

      expect(mockLog.warn).toHaveBeenCalledWith("not-agntc warning");
    });
  });

  describe("error: invalid source", () => {
    it("shows error and exits 1 with no clone attempted", async () => {
      mockParseSource.mockImplementation(() => {
        throw new Error('source must be in owner/repo format, got "bad"');
      });

      const err = await runAdd("bad").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockCloneSource).not.toHaveBeenCalled();
    });
  });

  describe("error: clone failure", () => {
    it("shows error, cleans up, and exits 1", async () => {
      mockCloneSource.mockRejectedValue(new Error("git clone failed"));

      const err = await runAdd("owner/my-skill").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockCancel).toHaveBeenCalled();
    });
  });

  describe("error: invalid config", () => {
    it("shows error, cleans up, and exits 1", async () => {
      const { ConfigError } = await import("../../src/config.js");
      mockReadConfig.mockRejectedValue(
        new ConfigError("agents must not be empty"),
      );

      const err = await runAdd("owner/my-skill").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });
  });

  describe("collection type", () => {
    const COLLECTION_PARSED: ParsedSource = {
      type: "github-shorthand",
      owner: "owner",
      repo: "my-collection",
      ref: "main",
      manifestKey: "owner/my-collection",
    };

    const COLLECTION_CLONE_RESULT: CloneResult = {
      tempDir: "/tmp/agntc-coll123",
      commit: "coll123def456",
    };

    const COLLECTION_DETECTED: DetectedType = {
      type: "collection",
      plugins: ["pluginA", "pluginB"],
    };

    const PLUGIN_A_CONFIG: AgntcConfig = { agents: ["claude"] };
    const PLUGIN_B_CONFIG: AgntcConfig = { agents: ["claude"] };

    const PLUGIN_A_BARE: DetectedType = { type: "bare-skill" };
    const PLUGIN_B_BARE: DetectedType = { type: "bare-skill" };

    function setupCollectionBase(): void {
      mockParseSource.mockReturnValue(COLLECTION_PARSED);
      mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
      // Root readConfig returns null (no root agntc.json)
      mockReadConfig.mockResolvedValue(null);
      mockDetectType.mockResolvedValue(COLLECTION_DETECTED);
      mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
      mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
      mockGetRegisteredAgentIds.mockReturnValue(["claude"] as AgentId[]);
      mockGetDriver.mockReturnValue(FAKE_DRIVER);
      mockSelectAgents.mockResolvedValue(["claude"] as AgentId[]);
      mockWriteManifest.mockResolvedValue(undefined);
      mockCleanupTempDir.mockResolvedValue(undefined);
      mockAddEntry.mockImplementation((manifest, key, entry) => ({
        ...manifest,
        [key]: entry,
      }));
    }

    function setupCollectionBareSkills(): void {
      setupCollectionBase();
      // Per-plugin readConfig
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        if (dir.endsWith("/pluginA")) return PLUGIN_A_CONFIG;
        if (dir.endsWith("/pluginB")) return PLUGIN_B_CONFIG;
        return null;
      });
      // Per-plugin detectType
      mockDetectType.mockImplementation(async (dir, options) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) {
          return COLLECTION_DETECTED;
        }
        if (dir.endsWith("/pluginA")) return PLUGIN_A_BARE;
        if (dir.endsWith("/pluginB")) return PLUGIN_B_BARE;
        return { type: "not-agntc" };
      });
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginA/"],
      });
    }

    it("collection with bare-skill plugins runs full pipeline", async () => {
      setupCollectionBareSkills();
      mockCopyBareSkill
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

      await runAdd("owner/my-collection");

      expect(mockSelectCollectionPlugins).toHaveBeenCalledWith({
        plugins: ["pluginA", "pluginB"],
        manifest: EMPTY_MANIFEST,
        manifestKeyPrefix: "owner/my-collection",
      });
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
      expect(mockWriteManifest).toHaveBeenCalledTimes(1);
      expect(mockCleanupTempDir).toHaveBeenCalledWith(
        COLLECTION_CLONE_RESULT.tempDir,
      );
    });

    it("collection with multi-asset plugins uses copyPluginAssets", async () => {
      setupCollectionBase();
      const pluginDetected: DetectedType = {
        type: "plugin",
        assetDirs: ["skills", "agents"],
      };
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return pluginDetected;
      });
      mockCopyPluginAssets
        .mockResolvedValueOnce({
          copiedFiles: [".claude/skills/planning/"],
          assetCountsByAgent: { claude: { skills: 1 } },
        })
        .mockResolvedValueOnce({
          copiedFiles: [".claude/agents/reviewer/"],
          assetCountsByAgent: { claude: { agents: 1 } },
        });

      await runAdd("owner/my-collection");

      expect(mockCopyPluginAssets).toHaveBeenCalledTimes(2);
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
    });

    it("mixed types install each by type", async () => {
      setupCollectionBase();
      const pluginDetected: DetectedType = {
        type: "plugin",
        assetDirs: ["skills"],
      };
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        if (dir.endsWith("/pluginA")) return { type: "bare-skill" } as DetectedType;
        return pluginDetected;
      });
      mockCopyBareSkill.mockResolvedValueOnce({
        copiedFiles: [".claude/skills/pluginA/"],
      });
      mockCopyPluginAssets.mockResolvedValueOnce({
        copiedFiles: [".claude/skills/planning/"],
        assetCountsByAgent: { claude: { skills: 1 } },
      });

      await runAdd("owner/my-collection");

      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
      expect(mockCopyPluginAssets).toHaveBeenCalledTimes(1);
    });

    it("manifest keys use owner/repo/plugin-name format", async () => {
      setupCollectionBareSkills();
      mockCopyBareSkill
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

      await runAdd("owner/my-collection");

      const addEntryCalls = mockAddEntry.mock.calls;
      const keys = addEntryCalls.map((call) => call[1]);
      expect(keys).toContain("owner/my-collection/pluginA");
      expect(keys).toContain("owner/my-collection/pluginB");
    });

    it("agent multiselect called once for all plugins", async () => {
      setupCollectionBareSkills();
      mockCopyBareSkill
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

      await runAdd("owner/my-collection");

      expect(mockSelectAgents).toHaveBeenCalledTimes(1);
    });

    it("agent multiselect uses union of declared agents from all selected plugins", async () => {
      setupCollectionBase();
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        if (dir.endsWith("/pluginA")) return { agents: ["claude"] };
        if (dir.endsWith("/pluginB")) return { agents: ["claude", "codex"] };
        return null;
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      mockGetRegisteredAgentIds.mockReturnValue([
        "claude",
        "codex",
      ] as AgentId[]);
      const claudeDriver = {
        detect: vi.fn().mockResolvedValue(true),
        getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
      };
      const codexDriver = {
        detect: vi.fn().mockResolvedValue(true),
        getTargetDir: vi.fn().mockReturnValue(".codex/skills"),
      };
      mockGetDriver.mockImplementation((id: AgentId) => {
        if (id === "claude") return claudeDriver;
        return codexDriver;
      });
      mockSelectAgents.mockResolvedValue(["claude", "codex"] as AgentId[]);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginA/"],
      });

      await runAdd("owner/my-collection");

      expect(mockSelectAgents).toHaveBeenCalledWith(
        expect.objectContaining({
          declaredAgents: expect.arrayContaining(["claude", "codex"]),
        }),
      );
    });

    it("invalid agntc.json skips plugin with warning", async () => {
      setupCollectionBase();
      const { ConfigError } = await import("../../src/config.js");
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        if (dir.endsWith("/pluginA")) throw new ConfigError("bad json");
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginB/"],
      });

      await runAdd("owner/my-collection");

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("pluginA"),
      );
      // Only pluginB should be copied
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
    });

    it("missing agntc.json skips plugin with warning", async () => {
      setupCollectionBase();
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        if (dir.endsWith("/pluginA")) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginB/"],
      });

      await runAdd("owner/my-collection");

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("pluginA"),
      );
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
    });

    it("not-agntc detected type skips plugin with warning", async () => {
      setupCollectionBase();
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        if (dir.endsWith("/pluginA")) return { type: "not-agntc" } as DetectedType;
        return { type: "bare-skill" } as DetectedType;
      });
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginB/"],
      });

      await runAdd("owner/my-collection");

      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringContaining("pluginA"),
      );
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
    });

    it("all plugins failing exits 0", async () => {
      setupCollectionBase();
      const { ConfigError } = await import("../../src/config.js");
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        throw new ConfigError("bad config");
      });
      // detectType still called for root
      mockDetectType.mockResolvedValue(COLLECTION_DETECTED);

      const err = await runAdd("owner/my-collection").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockCleanupTempDir).toHaveBeenCalledWith(
        COLLECTION_CLONE_RESULT.tempDir,
      );
    });

    it("empty plugin selection cancels cleanly", async () => {
      setupCollectionBase();
      mockSelectCollectionPlugins.mockResolvedValue([]);

      const err = await runAdd("owner/my-collection").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockCancel).toHaveBeenCalledWith(
        expect.stringMatching(/cancel/i),
      );
      expect(mockCleanupTempDir).toHaveBeenCalledWith(
        COLLECTION_CLONE_RESULT.tempDir,
      );
    });

    it("empty agent selection cancels cleanly", async () => {
      setupCollectionBase();
      // Read configs to get past the config phase
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      mockSelectAgents.mockResolvedValue([]);

      const err = await runAdd("owner/my-collection").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockCancel).toHaveBeenCalledWith(
        expect.stringMatching(/cancel/i),
      );
      expect(mockCleanupTempDir).toHaveBeenCalledWith(
        COLLECTION_CLONE_RESULT.tempDir,
      );
    });

    it("single manifest write after all plugins", async () => {
      setupCollectionBareSkills();
      mockCopyBareSkill
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

      await runAdd("owner/my-collection");

      expect(mockWriteManifest).toHaveBeenCalledTimes(1);
      // addEntry called twice (once per plugin)
      expect(mockAddEntry).toHaveBeenCalledTimes(2);
    });

    it("shows per-plugin summary with counts", async () => {
      setupCollectionBareSkills();
      mockCopyBareSkill
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

      await runAdd("owner/my-collection");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("pluginA");
      expect(outroCall).toContain("pluginB");
    });

    it("notes skipped plugins in summary", async () => {
      setupCollectionBase();
      const { ConfigError } = await import("../../src/config.js");
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        if (dir.endsWith("/pluginA")) throw new ConfigError("bad config");
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginB/"],
      });

      await runAdd("owner/my-collection");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("pluginB");
      expect(outroCall).toMatch(/1.*skipped/i);
    });

    it("cleanup on collection success", async () => {
      setupCollectionBareSkills();
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginA/"],
      });

      await runAdd("owner/my-collection");

      expect(mockCleanupTempDir).toHaveBeenCalledWith(
        COLLECTION_CLONE_RESULT.tempDir,
      );
    });

    it("cleanup on collection error", async () => {
      setupCollectionBase();
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      // Simulate unexpected error during copy
      mockCopyBareSkill.mockRejectedValue(new Error("unexpected"));

      await runAdd("owner/my-collection").catch(() => {});

      expect(mockCleanupTempDir).toHaveBeenCalledWith(
        COLLECTION_CLONE_RESULT.tempDir,
      );
    });

    it("passes pluginDir as sourceDir to copyBareSkill so skillName derives from pluginName", async () => {
      setupCollectionBase();
      mockSelectCollectionPlugins.mockResolvedValue(["pluginA"]);
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginA/"],
      });

      await runAdd("owner/my-collection");

      const copyCall = mockCopyBareSkill.mock.calls[0]![0];
      expect(copyCall.sourceDir).toBe(
        COLLECTION_CLONE_RESULT.tempDir + "/pluginA",
      );
    });
  });

  describe("plugin type", () => {
    const PLUGIN_DETECTED: DetectedType = {
      type: "plugin",
      assetDirs: ["skills", "agents"],
    };

    const PLUGIN_COPY_RESULT: CopyPluginAssetsResult = {
      copiedFiles: [
        ".claude/skills/planning/",
        ".claude/skills/planning/SKILL.md",
        ".claude/agents/reviewer/",
        ".claude/agents/reviewer/agent.md",
      ],
      assetCountsByAgent: {
        claude: { skills: 1, agents: 1 },
      },
    };

    const PLUGIN_MANIFEST_ENTRY: ManifestEntry = {
      ref: "main",
      commit: "abc123def456",
      installedAt: expect.any(String),
      agents: ["claude"],
      files: PLUGIN_COPY_RESULT.copiedFiles,
    };

    const PLUGIN_UPDATED_MANIFEST: Manifest = {
      "owner/my-skill": PLUGIN_MANIFEST_ENTRY,
    };

    function setupPluginPath(): void {
      mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
      mockCopyPluginAssets.mockResolvedValue(PLUGIN_COPY_RESULT);
      mockAddEntry.mockReturnValue(PLUGIN_UPDATED_MANIFEST);
    }

    it("triggers copyPluginAssets with correct args", async () => {
      setupPluginPath();

      await runAdd("owner/my-skill");

      expect(mockCopyPluginAssets).toHaveBeenCalledWith({
        sourceDir: CLONE_RESULT.tempDir,
        assetDirs: ["skills", "agents"],
        agents: [{ id: "claude", driver: FAKE_DRIVER }],
        projectDir: "/fake/project",
      });
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
    });

    it("writes manifest entry with copiedFiles", async () => {
      setupPluginPath();

      await runAdd("owner/my-skill");

      expect(mockAddEntry).toHaveBeenCalledWith(
        EMPTY_MANIFEST,
        "owner/my-skill",
        expect.objectContaining({
          ref: "main",
          commit: "abc123def456",
          installedAt: expect.any(String),
          agents: ["claude"],
          files: PLUGIN_COPY_RESULT.copiedFiles,
        }),
      );
      expect(mockWriteManifest).toHaveBeenCalledWith(
        "/fake/project",
        PLUGIN_UPDATED_MANIFEST,
      );
    });

    it("shows per-agent counts in summary, omitting zero-count types", async () => {
      setupPluginPath();
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/skills/planning/"],
        assetCountsByAgent: {
          claude: { skills: 2, agents: 0, hooks: 1 },
        },
      });

      await runAdd("owner/my-skill");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("owner/my-skill");
      expect(outroCall).toContain("main");
      expect(outroCall).toContain("claude");
      expect(outroCall).toContain("2 skill(s)");
      expect(outroCall).toContain("1 hook(s)");
      expect(outroCall).not.toContain("agent");
    });

    it("omits agents with all zero counts from summary", async () => {
      setupPluginPath();
      mockSelectAgents.mockResolvedValue(["claude", "codex"] as AgentId[]);
      const codexDriver = {
        detect: vi.fn().mockResolvedValue(true),
        getTargetDir: vi.fn().mockReturnValue(null),
      };
      mockGetDriver.mockImplementation((id: AgentId) => {
        if (id === "codex") return codexDriver;
        return FAKE_DRIVER;
      });
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/skills/planning/"],
        assetCountsByAgent: {
          claude: { skills: 2 },
          codex: { skills: 0 },
        },
      });

      await runAdd("owner/my-skill");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("claude");
      expect(outroCall).not.toContain("codex");
    });

    it("shows key without ref when ref is null", async () => {
      setupPluginPath();
      mockParseSource.mockReturnValue({ ...PARSED, ref: null });

      await runAdd("owner/my-skill");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("owner/my-skill");
      expect(outroCall).toContain("HEAD");
    });

    it("shows key with ref when ref is present", async () => {
      setupPluginPath();

      await runAdd("owner/my-skill");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("owner/my-skill");
      expect(outroCall).toContain("main");
    });

    it("warns and exits 0 without manifest write when copiedFiles is empty", async () => {
      mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [],
        assetCountsByAgent: {
          claude: { skills: 0, agents: 0 },
        },
      });

      const err = await runAdd("owner/my-skill").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockLog.warn).toHaveBeenCalledWith(
        expect.stringMatching(/no files to install/i),
      );
      expect(mockWriteManifest).not.toHaveBeenCalled();
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("surfaces root SKILL.md ignored warning via onWarn", async () => {
      setupPluginPath();
      mockDetectType.mockImplementation(async (_dir, options) => {
        options.onWarn?.(
          "SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored",
        );
        return PLUGIN_DETECTED;
      });

      await runAdd("owner/my-skill");

      expect(mockLog.warn).toHaveBeenCalledWith(
        "SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored",
      );
    });

    it("uses spinner during copyPluginAssets", async () => {
      const spinnerInstance = {
        start: vi.fn(),
        stop: vi.fn(),
        message: vi.fn(),
      };
      mockSpinner.mockReturnValue(spinnerInstance);
      setupPluginPath();

      await runAdd("owner/my-skill");

      const startCalls = spinnerInstance.start.mock.calls.map(
        (c) => c[0] as string,
      );
      expect(startCalls.some((msg) => msg.includes("Copy"))).toBe(true);
    });

    it("cleans up on success", async () => {
      setupPluginPath();

      await runAdd("owner/my-skill");

      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("cleans up on empty plugin", async () => {
      mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [],
        assetCountsByAgent: { claude: { skills: 0 } },
      });

      await runAdd("owner/my-skill").catch(() => {});

      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("shows error and exits 1 on copy error", async () => {
      mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
      mockCopyPluginAssets.mockRejectedValue(new Error("copy plugin failed"));

      const err = await runAdd("owner/my-skill").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("cleans up and exits 1 on manifest write error", async () => {
      setupPluginPath();
      mockWriteManifest.mockRejectedValue(new Error("write failed"));

      const err = await runAdd("owner/my-skill").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("passes detected assetDirs, not hardcoded values", async () => {
      mockDetectType.mockResolvedValue({
        type: "plugin",
        assetDirs: ["hooks"],
      });
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/hooks/pre-commit.sh"],
        assetCountsByAgent: { claude: { hooks: 1 } },
      });

      await runAdd("owner/my-skill");

      expect(mockCopyPluginAssets).toHaveBeenCalledWith(
        expect.objectContaining({ assetDirs: ["hooks"] }),
      );
    });
  });

  describe("not-agntc with config", () => {
    it("shows warning, cleans up, and exits 0", async () => {
      mockDetectType.mockImplementation(async (_dir, options) => {
        options.onWarn?.("agntc.json present but no SKILL.md or asset dirs found");
        return { type: "not-agntc" };
      });

      const err = await runAdd("owner/my-skill").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockLog.warn).toHaveBeenCalledWith(
        "agntc.json present but no SKILL.md or asset dirs found",
      );
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });
  });

  describe("cancel: empty agent selection", () => {
    it("shows cancelled, cleans up, and exits 0", async () => {
      mockSelectAgents.mockResolvedValue([]);

      const err = await runAdd("owner/my-skill").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(
        mockOutro.mock.calls[0]?.[0] ??
          mockCancel.mock.calls[0]?.[0] ??
          "",
      ).toMatch(/cancel/i);
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });
  });

  describe("error: copy failure", () => {
    it("shows error, cleans up, and exits 1", async () => {
      mockCopyBareSkill.mockRejectedValue(new Error("copy failed"));

      const err = await runAdd("owner/my-skill").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });
  });

  describe("error: manifest write failure", () => {
    it("shows error, cleans up, and exits 1", async () => {
      mockWriteManifest.mockRejectedValue(new Error("write failed"));

      const err = await runAdd("owner/my-skill").catch((e) => e);
      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockCancel).toHaveBeenCalled();
      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });
  });

  describe("cleanup", () => {
    it("cleans up on success", async () => {
      await runAdd("owner/my-skill");

      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("cleans up on error", async () => {
      mockCopyBareSkill.mockRejectedValue(new Error("copy failed"));

      await runAdd("owner/my-skill").catch(() => {});

      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("cleans up on cancel", async () => {
      mockSelectAgents.mockResolvedValue([]);

      await runAdd("owner/my-skill").catch(() => {});

      expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
    });

    it("swallows cleanup errors", async () => {
      mockCleanupTempDir.mockRejectedValue(new Error("cleanup failed"));

      // Should not throw due to cleanup error; the overall runAdd should still complete
      await runAdd("owner/my-skill");

      expect(mockCleanupTempDir).toHaveBeenCalled();
    });
  });

  describe("reinstall (nuke before copy)", () => {
    const EXISTING_MANIFEST: Manifest = {
      "owner/my-skill": {
        ref: "main",
        commit: "old123",
        installedAt: "2026-01-01T00:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/my-skill/"],
      },
    };

    it("standalone reinstall nukes old files before copy", async () => {
      mockReadManifest.mockResolvedValue(EXISTING_MANIFEST);

      const callOrder: string[] = [];
      mockNukeManifestFiles.mockImplementation(async () => {
        callOrder.push("nuke");
        return { removed: [".claude/skills/my-skill/"], skipped: [] };
      });
      mockCopyBareSkill.mockImplementation(async (args) => {
        callOrder.push("copy");
        return { copiedFiles: [".claude/skills/my-skill/"] };
      });

      await runAdd("owner/my-skill");

      expect(mockNukeManifestFiles).toHaveBeenCalledWith(
        "/fake/project",
        [".claude/skills/my-skill/"],
      );
      expect(callOrder).toEqual(["nuke", "copy"]);
    });

    it("does not nuke when manifest key is not present", async () => {
      mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);

      await runAdd("owner/my-skill");

      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
    });

    it("manifest entry replaced not duplicated on reinstall", async () => {
      mockReadManifest.mockResolvedValue(EXISTING_MANIFEST);
      mockNukeManifestFiles.mockResolvedValue({
        removed: [".claude/skills/my-skill/"],
        skipped: [],
      });
      mockAddEntry.mockImplementation((manifest, key, entry) => ({
        ...manifest,
        [key]: entry,
      }));

      await runAdd("owner/my-skill");

      expect(mockAddEntry).toHaveBeenCalledWith(
        EXISTING_MANIFEST,
        "owner/my-skill",
        expect.objectContaining({
          ref: "main",
          commit: "abc123def456",
          files: [".claude/skills/my-skill/"],
        }),
      );
    });

    it("different agent selection on reinstall: old files nuked, new files created", async () => {
      const oldManifest: Manifest = {
        "owner/my-skill": {
          ref: "main",
          commit: "old123",
          installedAt: "2026-01-01T00:00:00.000Z",
          agents: ["codex"],
          files: [".codex/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(oldManifest);
      mockNukeManifestFiles.mockResolvedValue({
        removed: [".codex/skills/my-skill/"],
        skipped: [],
      });
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-skill/"],
      });

      await runAdd("owner/my-skill");

      // Should nuke the OLD files (codex)
      expect(mockNukeManifestFiles).toHaveBeenCalledWith(
        "/fake/project",
        [".codex/skills/my-skill/"],
      );
      // Should copy to NEW agent (claude)
      expect(mockCopyBareSkill).toHaveBeenCalled();
    });

    describe("collection reinstall", () => {
      const COLLECTION_PARSED: ParsedSource = {
        type: "github-shorthand",
        owner: "owner",
        repo: "my-collection",
        ref: "main",
        manifestKey: "owner/my-collection",
      };

      const COLLECTION_CLONE_RESULT: CloneResult = {
        tempDir: "/tmp/agntc-coll123",
        commit: "coll123def456",
      };

      const COLLECTION_DETECTED: DetectedType = {
        type: "collection",
        plugins: ["pluginA", "pluginB"],
      };

      function setupCollectionReinstall(): void {
        mockParseSource.mockReturnValue(COLLECTION_PARSED);
        mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
        mockReadConfig.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
          return { agents: ["claude"] };
        });
        mockDetectType.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) {
            return COLLECTION_DETECTED;
          }
          return { type: "bare-skill" } as DetectedType;
        });
        mockSelectCollectionPlugins.mockResolvedValue([
          "pluginA",
          "pluginB",
        ]);
        mockGetRegisteredAgentIds.mockReturnValue(["claude"] as AgentId[]);
        mockGetDriver.mockReturnValue(FAKE_DRIVER);
        mockSelectAgents.mockResolvedValue(["claude"] as AgentId[]);
        mockWriteManifest.mockResolvedValue(undefined);
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockAddEntry.mockImplementation((manifest, key, entry) => ({
          ...manifest,
          [key]: entry,
        }));
        mockNukeManifestFiles.mockResolvedValue({
          removed: [],
          skipped: [],
        });
      }

      it("collection reinstall nukes per-plugin before copy", async () => {
        setupCollectionReinstall();
        const existingCollectionManifest: Manifest = {
          "owner/my-collection/pluginA": {
            ref: "main",
            commit: "old123",
            installedAt: "2026-01-01T00:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/pluginA/"],
          },
        };
        mockReadManifest.mockResolvedValue(existingCollectionManifest);
        mockNukeManifestFiles.mockResolvedValue({
          removed: [".claude/skills/pluginA/"],
          skipped: [],
        });
        mockCopyBareSkill
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginA/"],
          })
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        // Only pluginA is in manifest, so only pluginA should be nuked
        expect(mockNukeManifestFiles).toHaveBeenCalledTimes(1);
        expect(mockNukeManifestFiles).toHaveBeenCalledWith(
          "/fake/project",
          [".claude/skills/pluginA/"],
        );
      });

      it("only installed plugins nuked in collection", async () => {
        setupCollectionReinstall();
        const existingCollectionManifest: Manifest = {
          "owner/my-collection/pluginA": {
            ref: "main",
            commit: "old123",
            installedAt: "2026-01-01T00:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/pluginA/"],
          },
        };
        mockReadManifest.mockResolvedValue(existingCollectionManifest);
        mockNukeManifestFiles.mockResolvedValue({
          removed: [".claude/skills/pluginA/"],
          skipped: [],
        });
        mockCopyBareSkill
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginA/"],
          })
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        // pluginB was not in manifest, so nuke should NOT be called for it
        const nukeCalls = mockNukeManifestFiles.mock.calls;
        expect(nukeCalls).toHaveLength(1);
        expect(nukeCalls[0]![1]).toEqual([".claude/skills/pluginA/"]);
      });

      it("nuke failure on one collection plugin does not block others", async () => {
        setupCollectionReinstall();
        const existingCollectionManifest: Manifest = {
          "owner/my-collection/pluginA": {
            ref: "main",
            commit: "old123",
            installedAt: "2026-01-01T00:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/pluginA/"],
          },
          "owner/my-collection/pluginB": {
            ref: "main",
            commit: "old123",
            installedAt: "2026-01-01T00:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/pluginB/"],
          },
        };
        mockReadManifest.mockResolvedValue(existingCollectionManifest);

        // pluginA nuke fails, pluginB nuke succeeds
        mockNukeManifestFiles
          .mockRejectedValueOnce(
            Object.assign(new Error("EACCES"), { code: "EACCES" }),
          )
          .mockResolvedValueOnce({
            removed: [".claude/skills/pluginB/"],
            skipped: [],
          });

        mockCopyBareSkill
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        // pluginB should still be installed
        expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
      });
    });
  });
});

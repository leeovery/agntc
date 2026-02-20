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
import type { CollisionResolution } from "../../src/collision-resolve.js";
import type { UnmanagedResolution } from "../../src/unmanaged-resolve.js";
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

vi.mock("../../src/source-parser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/source-parser.js")>();
  return {
    ...actual,
    parseSource: vi.fn(),
  };
});

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

vi.mock("../../src/detect-agents.js", () => ({
  detectAgents: vi.fn(),
}));

vi.mock("../../src/compute-incoming-files.js", () => ({
  computeIncomingFiles: vi.fn(),
}));

vi.mock("../../src/collision-check.js", () => ({
  checkFileCollisions: vi.fn(),
}));

vi.mock("../../src/collision-resolve.js", () => ({
  resolveCollisions: vi.fn(),
}));

vi.mock("../../src/unmanaged-check.js", () => ({
  checkUnmanagedConflicts: vi.fn(),
}));

vi.mock("../../src/unmanaged-resolve.js", () => ({
  resolveUnmanagedConflicts: vi.fn(),
}));

import * as p from "@clack/prompts";
import { parseSource } from "../../src/source-parser.js";
import { cloneSource, cleanupTempDir } from "../../src/git-clone.js";
import { readConfig } from "../../src/config.js";
import { detectType } from "../../src/type-detection.js";
import { getDriver } from "../../src/drivers/registry.js";
import { detectAgents } from "../../src/detect-agents.js";
import { selectAgents } from "../../src/agent-select.js";
import { selectCollectionPlugins } from "../../src/collection-select.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import { readManifest, writeManifest, addEntry } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { computeIncomingFiles } from "../../src/compute-incoming-files.js";
import { checkFileCollisions } from "../../src/collision-check.js";
import { resolveCollisions } from "../../src/collision-resolve.js";
import { checkUnmanagedConflicts } from "../../src/unmanaged-check.js";
import { resolveUnmanagedConflicts } from "../../src/unmanaged-resolve.js";
import { runAdd } from "../../src/commands/add.js";

const mockParseSource = vi.mocked(parseSource);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockGetDriver = vi.mocked(getDriver);
const mockDetectAgents = vi.mocked(detectAgents);
const mockSelectAgents = vi.mocked(selectAgents);
const mockSelectCollectionPlugins = vi.mocked(selectCollectionPlugins);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockReadManifest = vi.mocked(readManifest);
const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockComputeIncomingFiles = vi.mocked(computeIncomingFiles);
const mockCheckFileCollisions = vi.mocked(checkFileCollisions);
const mockResolveCollisions = vi.mocked(resolveCollisions);
const mockCheckUnmanagedConflicts = vi.mocked(checkUnmanagedConflicts);
const mockResolveUnmanagedConflicts = vi.mocked(resolveUnmanagedConflicts);
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
  cloneUrl: "https://github.com/owner/my-skill.git",
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
  cloneUrl: "https://github.com/owner/my-skill.git",
};

const UPDATED_MANIFEST: Manifest = {
  "owner/my-skill": MANIFEST_ENTRY,
};

function setupHappyPath(): void {
  mockParseSource.mockReturnValue(PARSED);
  mockCloneSource.mockResolvedValue(CLONE_RESULT);
  mockReadConfig.mockResolvedValue(CONFIG);
  mockDetectType.mockResolvedValue(BARE_SKILL);
  mockDetectAgents.mockResolvedValue(["claude"]);
  mockGetDriver.mockReturnValue(FAKE_DRIVER);
  mockSelectAgents.mockResolvedValue(["claude"]);
  mockCopyBareSkill.mockResolvedValue(COPY_RESULT);
  mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
  mockAddEntry.mockReturnValue(UPDATED_MANIFEST);
  mockWriteManifest.mockResolvedValue(undefined);
  mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
  mockComputeIncomingFiles.mockReturnValue([".claude/skills/my-skill/"]);
  mockCheckFileCollisions.mockReturnValue(new Map());
  mockResolveCollisions.mockResolvedValue({
    resolved: true,
    updatedManifest: EMPTY_MANIFEST,
  });
  mockCheckUnmanagedConflicts.mockResolvedValue([]);
  mockResolveUnmanagedConflicts.mockResolvedValue({
    approved: [],
    cancelled: [],
  });
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
      expect(mockDetectAgents).toHaveBeenCalledWith("/fake/project");
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
    it("calls detectAgents with project dir", async () => {
      await runAdd("owner/my-skill");

      expect(mockDetectAgents).toHaveBeenCalledWith("/fake/project");
    });

    it("passes correct declaredAgents and detectedAgents to selectAgents", async () => {
      mockDetectAgents.mockResolvedValue(["claude"]);
      mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
      mockSelectAgents.mockResolvedValue(["claude"]);

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

    it("stores cloneUrl from github-shorthand source", async () => {
      await runAdd("owner/my-skill");

      const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
      expect(entry.cloneUrl).toBe("https://github.com/owner/my-skill.git");
    });

    it("stores cloneUrl from https-url source", async () => {
      mockParseSource.mockReturnValue({
        type: "https-url",
        owner: "owner",
        repo: "my-skill",
        ref: null,
        manifestKey: "owner/my-skill",
        cloneUrl: "https://gitlab.com/owner/my-skill.git",
      });

      await runAdd("https://gitlab.com/owner/my-skill");

      const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
      expect(entry.cloneUrl).toBe("https://gitlab.com/owner/my-skill.git");
    });

    it("stores cloneUrl from ssh-url source", async () => {
      mockParseSource.mockReturnValue({
        type: "ssh-url",
        owner: "owner",
        repo: "my-skill",
        ref: null,
        manifestKey: "owner/my-skill",
        cloneUrl: "git@github.com:owner/my-skill.git",
      });

      await runAdd("git@github.com:owner/my-skill.git");

      const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
      expect(entry.cloneUrl).toBe("git@github.com:owner/my-skill.git");
    });

    it("stores null cloneUrl for local-path source", async () => {
      mockParseSource.mockReturnValue({
        type: "local-path",
        resolvedPath: "/Users/lee/Code/my-skill",
        ref: null,
        manifestKey: "/Users/lee/Code/my-skill",
      });

      await runAdd("/Users/lee/Code/my-skill");

      const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
      expect(entry.cloneUrl).toBeNull();
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
        new ConfigError("Invalid agntc.json: agents must not be empty"),
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
      mockDetectAgents.mockResolvedValue(["claude"]);
      mockGetDriver.mockReturnValue(FAKE_DRIVER);
      mockSelectAgents.mockResolvedValue(["claude"]);
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
      mockDetectAgents.mockResolvedValue(["claude", "codex"]);
      const claudeDriver = {
        getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
      };
      const codexDriver = {
        getTargetDir: vi.fn().mockReturnValue(".codex/skills"),
      };
      mockGetDriver.mockImplementation((id: AgentId) => {
        if (id === "claude") return claudeDriver as any;
        return codexDriver as any;
      });
      mockSelectAgents.mockResolvedValue(["claude", "codex"]);
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

    describe("independent failure handling", () => {
      function setupCollectionForFailure(): void {
        setupCollectionBase();
        mockReadConfig.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
          if (dir.endsWith("/pluginA")) return PLUGIN_A_CONFIG;
          if (dir.endsWith("/pluginB")) return PLUGIN_B_CONFIG;
          return null;
        });
        mockDetectType.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir)
            return COLLECTION_DETECTED;
          if (dir.endsWith("/pluginA")) return PLUGIN_A_BARE;
          if (dir.endsWith("/pluginB")) return PLUGIN_B_BARE;
          return { type: "not-agntc" };
        });
        mockComputeIncomingFiles.mockReturnValue([]);
        mockCheckFileCollisions.mockReturnValue(new Map());
        mockCheckUnmanagedConflicts.mockResolvedValue([]);
        mockResolveUnmanagedConflicts.mockResolvedValue({
          approved: [],
          cancelled: [],
        });
      }

      it("first plugin copy fails, second succeeds — only second gets manifest entry", async () => {
        setupCollectionForFailure();
        mockCopyBareSkill
          .mockRejectedValueOnce(new Error("disk full"))
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        // addEntry should only be called for pluginB
        expect(mockAddEntry).toHaveBeenCalledTimes(1);
        expect(mockAddEntry).toHaveBeenCalledWith(
          expect.anything(),
          "owner/my-collection/pluginB",
          expect.objectContaining({
            files: [".claude/skills/pluginB/"],
          }),
        );
      });

      it("all plugin copies fail — no manifest entries, exits 0, summary shows failures", async () => {
        setupCollectionForFailure();
        mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

        // Should not throw — exits 0 with summary
        await runAdd("owner/my-collection");

        // No addEntry calls for failed plugins
        expect(mockAddEntry).not.toHaveBeenCalled();
        // Manifest still written once (with no additions)
        expect(mockWriteManifest).toHaveBeenCalledTimes(1);
        // Summary mentions failures
        const outroCall = mockOutro.mock.calls[0]![0] as string;
        expect(outroCall).toMatch(/pluginA: failed —/);
        expect(outroCall).toMatch(/pluginB: failed —/);
      });

      it("failed plugin allows subsequent plugins to install", async () => {
        setupCollectionForFailure();
        mockCopyBareSkill
          .mockRejectedValueOnce(new Error("permission denied"))
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        // pluginB was still copied despite pluginA failing
        expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
        const secondCall = mockCopyBareSkill.mock.calls[1]![0];
        expect(secondCall.sourceDir).toBe(
          COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
        );
      });

      it("single manifest write even with mixed success and failure", async () => {
        setupCollectionForFailure();
        mockCopyBareSkill
          .mockRejectedValueOnce(new Error("copy error"))
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        expect(mockWriteManifest).toHaveBeenCalledTimes(1);
      });

      it("error message from copy failure appears in summary", async () => {
        setupCollectionForFailure();
        mockCopyBareSkill
          .mockRejectedValueOnce(new Error("ENOSPC: no space left"))
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        const outroCall = mockOutro.mock.calls[0]![0] as string;
        expect(outroCall).toMatch(
          /pluginA: failed — ENOSPC: no space left/,
        );
      });

      // Rollback on copy failure is delegated to the copy functions themselves
      // (copyBareSkill / copyPluginAssets). Those rollback behaviors are tested
      // in cs-5-8's copy function test suites.

      it("both plugins succeed — both get manifest entries, no failures in summary", async () => {
        setupCollectionForFailure();
        mockCopyBareSkill
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginA/"],
          })
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });

        await runAdd("owner/my-collection");

        // Both plugins should get manifest entries
        expect(mockAddEntry).toHaveBeenCalledTimes(2);
        expect(mockAddEntry).toHaveBeenCalledWith(
          expect.anything(),
          "owner/my-collection/pluginA",
          expect.objectContaining({
            files: [".claude/skills/pluginA/"],
          }),
        );
        expect(mockAddEntry).toHaveBeenCalledWith(
          expect.anything(),
          "owner/my-collection/pluginB",
          expect.objectContaining({
            files: [".claude/skills/pluginB/"],
          }),
        );
        // Summary should mention both plugins but not "failed"
        const outroCall = mockOutro.mock.calls[0]![0] as string;
        expect(outroCall).toContain("pluginA");
        expect(outroCall).toContain("pluginB");
        expect(outroCall).not.toMatch(/failed/);
        expect(outroCall).not.toMatch(/skipped/);
      });

      it("one plugin skipped (ConfigError) and another fails during copy — both tracked in summary", async () => {
        setupCollectionBase();
        const { ConfigError } = await import("../../src/config.js");
        // pluginA: ConfigError during readConfig => skipped
        // pluginB: succeeds readConfig but fails during copy
        mockReadConfig.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
          if (dir.endsWith("/pluginA"))
            throw new ConfigError("invalid schema");
          if (dir.endsWith("/pluginB")) return PLUGIN_B_CONFIG;
          return null;
        });
        mockDetectType.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir)
            return COLLECTION_DETECTED;
          if (dir.endsWith("/pluginB")) return PLUGIN_B_BARE;
          return { type: "not-agntc" };
        });
        mockComputeIncomingFiles.mockReturnValue([]);
        mockCheckFileCollisions.mockReturnValue(new Map());
        mockCheckUnmanagedConflicts.mockResolvedValue([]);
        mockCopyBareSkill.mockRejectedValueOnce(
          new Error("permission denied"),
        );

        await runAdd("owner/my-collection");

        // No manifest entries — one skipped, one failed
        expect(mockAddEntry).not.toHaveBeenCalled();
        // Summary should show 1 skipped and pluginB failed
        const outroCall = mockOutro.mock.calls[0]![0] as string;
        expect(outroCall).toMatch(/1 skipped/);
        expect(outroCall).toMatch(/pluginB: failed — permission denied/);
      });

      it("three plugins: one installed, one copy fails, one skipped — manifest entry only for installed", async () => {
        // Setup with 3 plugins
        const THREE_PLUGIN_DETECTED: DetectedType = {
          type: "collection",
          plugins: ["pluginA", "pluginB", "pluginC"],
        };
        setupCollectionBase();
        const { ConfigError } = await import("../../src/config.js");
        mockSelectCollectionPlugins.mockResolvedValue([
          "pluginA",
          "pluginB",
          "pluginC",
        ]);
        mockDetectType.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir)
            return THREE_PLUGIN_DETECTED;
          return { type: "bare-skill" } as DetectedType;
        });
        // pluginA: valid config, will be installed
        // pluginB: valid config, copy will fail
        // pluginC: ConfigError => skipped
        mockReadConfig.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
          if (dir.endsWith("/pluginC"))
            throw new ConfigError("malformed json");
          return { agents: ["claude"] };
        });
        mockComputeIncomingFiles.mockReturnValue([]);
        mockCheckFileCollisions.mockReturnValue(new Map());
        mockCheckUnmanagedConflicts.mockResolvedValue([]);
        mockCopyBareSkill
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginA/"],
          })
          .mockRejectedValueOnce(new Error("disk full"));

        await runAdd("owner/my-collection");

        // Only pluginA should get a manifest entry
        expect(mockAddEntry).toHaveBeenCalledTimes(1);
        expect(mockAddEntry).toHaveBeenCalledWith(
          expect.anything(),
          "owner/my-collection/pluginA",
          expect.objectContaining({
            files: [".claude/skills/pluginA/"],
          }),
        );
        // Summary: pluginA installed, pluginB failed, pluginC skipped
        const outroCall = mockOutro.mock.calls[0]![0] as string;
        expect(outroCall).toContain("pluginA");
        expect(outroCall).toMatch(/pluginB: failed — disk full/);
        expect(outroCall).toMatch(/1 skipped/);
      });
    });

    describe("per-plugin agent compatibility warnings", () => {
      function setupCollectionWithDifferentAgents(): void {
        setupCollectionBase();
        // pluginA declares claude only, pluginB declares codex only
        mockReadConfig.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
          if (dir.endsWith("/pluginA")) return { agents: ["claude"] as AgentId[] };
          if (dir.endsWith("/pluginB")) return { agents: ["codex"] as AgentId[] };
          return null;
        });
        mockDetectType.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
          return { type: "bare-skill" } as DetectedType;
        });
        mockDetectAgents.mockResolvedValue(["claude", "codex"]);
        mockSelectAgents.mockResolvedValue(["claude", "codex"]);
        const claudeDriver = {
          detect: vi.fn().mockResolvedValue(true),
          getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
        };
        const codexDriver = {
          detect: vi.fn().mockResolvedValue(true),
          getTargetDir: vi.fn().mockReturnValue(".agents/skills"),
        };
        mockGetDriver.mockImplementation((id: AgentId) => {
          if (id === "claude") return claudeDriver as any;
          return codexDriver as any;
        });
        mockCopyBareSkill
          .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/", ".agents/skills/pluginA/"] })
          .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/", ".agents/skills/pluginB/"] });
        mockComputeIncomingFiles.mockReturnValue([]);
        mockCheckFileCollisions.mockReturnValue(new Map());
        mockCheckUnmanagedConflicts.mockResolvedValue([]);
      }

      it("shows unsupported warning for pluginA when codex selected but not declared", async () => {
        setupCollectionWithDifferentAgents();

        await runAdd("owner/my-collection");

        const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
        expect(warnCalls).toEqual(
          expect.arrayContaining([
            expect.stringContaining("pluginA"),
          ]),
        );
        const pluginAWarning = warnCalls.find(
          (msg) => msg.includes("pluginA") && msg.includes("codex"),
        );
        expect(pluginAWarning).toBeDefined();
        expect(pluginAWarning).toMatch(/does not declare support for/i);
      });

      it("shows unsupported warning for pluginB when claude selected but not declared", async () => {
        setupCollectionWithDifferentAgents();

        await runAdd("owner/my-collection");

        const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
        const pluginBWarning = warnCalls.find(
          (msg) => msg.includes("pluginB") && msg.includes("claude"),
        );
        expect(pluginBWarning).toBeDefined();
        expect(pluginBWarning).toMatch(/does not declare support for/i);
      });

      it("no warnings when all plugins declare the same agents as selected", async () => {
        setupCollectionBase();
        // Both plugins declare claude and codex
        mockReadConfig.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
          return { agents: ["claude", "codex"] as AgentId[] };
        });
        mockDetectType.mockImplementation(async (dir) => {
          if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
          return { type: "bare-skill" } as DetectedType;
        });
        mockDetectAgents.mockResolvedValue(["claude", "codex"]);
        mockSelectAgents.mockResolvedValue(["claude", "codex"]);
        const claudeDriver = {
          detect: vi.fn().mockResolvedValue(true),
          getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
        };
        const codexDriver = {
          detect: vi.fn().mockResolvedValue(true),
          getTargetDir: vi.fn().mockReturnValue(".agents/skills"),
        };
        mockGetDriver.mockImplementation((id: AgentId) => {
          if (id === "claude") return claudeDriver as any;
          return codexDriver as any;
        });
        mockCopyBareSkill.mockResolvedValue({
          copiedFiles: [".claude/skills/pluginA/"],
        });
        mockComputeIncomingFiles.mockReturnValue([]);
        mockCheckFileCollisions.mockReturnValue(new Map());
        mockCheckUnmanagedConflicts.mockResolvedValue([]);

        await runAdd("owner/my-collection");

        const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
        const compatWarnings = warnCalls.filter((msg) =>
          msg.includes("does not declare support for"),
        );
        expect(compatWarnings).toHaveLength(0);
      });

      it("installs all selected agents for each plugin regardless of warnings (warn never block)", async () => {
        setupCollectionWithDifferentAgents();

        await runAdd("owner/my-collection");

        // Both copy calls should receive agents for both claude and codex
        const copyCalls = mockCopyBareSkill.mock.calls;
        expect(copyCalls).toHaveLength(2);
        for (const call of copyCalls) {
          const agents = call[0].agents;
          const agentIds = agents.map((a: { id: AgentId }) => a.id);
          expect(agentIds).toContain("claude");
          expect(agentIds).toContain("codex");
        }
      });

      it("manifest agents field includes all selected agents for each plugin", async () => {
        setupCollectionWithDifferentAgents();

        await runAdd("owner/my-collection");

        const addEntryCalls = mockAddEntry.mock.calls;
        for (const call of addEntryCalls) {
          const entry = call[2];
          expect(entry.agents).toEqual(["claude", "codex"]);
        }
      });
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
      mockSelectAgents.mockResolvedValue(["claude", "codex"]);
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

  describe("direct-path source (tree URL)", () => {
    const DIRECT_PATH_PARSED: ParsedSource = {
      type: "direct-path",
      owner: "owner",
      repo: "my-collection",
      ref: "main",
      targetPlugin: "pluginA",
      manifestKey: "owner/my-collection/pluginA",
      cloneUrl: "https://github.com/owner/my-collection.git",
    };

    const DIRECT_PATH_CLONE_RESULT: CloneResult = {
      tempDir: "/tmp/agntc-dp123",
      commit: "dp123def456",
    };

    const COLLECTION_DETECTED: DetectedType = {
      type: "collection",
      plugins: ["pluginA", "pluginB"],
    };

    const PLUGIN_A_CONFIG: AgntcConfig = { agents: ["claude"] };

    function setupDirectPath(): void {
      mockParseSource.mockReturnValue(DIRECT_PATH_PARSED);
      mockCloneSource.mockResolvedValue(DIRECT_PATH_CLONE_RESULT);
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === DIRECT_PATH_CLONE_RESULT.tempDir) return null;
        if (dir.endsWith("/pluginA")) return PLUGIN_A_CONFIG;
        return null;
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === DIRECT_PATH_CLONE_RESULT.tempDir) {
          return COLLECTION_DETECTED;
        }
        return { type: "bare-skill" } as DetectedType;
      });
      mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
      mockDetectAgents.mockResolvedValue(["claude"]);
      mockGetDriver.mockReturnValue(FAKE_DRIVER);
      mockSelectAgents.mockResolvedValue(["claude"]);
      mockWriteManifest.mockResolvedValue(undefined);
      mockCleanupTempDir.mockResolvedValue(undefined);
      mockAddEntry.mockImplementation((manifest, key, entry) => ({
        ...manifest,
        [key]: entry,
      }));
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/pluginA/"],
      });
    }

    it("skips collection multiselect and installs targetPlugin directly", async () => {
      setupDirectPath();

      await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

      expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
      expect(mockCopyBareSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDir: DIRECT_PATH_CLONE_RESULT.tempDir + "/pluginA",
        }),
      );
    });

    it("writes manifest with correct key for direct-path plugin", async () => {
      setupDirectPath();

      await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

      expect(mockAddEntry).toHaveBeenCalledWith(
        EMPTY_MANIFEST,
        "owner/my-collection/pluginA",
        expect.objectContaining({
          ref: "main",
          commit: "dp123def456",
          agents: ["claude"],
          files: [".claude/skills/pluginA/"],
        }),
      );
    });

    it("throws error when targetPlugin not found in collection", async () => {
      setupDirectPath();
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === DIRECT_PATH_CLONE_RESULT.tempDir) {
          return {
            type: "collection",
            plugins: ["pluginB", "pluginC"],
          } as DetectedType;
        }
        return { type: "bare-skill" } as DetectedType;
      });

      const err = await runAdd(
        "https://github.com/owner/my-collection/tree/main/pluginA",
      ).catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
    });

    it("agent multiselect still shown for direct-path source", async () => {
      setupDirectPath();

      await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

      expect(mockSelectAgents).toHaveBeenCalledTimes(1);
    });

    it("cleans up temp dir on success", async () => {
      setupDirectPath();

      await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

      expect(mockCleanupTempDir).toHaveBeenCalledWith(
        DIRECT_PATH_CLONE_RESULT.tempDir,
      );
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
        mockDetectAgents.mockResolvedValue(["claude"]);
        mockGetDriver.mockReturnValue(FAKE_DRIVER);
        mockSelectAgents.mockResolvedValue(["claude"]);
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

  describe("local-path source", () => {
    const LOCAL_PARSED: ParsedSource = {
      type: "local-path",
      resolvedPath: "/Users/dev/my-plugin",
      ref: null,
      manifestKey: "/Users/dev/my-plugin",
    };

    const LOCAL_CONFIG: AgntcConfig = { agents: ["claude"] };
    const LOCAL_BARE_SKILL: DetectedType = { type: "bare-skill" };

    function setupLocalBareSkill(): void {
      mockParseSource.mockReturnValue(LOCAL_PARSED);
      mockReadConfig.mockResolvedValue(LOCAL_CONFIG);
      mockDetectType.mockResolvedValue(LOCAL_BARE_SKILL);
      mockDetectAgents.mockResolvedValue(["claude"]);
      mockGetDriver.mockReturnValue(FAKE_DRIVER);
      mockSelectAgents.mockResolvedValue(["claude"]);
      mockCopyBareSkill.mockResolvedValue({
        copiedFiles: [".claude/skills/my-plugin/"],
      });
      mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
      mockAddEntry.mockReturnValue({
        "/Users/dev/my-plugin": {
          ref: null,
          commit: null,
          installedAt: expect.any(String),
          agents: ["claude"],
          files: [".claude/skills/my-plugin/"],
        },
      } as unknown as Manifest);
      mockWriteManifest.mockResolvedValue(undefined);
      mockCleanupTempDir.mockResolvedValue(undefined);
    }

    it("skips clone for local-path source", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      expect(mockCloneSource).not.toHaveBeenCalled();
    });

    it("uses resolvedPath as sourceDir for readConfig", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      expect(mockReadConfig).toHaveBeenCalledWith(
        "/Users/dev/my-plugin",
        expect.objectContaining({ onWarn: expect.any(Function) }),
      );
    });

    it("uses resolvedPath as sourceDir for detectType", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      expect(mockDetectType).toHaveBeenCalledWith(
        "/Users/dev/my-plugin",
        expect.objectContaining({
          hasConfig: true,
          onWarn: expect.any(Function),
        }),
      );
    });

    it("does not clean up temp dir for local-path source", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      expect(mockCleanupTempDir).not.toHaveBeenCalled();
    });

    it("writes manifest entry with null ref and null commit", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      expect(mockAddEntry).toHaveBeenCalledWith(
        EMPTY_MANIFEST,
        "/Users/dev/my-plugin",
        expect.objectContaining({
          ref: null,
          commit: null,
          installedAt: expect.any(String),
          agents: ["claude"],
          files: [".claude/skills/my-plugin/"],
        }),
      );
    });

    it("uses absolute path as manifest key", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      const addEntryCall = mockAddEntry.mock.calls[0]!;
      expect(addEntryCall[1]).toBe("/Users/dev/my-plugin");
    });

    it("passes resolvedPath as sourceDir to copyBareSkill", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      expect(mockCopyBareSkill).toHaveBeenCalledWith({
        sourceDir: "/Users/dev/my-plugin",
        projectDir: "/fake/project",
        agents: [{ id: "claude", driver: FAKE_DRIVER }],
      });
    });

    it("shows 'local' instead of ref in summary", async () => {
      setupLocalBareSkill();

      await runAdd("./my-plugin");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("local");
      expect(outroCall).not.toContain("HEAD");
    });

    it("handles plugin type from local path", async () => {
      const pluginDetected: DetectedType = {
        type: "plugin",
        assetDirs: ["skills", "agents"],
      };
      setupLocalBareSkill();
      mockDetectType.mockResolvedValue(pluginDetected);
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/skills/planning/", ".claude/agents/executor/"],
        assetCountsByAgent: { claude: { skills: 1, agents: 1 } },
      });

      await runAdd("./my-plugin");

      expect(mockCopyPluginAssets).toHaveBeenCalledWith({
        sourceDir: "/Users/dev/my-plugin",
        assetDirs: ["skills", "agents"],
        agents: [{ id: "claude", driver: FAKE_DRIVER }],
        projectDir: "/fake/project",
      });
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
    });

    describe("local-path collection", () => {
      const LOCAL_COLLECTION_PARSED: ParsedSource = {
        type: "local-path",
        resolvedPath: "/Users/dev/my-collection",
        ref: null,
        manifestKey: "/Users/dev/my-collection",
      };

      const COLLECTION_DETECTED: DetectedType = {
        type: "collection",
        plugins: ["pluginA", "pluginB"],
      };

      function setupLocalCollection(): void {
        mockParseSource.mockReturnValue(LOCAL_COLLECTION_PARSED);
        mockReadConfig.mockImplementation(async (dir) => {
          if (dir === "/Users/dev/my-collection") return null;
          if (dir.endsWith("/pluginA")) return { agents: ["claude"] };
          if (dir.endsWith("/pluginB")) return { agents: ["claude"] };
          return null;
        });
        mockDetectType.mockImplementation(async (dir) => {
          if (dir === "/Users/dev/my-collection") return COLLECTION_DETECTED;
          return { type: "bare-skill" } as DetectedType;
        });
        mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
        mockSelectCollectionPlugins.mockResolvedValue([
          "pluginA",
          "pluginB",
        ]);
        mockDetectAgents.mockResolvedValue(["claude"]);
        mockGetDriver.mockReturnValue(FAKE_DRIVER);
        mockSelectAgents.mockResolvedValue(["claude"]);
        mockWriteManifest.mockResolvedValue(undefined);
        mockCleanupTempDir.mockResolvedValue(undefined);
        mockAddEntry.mockImplementation((manifest, key, entry) => ({
          ...manifest,
          [key]: entry,
        }));
        mockCopyBareSkill
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginA/"],
          })
          .mockResolvedValueOnce({
            copiedFiles: [".claude/skills/pluginB/"],
          });
      }

      it("skips clone for local-path collection", async () => {
        setupLocalCollection();

        await runAdd("./my-collection");

        expect(mockCloneSource).not.toHaveBeenCalled();
      });

      it("does not clean up temp dir for local-path collection", async () => {
        setupLocalCollection();

        await runAdd("./my-collection");

        expect(mockCleanupTempDir).not.toHaveBeenCalled();
      });

      it("uses resolvedPath/pluginName as collection manifest keys", async () => {
        setupLocalCollection();

        await runAdd("./my-collection");

        const addEntryCalls = mockAddEntry.mock.calls;
        const keys = addEntryCalls.map((call) => call[1]);
        expect(keys).toContain("/Users/dev/my-collection/pluginA");
        expect(keys).toContain("/Users/dev/my-collection/pluginB");
      });

      it("writes null ref and null commit for collection plugin entries", async () => {
        setupLocalCollection();

        await runAdd("./my-collection");

        for (const call of mockAddEntry.mock.calls) {
          const entry = call[2] as ManifestEntry;
          expect(entry.ref).toBeNull();
          expect(entry.commit).toBeNull();
        }
      });

      it("uses resolvedPath as manifestKeyPrefix for collection select", async () => {
        setupLocalCollection();

        await runAdd("./my-collection");

        expect(mockSelectCollectionPlugins).toHaveBeenCalledWith({
          plugins: ["pluginA", "pluginB"],
          manifest: EMPTY_MANIFEST,
          manifestKeyPrefix: "/Users/dev/my-collection",
        });
      });

      it("shows 'local' in collection summary", async () => {
        setupLocalCollection();

        await runAdd("./my-collection");

        const outroCall = mockOutro.mock.calls[0]![0] as string;
        expect(outroCall).toContain("local");
        expect(outroCall).not.toContain("HEAD");
      });
    });

    describe("local-path error: no agntc.json and not a collection", () => {
      it("surfaces clear error when local path has no agntc.json and no collection subdirs", async () => {
        mockParseSource.mockReturnValue(LOCAL_PARSED);
        mockReadConfig.mockResolvedValue(null);
        mockDetectType.mockResolvedValue({ type: "not-agntc" });

        const err = await runAdd("./my-plugin").catch((e) => e);

        expect(err).toBeInstanceOf(ExitSignal);
        expect((err as ExitSignal).code).toBe(0);
        expect(mockCancel).toHaveBeenCalledWith(
          expect.stringContaining("Not an agntc source"),
        );
        expect(mockCloneSource).not.toHaveBeenCalled();
        expect(mockCleanupTempDir).not.toHaveBeenCalled();
      });
    });

    describe("local-path error: unreadable path", () => {
      it("surfaces clear error when parseSource throws for unreadable path", async () => {
        mockParseSource.mockImplementation(() => {
          throw new Error(
            "Path /bad/path does not exist or is not a directory",
          );
        });

        const err = await runAdd("./bad-path").catch((e) => e);

        expect(err).toBeInstanceOf(ExitSignal);
        expect((err as ExitSignal).code).toBe(1);
        expect(mockCancel).toHaveBeenCalled();
        expect(mockCloneSource).not.toHaveBeenCalled();
        expect(mockCleanupTempDir).not.toHaveBeenCalled();
      });
    });

    describe("no regression: git-based sources still work", () => {
      it("git-based source still clones and cleans up", async () => {
        // Reset to default happy path (git-based)
        setupHappyPath();

        await runAdd("owner/my-skill");

        expect(mockCloneSource).toHaveBeenCalled();
        expect(mockCleanupTempDir).toHaveBeenCalled();
      });
    });
  });

  describe("conflict flow — standalone", () => {
    it("calls computeIncomingFiles with correct args for bare-skill", async () => {
      await runAdd("owner/my-skill");

      expect(mockComputeIncomingFiles).toHaveBeenCalledWith({
        type: "bare-skill",
        sourceDir: CLONE_RESULT.tempDir,
        agents: [{ id: "claude", driver: FAKE_DRIVER }],
      });
    });

    it("calls computeIncomingFiles with correct args for plugin", async () => {
      const pluginDetected: DetectedType = {
        type: "plugin",
        assetDirs: ["skills", "agents"],
      };
      mockDetectType.mockResolvedValue(pluginDetected);
      mockCopyPluginAssets.mockResolvedValue({
        copiedFiles: [".claude/skills/planning/"],
        assetCountsByAgent: { claude: { skills: 1 } },
      });

      await runAdd("owner/my-skill");

      expect(mockComputeIncomingFiles).toHaveBeenCalledWith({
        type: "plugin",
        sourceDir: CLONE_RESULT.tempDir,
        assetDirs: ["skills", "agents"],
        agents: [{ id: "claude", driver: FAKE_DRIVER }],
      });
    });

    it("calls collision check before copy with excludeKey", async () => {
      const callOrder: string[] = [];
      mockCheckFileCollisions.mockImplementation((...args) => {
        callOrder.push("collision-check");
        return new Map();
      });
      mockCopyBareSkill.mockImplementation(async () => {
        callOrder.push("copy");
        return { copiedFiles: [".claude/skills/my-skill/"] };
      });

      await runAdd("owner/my-skill");

      expect(callOrder.indexOf("collision-check")).toBeLessThan(
        callOrder.indexOf("copy"),
      );
      expect(mockCheckFileCollisions).toHaveBeenCalledWith(
        [".claude/skills/my-skill/"],
        EMPTY_MANIFEST,
        "owner/my-skill",
      );
    });

    it("calls unmanaged check after collision check, before copy", async () => {
      const callOrder: string[] = [];
      mockCheckFileCollisions.mockImplementation(() => {
        callOrder.push("collision-check");
        return new Map();
      });
      mockCheckUnmanagedConflicts.mockImplementation(async () => {
        callOrder.push("unmanaged-check");
        return [];
      });
      mockCopyBareSkill.mockImplementation(async () => {
        callOrder.push("copy");
        return { copiedFiles: [".claude/skills/my-skill/"] };
      });

      await runAdd("owner/my-skill");

      expect(callOrder).toEqual([
        "collision-check",
        "unmanaged-check",
        "copy",
      ]);
    });

    it("passes updated manifest from collision resolution to unmanaged check", async () => {
      const collidingManifest: Manifest = {
        "other/repo": {
          ref: "main",
          commit: "old123",
          installedAt: "2026-01-01T00:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      const resolvedManifest: Manifest = {};
      mockReadManifest.mockResolvedValue(collidingManifest);
      mockCheckFileCollisions.mockReturnValue(
        new Map([["other/repo", [".claude/skills/my-skill/"]]]),
      );
      mockResolveCollisions.mockResolvedValue({
        resolved: true,
        updatedManifest: resolvedManifest,
      });

      await runAdd("owner/my-skill");

      // Unmanaged check should get the updated (resolved) manifest
      expect(mockCheckUnmanagedConflicts).toHaveBeenCalledWith(
        [".claude/skills/my-skill/"],
        resolvedManifest,
        "/fake/project",
      );
    });

    it("cancel at collision stage exits cleanly with ExitSignal(0)", async () => {
      mockCheckFileCollisions.mockReturnValue(
        new Map([["other/repo", [".claude/skills/my-skill/"]]]),
      );
      mockResolveCollisions.mockResolvedValue({
        resolved: false,
        updatedManifest: EMPTY_MANIFEST,
      });

      const err = await runAdd("owner/my-skill").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
      expect(mockCheckUnmanagedConflicts).not.toHaveBeenCalled();
    });

    it("cancel at unmanaged stage exits cleanly with ExitSignal(0)", async () => {
      mockCheckUnmanagedConflicts.mockResolvedValue([
        ".claude/skills/my-skill/",
      ]);
      mockResolveUnmanagedConflicts.mockResolvedValue({
        approved: [],
        cancelled: [".claude/skills/my-skill/"],
      });

      const err = await runAdd("owner/my-skill").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
    });

    it("resolve collision then install succeeds", async () => {
      mockCheckFileCollisions.mockReturnValue(
        new Map([["other/repo", [".claude/skills/my-skill/"]]]),
      );
      mockResolveCollisions.mockResolvedValue({
        resolved: true,
        updatedManifest: EMPTY_MANIFEST,
      });

      await runAdd("owner/my-skill");

      expect(mockCopyBareSkill).toHaveBeenCalled();
      expect(mockWriteManifest).toHaveBeenCalled();
    });

    it("no conflict path — checks called but no issues, copy proceeds", async () => {
      // Default setup: no collisions, no unmanaged
      await runAdd("owner/my-skill");

      expect(mockComputeIncomingFiles).toHaveBeenCalled();
      expect(mockCheckFileCollisions).toHaveBeenCalled();
      expect(mockCheckUnmanagedConflicts).toHaveBeenCalled();
      expect(mockCopyBareSkill).toHaveBeenCalled();
      // resolveCollisions should NOT be called when no collisions
      expect(mockResolveCollisions).not.toHaveBeenCalled();
      // resolveUnmanagedConflicts should NOT be called when no conflicts
      expect(mockResolveUnmanagedConflicts).not.toHaveBeenCalled();
    });

    it("manifest write uses updated manifest from collision resolution", async () => {
      const collidingManifest: Manifest = {
        "other/repo": {
          ref: "main",
          commit: "old123",
          installedAt: "2026-01-01T00:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/other-skill/"],
        },
      };
      const resolvedManifest: Manifest = {};

      mockReadManifest.mockResolvedValue(collidingManifest);
      mockCheckFileCollisions.mockReturnValue(
        new Map([["other/repo", [".claude/skills/my-skill/"]]]),
      );
      mockResolveCollisions.mockResolvedValue({
        resolved: true,
        updatedManifest: resolvedManifest,
      });
      mockAddEntry.mockReturnValue({
        "owner/my-skill": MANIFEST_ENTRY,
      });

      await runAdd("owner/my-skill");

      // addEntry should use the resolved manifest, not the original
      expect(mockAddEntry).toHaveBeenCalledWith(
        resolvedManifest,
        "owner/my-skill",
        expect.any(Object),
      );
    });

    it("unmanaged check receives pluginKey for standalone", async () => {
      mockCheckUnmanagedConflicts.mockResolvedValue([
        ".claude/skills/my-skill/",
      ]);
      mockResolveUnmanagedConflicts.mockResolvedValue({
        approved: [".claude/skills/my-skill/"],
        cancelled: [],
      });

      await runAdd("owner/my-skill");

      expect(mockResolveUnmanagedConflicts).toHaveBeenCalledWith([
        {
          pluginKey: "owner/my-skill",
          files: [".claude/skills/my-skill/"],
        },
      ]);
    });

    it("collision check uses manifest from after nuke (reinstall)", async () => {
      const existingManifest: Manifest = {
        "owner/my-skill": {
          ref: "main",
          commit: "old123",
          installedAt: "2026-01-01T00:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(existingManifest);

      await runAdd("owner/my-skill");

      // Collision check should pass the manifest AND the excludeKey
      expect(mockCheckFileCollisions).toHaveBeenCalledWith(
        [".claude/skills/my-skill/"],
        existingManifest,
        "owner/my-skill",
      );
    });
  });

  describe("conflict flow — collection", () => {
    const COLLECTION_PARSED: ParsedSource = {
      type: "github-shorthand",
      owner: "owner",
      repo: "my-collection",
      ref: "main",
      manifestKey: "owner/my-collection",
    };

    const COLLECTION_CLONE_RESULT: CloneResult = {
      tempDir: "/tmp/agntc-coll-conflict",
      commit: "collconf123",
    };

    const COLLECTION_DETECTED: DetectedType = {
      type: "collection",
      plugins: ["pluginA", "pluginB"],
    };

    function setupCollectionConflictBase(): void {
      mockParseSource.mockReturnValue(COLLECTION_PARSED);
      mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
      mockReadConfig.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
        return { agents: ["claude"] };
      });
      mockDetectType.mockImplementation(async (dir) => {
        if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
        return { type: "bare-skill" } as DetectedType;
      });
      mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
      mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
      mockDetectAgents.mockResolvedValue(["claude"]);
      mockGetDriver.mockReturnValue(FAKE_DRIVER);
      mockSelectAgents.mockResolvedValue(["claude"]);
      mockWriteManifest.mockResolvedValue(undefined);
      mockCleanupTempDir.mockResolvedValue(undefined);
      mockAddEntry.mockImplementation((manifest, key, entry) => ({
        ...manifest,
        [key]: entry,
      }));
      mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

      // Per-plugin computeIncomingFiles
      mockComputeIncomingFiles.mockImplementation((input: any) => {
        if (input.sourceDir?.endsWith("/pluginA")) {
          return [".claude/skills/pluginA/"];
        }
        if (input.sourceDir?.endsWith("/pluginB")) {
          return [".claude/skills/pluginB/"];
        }
        return [];
      });
      mockCheckFileCollisions.mockReturnValue(new Map());
      mockResolveCollisions.mockResolvedValue({
        resolved: true,
        updatedManifest: EMPTY_MANIFEST,
      });
      mockCheckUnmanagedConflicts.mockResolvedValue([]);
      mockResolveUnmanagedConflicts.mockResolvedValue({
        approved: [],
        cancelled: [],
      });
      mockCopyBareSkill
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
        .mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });
    }

    it("per-plugin collision and unmanaged checks called for each plugin", async () => {
      setupCollectionConflictBase();

      await runAdd("owner/my-collection");

      expect(mockComputeIncomingFiles).toHaveBeenCalledTimes(2);
      expect(mockCheckFileCollisions).toHaveBeenCalledTimes(2);
      expect(mockCheckUnmanagedConflicts).toHaveBeenCalledTimes(2);
    });

    it("cancelled plugin at unmanaged stage excluded from copy", async () => {
      setupCollectionConflictBase();
      // pluginA has unmanaged conflict, user cancels
      mockCheckUnmanagedConflicts.mockImplementation(async (files) => {
        if (files.includes(".claude/skills/pluginA/")) {
          return [".claude/skills/pluginA/"];
        }
        return [];
      });
      mockResolveUnmanagedConflicts.mockResolvedValue({
        approved: [],
        cancelled: [".claude/skills/pluginA/"],
      });

      await runAdd("owner/my-collection");

      // Only pluginB should be copied
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
      expect(mockCopyBareSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDir: COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
        }),
      );
    });

    it("cancelled plugin at collision stage excluded from copy", async () => {
      setupCollectionConflictBase();
      // pluginA has collision, user cancels
      mockCheckFileCollisions.mockImplementation((files) => {
        if (files.includes(".claude/skills/pluginA/")) {
          return new Map([
            ["other/repo", [".claude/skills/pluginA/"]],
          ]);
        }
        return new Map();
      });
      mockResolveCollisions.mockResolvedValue({
        resolved: false,
        updatedManifest: EMPTY_MANIFEST,
      });

      await runAdd("owner/my-collection");

      // Only pluginB should be copied
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
      expect(mockCopyBareSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDir: COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
        }),
      );
    });

    it("all plugins cancelled exits gracefully", async () => {
      setupCollectionConflictBase();
      mockCheckFileCollisions.mockReturnValue(
        new Map([["other/repo", [".claude/skills/pluginA/"]]]),
      );
      mockResolveCollisions.mockResolvedValue({
        resolved: false,
        updatedManifest: EMPTY_MANIFEST,
      });

      const err = await runAdd("owner/my-collection").catch((e) => e);

      // Should still succeed even with all cancelled (just nothing installed)
      // The behavior depends on implementation - might show "no plugins installed"
      expect(mockCopyBareSkill).not.toHaveBeenCalled();
    });

    it("collision removal persists even if plugin later cancelled at unmanaged", async () => {
      const manifestWithOther: Manifest = {
        "other/repo": {
          ref: "main",
          commit: "old123",
          installedAt: "2026-01-01T00:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/pluginA/"],
        },
      };
      const manifestAfterRemoval: Manifest = {};
      setupCollectionConflictBase();
      mockReadManifest.mockResolvedValue(manifestWithOther);

      // pluginA: collision found, user resolves (removes other/repo)
      mockCheckFileCollisions.mockImplementation((files) => {
        if (files.includes(".claude/skills/pluginA/")) {
          return new Map([["other/repo", [".claude/skills/pluginA/"]]]);
        }
        return new Map();
      });
      mockResolveCollisions.mockResolvedValue({
        resolved: true,
        updatedManifest: manifestAfterRemoval,
      });
      // Then pluginA has unmanaged conflict, user cancels
      mockCheckUnmanagedConflicts.mockImplementation(async (files) => {
        if (files.includes(".claude/skills/pluginA/")) {
          return [".claude/skills/pluginA/"];
        }
        return [];
      });
      mockResolveUnmanagedConflicts.mockResolvedValue({
        approved: [],
        cancelled: [".claude/skills/pluginA/"],
      });

      await runAdd("owner/my-collection");

      // The manifest write should use the updated manifest (collision removal persisted)
      // pluginB should still be installed using the updated manifest
      expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
      // The final manifest write should reflect the removal from collision resolution
      const writeCall = mockWriteManifest.mock.calls[0];
      expect(writeCall).toBeDefined();
    });

    it("summary notes skipped plugins with reason", async () => {
      setupCollectionConflictBase();
      // pluginA has unmanaged conflict, user cancels
      mockCheckUnmanagedConflicts.mockImplementation(async (files) => {
        if (files.includes(".claude/skills/pluginA/")) {
          return [".claude/skills/pluginA/"];
        }
        return [];
      });
      mockResolveUnmanagedConflicts.mockResolvedValue({
        approved: [],
        cancelled: [".claude/skills/pluginA/"],
      });

      await runAdd("owner/my-collection");

      const outroCall = mockOutro.mock.calls[0]![0] as string;
      expect(outroCall).toContain("pluginB");
      // Should note the skipped plugin
      expect(outroCall).toMatch(/1.*skip|cancel/i);
    });

    it("uses per-plugin manifest key as excludeKey for collision check", async () => {
      setupCollectionConflictBase();

      await runAdd("owner/my-collection");

      // Each plugin's collision check should use its own manifest key as excludeKey
      const collisionCalls = mockCheckFileCollisions.mock.calls;
      expect(collisionCalls).toHaveLength(2);
      expect(collisionCalls[0]![2]).toBe("owner/my-collection/pluginA");
      expect(collisionCalls[1]![2]).toBe("owner/my-collection/pluginB");
    });
  });
});

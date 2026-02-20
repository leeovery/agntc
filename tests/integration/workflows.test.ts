import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, mkdtemp, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeIncomingFiles } from "../../src/compute-incoming-files.js";
import { checkFileCollisions } from "../../src/collision-check.js";
import { checkUnmanagedConflicts } from "../../src/unmanaged-check.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import { readManifest, writeManifest, addEntry, removeEntry } from "../../src/manifest.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { executeNukeAndReinstall } from "../../src/nuke-reinstall-pipeline.js";
import { ClaudeDriver } from "../../src/drivers/claude-driver.js";
import { CodexDriver } from "../../src/drivers/codex-driver.js";
import type { AgentWithDriver } from "../../src/drivers/types.js";

// Real drivers -- the integration point
const claudeDriver = new ClaudeDriver();
const codexDriver = new CodexDriver();

function claudeAgent(): AgentWithDriver {
  return { id: "claude", driver: claudeDriver };
}

function codexAgent(): AgentWithDriver {
  return { id: "codex", driver: codexDriver };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function createFile(base: string, ...segments: string[]): Promise<void> {
  const filePath = join(base, ...segments);
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, `content of ${segments.join("/")}`);
}

async function createJson(base: string, fileName: string, data: unknown): Promise<void> {
  await mkdir(base, { recursive: true });
  await writeFile(join(base, fileName), JSON.stringify(data, null, 2));
}

describe("integration: core workflows", () => {
  let testDir: string;
  let projectDir: string;
  let sourceDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agntc-integration-"));
    projectDir = join(testDir, "project");
    sourceDir = join(testDir, "source");
    await mkdir(projectDir, { recursive: true });
    await mkdir(sourceDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("bare skill add", () => {
    it("computes incoming files, copies skill, and writes manifest with consistent paths", async () => {
      // Set up a bare skill source: agntc.json + SKILL.md + reference
      const skillDir = join(sourceDir, "go-development");
      await createJson(skillDir, "agntc.json", { agents: ["claude"] });
      await createFile(skillDir, "SKILL.md");
      await createFile(skillDir, "references", "guide.md");

      const agents = [claudeAgent()];

      // 1. Compute incoming files (predict what will be copied)
      const incomingFiles = await computeIncomingFiles({
        type: "bare-skill",
        sourceDir: skillDir,
        agents,
      });

      expect(incomingFiles).toEqual([".claude/skills/go-development/"]);

      // 2. Check collisions against empty manifest
      const manifest: Manifest = {};
      const collisions = checkFileCollisions(incomingFiles, manifest);
      expect(collisions.size).toBe(0);

      // 3. Check unmanaged conflicts (nothing on disk yet)
      const unmanagedConflicts = await checkUnmanagedConflicts(
        incomingFiles,
        manifest,
        projectDir,
      );
      expect(unmanagedConflicts).toEqual([]);

      // 4. Copy the bare skill
      const copyResult = await copyBareSkill({
        sourceDir: skillDir,
        projectDir,
        agents,
      });

      // 5. Verify files on disk
      expect(await fileExists(join(projectDir, ".claude/skills/go-development/SKILL.md"))).toBe(true);
      expect(await fileExists(join(projectDir, ".claude/skills/go-development/references/guide.md"))).toBe(true);
      // agntc.json excluded
      expect(await fileExists(join(projectDir, ".claude/skills/go-development/agntc.json"))).toBe(false);

      // 6. Verify copied files match computed incoming files (path format consistency)
      expect(copyResult.copiedFiles).toEqual(incomingFiles);

      // 7. Write manifest
      const entry: ManifestEntry = {
        ref: null,
        commit: "abc123",
        installedAt: new Date().toISOString(),
        agents: ["claude"],
        files: copyResult.copiedFiles,
        cloneUrl: null,
      };
      const updatedManifest = addEntry(manifest, "owner/go-development", entry);
      await writeManifest(projectDir, updatedManifest);

      // 8. Read manifest back and verify
      const savedManifest = await readManifest(projectDir);
      expect(savedManifest["owner/go-development"]).toBeDefined();
      expect(savedManifest["owner/go-development"]!.files).toEqual([
        ".claude/skills/go-development/",
      ]);
      expect(savedManifest["owner/go-development"]!.agents).toEqual(["claude"]);
    });
  });

  describe("plugin add with collision detection", () => {
    it("detects collision when two plugins produce overlapping file paths", async () => {
      // Plugin A: has skills/planning/ directory
      const pluginADir = join(sourceDir, "plugin-a");
      await createJson(pluginADir, "agntc.json", { agents: ["claude"] });
      await createFile(pluginADir, "skills", "planning", "SKILL.md");

      // Plugin B: also has skills/planning/ directory
      const pluginBDir = join(sourceDir, "plugin-b");
      await createJson(pluginBDir, "agntc.json", { agents: ["claude"] });
      await createFile(pluginBDir, "skills", "planning", "SKILL.md");
      await createFile(pluginBDir, "skills", "review", "SKILL.md");

      const agents = [claudeAgent()];

      // Install plugin A first
      const pluginAIncoming = await computeIncomingFiles({
        type: "plugin",
        sourceDir: pluginADir,
        assetDirs: ["skills"],
        agents,
      });

      const copyResultA = await copyPluginAssets({
        sourceDir: pluginADir,
        assetDirs: ["skills"],
        agents,
        projectDir,
      });

      // Write manifest for plugin A
      const entryA: ManifestEntry = {
        ref: null,
        commit: "aaa111",
        installedAt: new Date().toISOString(),
        agents: ["claude"],
        files: copyResultA.copiedFiles,
        cloneUrl: null,
      };
      let manifest: Manifest = addEntry({}, "owner/plugin-a", entryA);
      await writeManifest(projectDir, manifest);

      // Verify plugin A files exist on disk
      expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);

      // Now compute incoming files for plugin B
      const pluginBIncoming = await computeIncomingFiles({
        type: "plugin",
        sourceDir: pluginBDir,
        assetDirs: ["skills"],
        agents,
      });

      // Check collisions -- planning/ should collide with plugin A
      const collisions = checkFileCollisions(pluginBIncoming, manifest);
      expect(collisions.size).toBeGreaterThan(0);
      expect(collisions.has("owner/plugin-a")).toBe(true);

      // The overlapping path should be the planning skill directory
      const overlappingPaths = collisions.get("owner/plugin-a")!;
      expect(overlappingPaths).toContain(".claude/skills/planning/");
    });
  });

  describe("update with agent drop", () => {
    it("removes dropped agent files and updates manifest on update", async () => {
      // Source v1: supports both claude and codex
      const pluginDir = join(sourceDir, "multi-agent-skill");
      await createJson(pluginDir, "agntc.json", { agents: ["claude", "codex"] });
      await createFile(pluginDir, "SKILL.md");
      await createFile(pluginDir, "references", "cheatsheet.md");

      const agents = [claudeAgent(), codexAgent()];

      // Install v1 for both agents
      const copyResult = await copyBareSkill({
        sourceDir: pluginDir,
        projectDir,
        agents,
      });

      // Verify both agent target dirs exist
      expect(await fileExists(join(projectDir, ".claude/skills/multi-agent-skill/SKILL.md"))).toBe(true);
      expect(await fileExists(join(projectDir, ".agents/skills/multi-agent-skill/SKILL.md"))).toBe(true);

      // Write manifest entry
      const entry: ManifestEntry = {
        ref: null,
        commit: "v1hash",
        installedAt: new Date().toISOString(),
        agents: ["claude", "codex"],
        files: copyResult.copiedFiles,
        cloneUrl: null,
      };
      let manifest: Manifest = addEntry({}, "owner/multi-agent-skill", entry);
      await writeManifest(projectDir, manifest);

      // Now modify source to drop codex support (simulate v2)
      await writeFile(
        join(pluginDir, "agntc.json"),
        JSON.stringify({ agents: ["claude"] }, null, 2),
      );

      // Run nuke-and-reinstall pipeline (the update mechanism)
      let droppedWarning = "";
      const pipelineResult = await executeNukeAndReinstall({
        key: "owner/multi-agent-skill",
        sourceDir: pluginDir,
        existingEntry: entry,
        projectDir,
        newCommit: "v2hash",
        onAgentsDropped: (dropped) => {
          droppedWarning = `Dropped: ${dropped.join(", ")}`;
        },
        onWarn: () => {},
      });

      // Verify pipeline succeeded
      expect(pipelineResult.status).toBe("success");
      if (pipelineResult.status !== "success") throw new Error("unexpected");

      // Verify warning was fired
      expect(droppedWarning).toBe("Dropped: codex");

      // Verify codex files removed from disk
      expect(await fileExists(join(projectDir, ".agents/skills/multi-agent-skill/SKILL.md"))).toBe(false);

      // Verify claude files still present
      expect(await fileExists(join(projectDir, ".claude/skills/multi-agent-skill/SKILL.md"))).toBe(true);

      // Verify updated manifest entry reflects agent change
      expect(pipelineResult.entry.agents).toEqual(["claude"]);
      expect(pipelineResult.droppedAgents).toEqual(["codex"]);

      // Write updated manifest and verify round-trip
      manifest = addEntry(manifest, "owner/multi-agent-skill", pipelineResult.entry);
      await writeManifest(projectDir, manifest);

      const savedManifest = await readManifest(projectDir);
      const savedEntry = savedManifest["owner/multi-agent-skill"]!;
      expect(savedEntry.agents).toEqual(["claude"]);
      expect(savedEntry.commit).toBe("v2hash");
      // Files should only include claude paths
      expect(savedEntry.files.every((f) => f.startsWith(".claude/"))).toBe(true);
      expect(savedEntry.files.some((f) => f.startsWith(".agents/"))).toBe(false);
    });
  });

  describe("remove", () => {
    it("adds a plugin then removes it, verifying files deleted and manifest cleaned", async () => {
      // Set up a plugin with skills and agents
      const pluginDir = join(sourceDir, "workflow-plugin");
      await createJson(pluginDir, "agntc.json", { agents: ["claude"] });
      await createFile(pluginDir, "skills", "planning", "SKILL.md");
      await createFile(pluginDir, "skills", "planning", "references", "guide.md");
      await createFile(pluginDir, "agents", "executor.md");
      await createFile(pluginDir, "hooks", "pre-commit.sh");

      const agents = [claudeAgent()];

      // Install the plugin
      const copyResult = await copyPluginAssets({
        sourceDir: pluginDir,
        assetDirs: ["skills", "agents", "hooks"],
        agents,
        projectDir,
      });

      // Verify files exist on disk
      expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
      expect(await fileExists(join(projectDir, ".claude/skills/planning/references/guide.md"))).toBe(true);
      expect(await fileExists(join(projectDir, ".claude/agents/executor.md"))).toBe(true);
      expect(await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh"))).toBe(true);

      // Write manifest
      const entry: ManifestEntry = {
        ref: "v1.0",
        commit: "xyz789",
        installedAt: new Date().toISOString(),
        agents: ["claude"],
        files: copyResult.copiedFiles,
        cloneUrl: null,
      };
      let manifest: Manifest = addEntry({}, "owner/workflow-plugin", entry);
      await writeManifest(projectDir, manifest);

      // Verify manifest is written
      const savedManifest = await readManifest(projectDir);
      expect(savedManifest["owner/workflow-plugin"]).toBeDefined();

      // Now remove: nuke files and update manifest
      await nukeManifestFiles(projectDir, entry.files);
      manifest = removeEntry(manifest, "owner/workflow-plugin");
      await writeManifest(projectDir, manifest);

      // Verify all plugin files are gone
      expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(false);
      expect(await fileExists(join(projectDir, ".claude/skills/planning/references/guide.md"))).toBe(false);
      expect(await fileExists(join(projectDir, ".claude/agents/executor.md"))).toBe(false);
      expect(await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh"))).toBe(false);

      // Verify manifest no longer has the entry
      const finalManifest = await readManifest(projectDir);
      expect(finalManifest["owner/workflow-plugin"]).toBeUndefined();
      expect(Object.keys(finalManifest)).toHaveLength(0);
    });
  });
});

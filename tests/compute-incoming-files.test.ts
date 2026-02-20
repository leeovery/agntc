import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { computeIncomingFiles } from "../src/compute-incoming-files.js";
import type { AgentDriver, AssetType } from "../src/drivers/types.js";

function makeDriver(targetDirs: Partial<Record<AssetType, string>>): AgentDriver {
  return {
    detect: vi.fn().mockResolvedValue(true),
    getTargetDir: vi.fn((assetType: AssetType) => targetDirs[assetType] ?? null),
  };
}

describe("computeIncomingFiles", () => {
  describe("bare-skill", () => {
    it("computes target path for single agent", async () => {
      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents,
      });

      expect(result).toEqual([".claude/skills/my-skill/"]);
    });

    it("computes target paths for multiple agents", async () => {
      const claudeDriver = makeDriver({ skills: ".claude/skills" });
      const codexDriver = makeDriver({ skills: ".agents/skills" });
      const agents = [
        { id: "claude", driver: claudeDriver },
        { id: "codex", driver: codexDriver },
      ];

      const result = await computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents,
      });

      expect(result).toEqual([
        ".claude/skills/my-skill/",
        ".agents/skills/my-skill/",
      ]);
    });

    it("skips agents where driver returns null for skills", async () => {
      const claudeDriver = makeDriver({ skills: ".claude/skills" });
      const nullDriver = makeDriver({});
      const agents = [
        { id: "claude", driver: claudeDriver },
        { id: "codex", driver: nullDriver },
      ];

      const result = await computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents,
      });

      expect(result).toEqual([".claude/skills/my-skill/"]);
    });

    it("uses basename of sourceDir as skill name", async () => {
      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/some/deep/path/planning-skill",
        agents,
      });

      expect(result).toEqual([".claude/skills/planning-skill/"]);
    });
  });

  describe("plugin", () => {
    let sourceDir: string;

    beforeEach(async () => {
      sourceDir = await mkdtemp(join(tmpdir(), "compute-incoming-"));
    });

    afterEach(async () => {
      await rm(sourceDir, { recursive: true, force: true });
    });

    it("enumerates individual skill directories", async () => {
      await mkdir(join(sourceDir, "skills/planning"), { recursive: true });
      await writeFile(join(sourceDir, "skills/planning/SKILL.md"), "# Planning");
      await mkdir(join(sourceDir, "skills/review"), { recursive: true });
      await writeFile(join(sourceDir, "skills/review/SKILL.md"), "# Review");

      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["skills"],
        agents,
      });

      expect(result).toEqual(
        expect.arrayContaining([
          ".claude/skills/planning/",
          ".claude/skills/review/",
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it("enumerates individual agent files", async () => {
      await mkdir(join(sourceDir, "agents"), { recursive: true });
      await writeFile(join(sourceDir, "agents/executor.md"), "# Executor");

      const driver = makeDriver({ agents: ".claude/agents" });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["agents"],
        agents,
      });

      expect(result).toEqual([".claude/agents/executor.md"]);
    });

    it("enumerates individual hook files", async () => {
      await mkdir(join(sourceDir, "hooks"), { recursive: true });
      await writeFile(join(sourceDir, "hooks/pre-commit.sh"), "#!/bin/bash");

      const driver = makeDriver({ hooks: ".claude/hooks" });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["hooks"],
        agents,
      });

      expect(result).toEqual([".claude/hooks/pre-commit.sh"]);
    });

    it("enumerates all asset types together", async () => {
      await mkdir(join(sourceDir, "skills/planning"), { recursive: true });
      await writeFile(join(sourceDir, "skills/planning/SKILL.md"), "# Planning");
      await mkdir(join(sourceDir, "skills/review"), { recursive: true });
      await writeFile(join(sourceDir, "skills/review/SKILL.md"), "# Review");
      await mkdir(join(sourceDir, "agents"), { recursive: true });
      await writeFile(join(sourceDir, "agents/executor.md"), "# Executor");
      await mkdir(join(sourceDir, "hooks"), { recursive: true });
      await writeFile(join(sourceDir, "hooks/pre-commit.sh"), "#!/bin/bash");

      const driver = makeDriver({
        skills: ".claude/skills",
        agents: ".claude/agents",
        hooks: ".claude/hooks",
      });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["skills", "agents", "hooks"],
        agents,
      });

      expect(result).toEqual(
        expect.arrayContaining([
          ".claude/skills/planning/",
          ".claude/skills/review/",
          ".claude/agents/executor.md",
          ".claude/hooks/pre-commit.sh",
        ]),
      );
      expect(result).toHaveLength(4);
    });

    it("skips asset dirs where driver returns null", async () => {
      await mkdir(join(sourceDir, "skills/planning"), { recursive: true });
      await writeFile(join(sourceDir, "skills/planning/SKILL.md"), "# Planning");
      await mkdir(join(sourceDir, "agents"), { recursive: true });
      await writeFile(join(sourceDir, "agents/executor.md"), "# Executor");

      const codexDriver = makeDriver({ skills: ".agents/skills" });
      const agents = [{ id: "codex", driver: codexDriver }];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["skills", "agents"],
        agents,
      });

      // Codex doesn't support agents, so only skills should appear
      expect(result).toEqual([".agents/skills/planning/"]);
    });

    it("deduplicates paths across agents", async () => {
      await mkdir(join(sourceDir, "skills/planning"), { recursive: true });
      await writeFile(join(sourceDir, "skills/planning/SKILL.md"), "# Planning");

      const claudeDriver = makeDriver({ skills: ".claude/skills" });
      const codexDriver = makeDriver({ skills: ".claude/skills" });
      const agents = [
        { id: "claude", driver: claudeDriver },
        { id: "codex", driver: codexDriver },
      ];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["skills"],
        agents,
      });

      expect(result).toEqual([".claude/skills/planning/"]);
    });

    it("produces paths for multiple agents with different targets", async () => {
      await mkdir(join(sourceDir, "skills/planning"), { recursive: true });
      await writeFile(join(sourceDir, "skills/planning/SKILL.md"), "# Planning");

      const claudeDriver = makeDriver({ skills: ".claude/skills" });
      const codexDriver = makeDriver({ skills: ".agents/skills" });
      const agents = [
        { id: "claude", driver: claudeDriver },
        { id: "codex", driver: codexDriver },
      ];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["skills"],
        agents,
      });

      expect(result).toEqual(
        expect.arrayContaining([
          ".claude/skills/planning/",
          ".agents/skills/planning/",
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it("returns empty array when source asset dir is empty", async () => {
      await mkdir(join(sourceDir, "skills"), { recursive: true });

      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["skills"],
        agents,
      });

      expect(result).toEqual([]);
    });

    it("returns empty array when source asset dir does not exist", async () => {
      // sourceDir exists but skills/ does not
      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = await computeIncomingFiles({
        type: "plugin",
        sourceDir,
        assetDirs: ["skills"],
        agents,
      });

      expect(result).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when no agents provided", async () => {
      const result = await computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents: [],
      });

      expect(result).toEqual([]);
    });

    it("returns empty array for plugin with no asset dirs", async () => {
      const sourceDir = await mkdtemp(join(tmpdir(), "compute-incoming-"));
      try {
        const driver = makeDriver({ skills: ".claude/skills" });
        const agents = [{ id: "claude", driver }];

        const result = await computeIncomingFiles({
          type: "plugin",
          sourceDir,
          assetDirs: [],
          agents,
        });

        expect(result).toEqual([]);
      } finally {
        await rm(sourceDir, { recursive: true, force: true });
      }
    });
  });
});

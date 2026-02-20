import { describe, it, expect, vi } from "vitest";
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
    it("computes target path for single agent", () => {
      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents,
      });

      expect(result).toEqual([".claude/skills/my-skill/"]);
    });

    it("computes target paths for multiple agents", () => {
      const claudeDriver = makeDriver({ skills: ".claude/skills" });
      const codexDriver = makeDriver({ skills: ".agents/skills" });
      const agents = [
        { id: "claude", driver: claudeDriver },
        { id: "codex", driver: codexDriver },
      ];

      const result = computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents,
      });

      expect(result).toEqual([
        ".claude/skills/my-skill/",
        ".agents/skills/my-skill/",
      ]);
    });

    it("skips agents where driver returns null for skills", () => {
      const claudeDriver = makeDriver({ skills: ".claude/skills" });
      const nullDriver = makeDriver({});
      const agents = [
        { id: "claude", driver: claudeDriver },
        { id: "codex", driver: nullDriver },
      ];

      const result = computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents,
      });

      expect(result).toEqual([".claude/skills/my-skill/"]);
    });

    it("uses basename of sourceDir as skill name", () => {
      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/some/deep/path/planning-skill",
        agents,
      });

      expect(result).toEqual([".claude/skills/planning-skill/"]);
    });
  });

  describe("plugin", () => {
    it("computes target paths for single asset dir and agent", () => {
      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = computeIncomingFiles({
        type: "plugin",
        assetDirs: ["skills"],
        agents,
      });

      expect(result).toEqual([".claude/skills/"]);
    });

    it("computes target paths for multiple asset dirs and agents", () => {
      const claudeDriver = makeDriver({
        skills: ".claude/skills",
        agents: ".claude/agents",
        hooks: ".claude/hooks",
      });
      const agents = [{ id: "claude", driver: claudeDriver }];

      const result = computeIncomingFiles({
        type: "plugin",
        assetDirs: ["skills", "agents", "hooks"],
        agents,
      });

      expect(result).toEqual([
        ".claude/skills/",
        ".claude/agents/",
        ".claude/hooks/",
      ]);
    });

    it("skips asset dirs where driver returns null", () => {
      const codexDriver = makeDriver({ skills: ".agents/skills" });
      const agents = [{ id: "codex", driver: codexDriver }];

      const result = computeIncomingFiles({
        type: "plugin",
        assetDirs: ["skills", "agents", "hooks"],
        agents,
      });

      expect(result).toEqual([".agents/skills/"]);
    });

    it("deduplicates paths across agents", () => {
      const claudeDriver = makeDriver({ skills: ".claude/skills" });
      const codexDriver = makeDriver({ skills: ".claude/skills" });
      const agents = [
        { id: "claude", driver: claudeDriver },
        { id: "codex", driver: codexDriver },
      ];

      const result = computeIncomingFiles({
        type: "plugin",
        assetDirs: ["skills"],
        agents,
      });

      expect(result).toEqual([".claude/skills/"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array when no agents provided", () => {
      const result = computeIncomingFiles({
        type: "bare-skill",
        sourceDir: "/tmp/my-skill",
        agents: [],
      });

      expect(result).toEqual([]);
    });

    it("returns empty array for plugin with no asset dirs", () => {
      const driver = makeDriver({ skills: ".claude/skills" });
      const agents = [{ id: "claude", driver }];

      const result = computeIncomingFiles({
        type: "plugin",
        assetDirs: [],
        agents,
      });

      expect(result).toEqual([]);
    });
  });
});

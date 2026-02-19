import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import type { AgentDriver, AgentId } from "../src/drivers/types.js";

let testDir: string;
let sourceDir: string;
let projectDir: string;

function makeDriver(targets: Record<string, string | null>): AgentDriver {
  return {
    detect: async () => true,
    getTargetDir: (assetType: string) => targets[assetType] ?? null,
  };
}

async function createSourceFile(
  ...segments: string[]
): Promise<void> {
  const filePath = join(sourceDir, ...segments);
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, `content of ${segments.join("/")}`);
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

describe("copyPluginAssets", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agntc-plugin-test-"));
    sourceDir = join(testDir, "my-plugin");
    projectDir = join(testDir, "project");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("copies skills/agents/hooks contents to targets", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");
    await createSourceFile("agents", "reviewer", "agent.md");
    await createSourceFile("hooks", "pre-commit.sh");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills", "agents", "hooks"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({
            skills: ".claude/skills",
            agents: ".claude/agents",
            hooks: ".claude/hooks",
          }),
        },
      ],
      projectDir,
    });

    expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
    expect(await fileExists(join(projectDir, ".claude/agents/reviewer/agent.md"))).toBe(true);
    expect(await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh"))).toBe(true);
    expect(result.copiedFiles.length).toBeGreaterThan(0);
  });

  it("does not create extra nesting level", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");

    await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
      ],
      projectDir,
    });

    // Should be .claude/skills/planning/SKILL.md, NOT .claude/skills/skills/planning/SKILL.md
    expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
    expect(await fileExists(join(projectDir, ".claude/skills/skills/planning/SKILL.md"))).toBe(false);
  });

  it("skips asset types where getTargetDir returns null", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");
    await createSourceFile("hooks", "pre-commit.sh");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills", "hooks"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills", hooks: null }),
        },
      ],
      projectDir,
    });

    expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
    expect(await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh"))).toBe(false);
    expect(result.copiedFiles.every((f) => !f.includes("hooks"))).toBe(true);
  });

  it("only processes asset dirs in assetDirs input", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");
    await createSourceFile("agents", "reviewer", "agent.md");
    await createSourceFile("hooks", "pre-commit.sh");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({
            skills: ".claude/skills",
            agents: ".claude/agents",
            hooks: ".claude/hooks",
          }),
        },
      ],
      projectDir,
    });

    expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
    expect(await fileExists(join(projectDir, ".claude/agents/reviewer/agent.md"))).toBe(false);
    expect(await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh"))).toBe(false);
  });

  it("creates missing target dirs recursively", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");

    await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: "deep/nested/.claude/skills" }),
        },
      ],
      projectDir,
    });

    expect(await fileExists(join(projectDir, "deep/nested/.claude/skills/planning/SKILL.md"))).toBe(true);
  });

  it("returns correct relative paths with trailing slash for dirs", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");
    await createSourceFile("skills", "coding", "SKILL.md");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
      ],
      projectDir,
    });

    expect(result.copiedFiles).toContain(".claude/skills/planning/");
    expect(result.copiedFiles).toContain(".claude/skills/planning/SKILL.md");
    expect(result.copiedFiles).toContain(".claude/skills/coding/");
    expect(result.copiedFiles).toContain(".claude/skills/coding/SKILL.md");
  });

  it("returns correct per-agent counts", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");
    await createSourceFile("skills", "coding", "SKILL.md");
    await createSourceFile("agents", "reviewer", "agent.md");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills", "agents"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({
            skills: ".claude/skills",
            agents: ".claude/agents",
          }),
        },
      ],
      projectDir,
    });

    expect(result.assetCountsByAgent.claude).toEqual({
      skills: 2,
      agents: 1,
    });
  });

  it("handles empty asset dir", async () => {
    await mkdir(join(sourceDir, "skills"), { recursive: true });

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
      ],
      projectDir,
    });

    expect(result.assetCountsByAgent.claude).toEqual({ skills: 0 });
    expect(result.copiedFiles).toEqual([]);
  });

  it("preserves nested subdirs", async () => {
    await createSourceFile("skills", "planning", "references", "deep", "guide.md");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
      ],
      projectDir,
    });

    const destFile = join(projectDir, ".claude/skills/planning/references/deep/guide.md");
    expect(await fileExists(destFile)).toBe(true);
    expect(await readFile(destFile, "utf-8")).toBe(
      "content of skills/planning/references/deep/guide.md",
    );
  });

  it("handles mixed files and dirs in asset dir", async () => {
    await createSourceFile("skills", "standalone.md");
    await createSourceFile("skills", "planning", "SKILL.md");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
      ],
      projectDir,
    });

    expect(await fileExists(join(projectDir, ".claude/skills/standalone.md"))).toBe(true);
    expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
    expect(result.copiedFiles).toContain(".claude/skills/standalone.md");
    expect(result.copiedFiles).toContain(".claude/skills/planning/");
    expect(result.copiedFiles).toContain(".claude/skills/planning/SKILL.md");
  });

  it("handles multiple agents with different targets", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
        {
          id: "codex",
          driver: makeDriver({ skills: ".codex/skills" }),
        },
      ],
      projectDir,
    });

    expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
    expect(await fileExists(join(projectDir, ".codex/skills/planning/SKILL.md"))).toBe(true);
    expect(result.copiedFiles).toContain(".claude/skills/planning/");
    expect(result.copiedFiles).toContain(".codex/skills/planning/");
    expect(result.assetCountsByAgent.claude).toEqual({ skills: 1 });
    expect(result.assetCountsByAgent.codex).toEqual({ skills: 1 });
  });

  it("handles subset of asset types", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");
    await createSourceFile("hooks", "pre-commit.sh");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills", "hooks"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({
            skills: ".claude/skills",
            hooks: ".claude/hooks",
          }),
        },
      ],
      projectDir,
    });

    expect(result.assetCountsByAgent.claude).toEqual({
      skills: 1,
      hooks: 1,
    });
  });

  it("handles single asset type", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
      ],
      projectDir,
    });

    expect(result.assetCountsByAgent.claude).toEqual({ skills: 1 });
    expect(result.copiedFiles).toContain(".claude/skills/planning/");
    expect(result.copiedFiles).toContain(".claude/skills/planning/SKILL.md");
  });

  it("does not copy root-level files", async () => {
    await createSourceFile("README.md");
    await createSourceFile("agntc.json");
    await createSourceFile("skills", "planning", "SKILL.md");

    await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".claude/skills" }),
        },
      ],
      projectDir,
    });

    expect(await fileExists(join(projectDir, ".claude/skills/README.md"))).toBe(false);
    expect(await fileExists(join(projectDir, ".claude/skills/agntc.json"))).toBe(false);
    expect(await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md"))).toBe(true);
  });

  it("deduplicates copiedFiles across agents", async () => {
    await createSourceFile("skills", "planning", "SKILL.md");

    const result = await copyPluginAssets({
      sourceDir,
      assetDirs: ["skills"],
      agents: [
        {
          id: "claude",
          driver: makeDriver({ skills: ".shared/skills" }),
        },
        {
          id: "codex",
          driver: makeDriver({ skills: ".shared/skills" }),
        },
      ],
      projectDir,
    });

    const planningDirEntries = result.copiedFiles.filter(
      (f) => f === ".shared/skills/planning/",
    );
    expect(planningDirEntries).toHaveLength(1);
  });
});

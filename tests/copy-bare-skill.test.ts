import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, mkdtemp, readFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import type { AgentDriver } from "../src/drivers/types.js";

let testDir: string;
let sourceDir: string;
let projectDir: string;

function makeDriver(targetDir: string | null): AgentDriver {
  return {
    detect: async () => true,
    getTargetDir: () => targetDir,
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

describe("copyBareSkill", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agntc-copy-test-"));
    sourceDir = join(testDir, "source-skill");
    projectDir = join(testDir, "project");
    await mkdir(sourceDir, { recursive: true });
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("copies SKILL.md and references to target", async () => {
    await createSourceFile("SKILL.md");
    await createSourceFile("references", "guide.md");

    const result = await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    const destDir = join(projectDir, ".claude/skills/source-skill");
    expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
    expect(await fileExists(join(destDir, "references", "guide.md"))).toBe(true);
    expect(await readFile(join(destDir, "SKILL.md"), "utf-8")).toBe(
      "content of SKILL.md",
    );
    expect(result.copiedFiles).toEqual([".claude/skills/source-skill/"]);
  });

  it("excludes agntc.json", async () => {
    await createSourceFile("SKILL.md");
    await createSourceFile("agntc.json");

    const result = await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    const destDir = join(projectDir, ".claude/skills/source-skill");
    expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
    expect(await fileExists(join(destDir, "agntc.json"))).toBe(false);
  });

  it("preserves subdir structure", async () => {
    await createSourceFile("SKILL.md");
    await createSourceFile("examples", "basic.ts");
    await createSourceFile("examples", "advanced.ts");

    await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    const destDir = join(projectDir, ".claude/skills/source-skill");
    expect(await fileExists(join(destDir, "examples", "basic.ts"))).toBe(true);
    expect(await fileExists(join(destDir, "examples", "advanced.ts"))).toBe(true);
  });

  it("creates destination dir when missing", async () => {
    await createSourceFile("SKILL.md");

    await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver("deep/nested/skills") }],
    });

    const destDir = join(projectDir, "deep/nested/skills/source-skill");
    expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
  });

  it("returns correct relative paths with trailing slash", async () => {
    await createSourceFile("SKILL.md");
    await createSourceFile("references", "guide.md");

    const result = await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    const skillName = basename(sourceDir);
    const expectedDir = `.claude/skills/${skillName}/`;
    expect(result.copiedFiles).toContain(expectedDir);
  });

  it("skips agent when getTargetDir null", async () => {
    await createSourceFile("SKILL.md");

    const result = await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(null) }],
    });

    expect(result.copiedFiles).toEqual([]);
  });

  it("copies to multiple agents independently", async () => {
    await createSourceFile("SKILL.md");

    const result = await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [
        { id: "claude", driver: makeDriver(".claude/skills") },
        { id: "codex", driver: makeDriver(".codex/skills") },
      ],
    });

    const skillName = basename(sourceDir);
    const claudeDest = join(projectDir, ".claude/skills", skillName);
    const codexDest = join(projectDir, ".codex/skills", skillName);
    expect(await fileExists(join(claudeDest, "SKILL.md"))).toBe(true);
    expect(await fileExists(join(codexDest, "SKILL.md"))).toBe(true);
    expect(result.copiedFiles).toContain(`.claude/skills/${skillName}/`);
    expect(result.copiedFiles).toContain(`.codex/skills/${skillName}/`);
  });

  it("handles empty skill dir (only agntc.json)", async () => {
    await createSourceFile("agntc.json");

    const result = await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    const skillName = basename(sourceDir);
    const destDir = join(projectDir, ".claude/skills", skillName);
    expect(await fileExists(destDir)).toBe(true);
    expect(result.copiedFiles).toContain(`.claude/skills/${skillName}/`);
  });

  it("skillName matches source basename", async () => {
    const customSourceDir = join(testDir, "my-awesome-skill");
    await mkdir(customSourceDir, { recursive: true });
    await writeFile(join(customSourceDir, "SKILL.md"), "content");

    const result = await copyBareSkill({
      sourceDir: customSourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    const destDir = join(projectDir, ".claude/skills/my-awesome-skill");
    expect(await fileExists(join(destDir, "SKILL.md"))).toBe(true);
    expect(result.copiedFiles).toContain(".claude/skills/my-awesome-skill/");
  });

  it("handles deeply nested subdirs", async () => {
    await createSourceFile("SKILL.md");
    await createSourceFile("a", "b", "c", "deep.md");

    await copyBareSkill({
      sourceDir,
      projectDir,
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    const destDir = join(projectDir, ".claude/skills/source-skill");
    expect(await fileExists(join(destDir, "a", "b", "c", "deep.md"))).toBe(true);
    expect(
      await readFile(join(destDir, "a", "b", "c", "deep.md"), "utf-8"),
    ).toBe("content of a/b/c/deep.md");
  });
});

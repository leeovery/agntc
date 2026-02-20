import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdir,
  writeFile,
  rm,
  mkdtemp,
  access,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nukeManifestFiles } from "../src/nuke-files.js";

let testDir: string;
let projectDir: string;

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "agntc-nuke-test-"));
  projectDir = join(testDir, "project");
  await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("nukeManifestFiles", () => {
  it("removes individual files", async () => {
    const filePath = ".claude/skills/my-skill/SKILL.md";
    await mkdir(join(projectDir, ".claude/skills/my-skill"), {
      recursive: true,
    });
    await writeFile(join(projectDir, filePath), "content");

    const result = await nukeManifestFiles(projectDir, [filePath]);

    expect(await fileExists(join(projectDir, filePath))).toBe(false);
    expect(result.removed).toEqual([filePath]);
    expect(result.skipped).toEqual([]);
  });

  it("removes directories recursively", async () => {
    const dirPath = ".claude/skills/my-skill/";
    await mkdir(join(projectDir, ".claude/skills/my-skill"), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, ".claude/skills/my-skill/SKILL.md"),
      "content",
    );
    await mkdir(join(projectDir, ".claude/skills/my-skill/references"), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, ".claude/skills/my-skill/references/guide.md"),
      "guide",
    );

    const result = await nukeManifestFiles(projectDir, [dirPath]);

    expect(
      await fileExists(join(projectDir, ".claude/skills/my-skill")),
    ).toBe(false);
    expect(result.removed).toEqual([dirPath]);
    expect(result.skipped).toEqual([]);
  });

  it("skips ENOENT silently", async () => {
    const missingFile = ".claude/skills/gone/SKILL.md";

    const result = await nukeManifestFiles(projectDir, [missingFile]);

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([missingFile]);
  });

  it("returns removed and skipped lists", async () => {
    const existingFile = ".claude/skills/my-skill/SKILL.md";
    const missingFile = ".claude/skills/gone/SKILL.md";
    await mkdir(join(projectDir, ".claude/skills/my-skill"), {
      recursive: true,
    });
    await writeFile(join(projectDir, existingFile), "content");

    const result = await nukeManifestFiles(projectDir, [
      existingFile,
      missingFile,
    ]);

    expect(result.removed).toEqual([existingFile]);
    expect(result.skipped).toEqual([missingFile]);
  });

  it("propagates EACCES", async () => {
    const dirPath = ".claude/skills/locked/";
    const lockedDir = join(projectDir, ".claude/skills/locked");
    await mkdir(lockedDir, { recursive: true });
    await writeFile(join(lockedDir, "SKILL.md"), "content");

    // Lock the parent directory to prevent deletion
    const parentDir = join(projectDir, ".claude/skills");
    await chmod(parentDir, 0o444);

    try {
      await expect(
        nukeManifestFiles(projectDir, [dirPath]),
      ).rejects.toMatchObject({ code: "EACCES" });
    } finally {
      await chmod(parentDir, 0o755);
    }
  });

  it("empty files array is no-op", async () => {
    const result = await nukeManifestFiles(projectDir, []);

    expect(result.removed).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  it("handles mix of existing and missing entries", async () => {
    const existingDir = ".claude/skills/skill-a/";
    const existingFile = ".claude/agents/reviewer/agent.md";
    const missingDir = ".codex/skills/skill-b/";
    const missingFile = ".claude/skills/gone.md";

    await mkdir(join(projectDir, ".claude/skills/skill-a"), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, ".claude/skills/skill-a/SKILL.md"),
      "content",
    );
    await mkdir(join(projectDir, ".claude/agents/reviewer"), {
      recursive: true,
    });
    await writeFile(
      join(projectDir, ".claude/agents/reviewer/agent.md"),
      "content",
    );

    const result = await nukeManifestFiles(projectDir, [
      existingDir,
      existingFile,
      missingDir,
      missingFile,
    ]);

    expect(result.removed).toEqual([existingDir, existingFile]);
    expect(result.skipped).toEqual([missingDir, missingFile]);
    expect(
      await fileExists(join(projectDir, ".claude/skills/skill-a")),
    ).toBe(false);
    expect(
      await fileExists(
        join(projectDir, ".claude/agents/reviewer/agent.md"),
      ),
    ).toBe(false);
  });
});

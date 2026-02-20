import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { checkUnmanagedConflicts } from "../src/unmanaged-check.js";
import type { Manifest } from "../src/manifest.js";

let projectDir: string;

beforeEach(async () => {
  projectDir = await mkdtemp(join(tmpdir(), "unmanaged-check-"));
});

afterEach(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("checkUnmanagedConflicts", () => {
  it("returns empty when no files exist on disk", async () => {
    const result = await checkUnmanagedConflicts(
      [".claude/skills/my-skill/", ".claude/agents/executor.md"],
      {},
      projectDir,
    );

    expect(result).toEqual([]);
  });

  it("returns empty when all existing files are manifest-tracked", async () => {
    // Create files on disk
    await mkdir(join(projectDir, ".claude/skills/my-skill"), {
      recursive: true,
    });

    const manifest: Manifest = {
      "owner/repo-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/my-skill/"],
      },
    };

    const result = await checkUnmanagedConflicts(
      [".claude/skills/my-skill/"],
      manifest,
      projectDir,
    );

    expect(result).toEqual([]);
  });

  it("detects unmanaged skill directory", async () => {
    await mkdir(join(projectDir, ".claude/skills/my-skill"), {
      recursive: true,
    });

    const result = await checkUnmanagedConflicts(
      [".claude/skills/my-skill/"],
      {},
      projectDir,
    );

    expect(result).toEqual([".claude/skills/my-skill/"]);
  });

  it("detects unmanaged agent file", async () => {
    await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
    await writeFile(
      join(projectDir, ".claude/agents/executor.md"),
      "# Agent",
    );

    const result = await checkUnmanagedConflicts(
      [".claude/agents/executor.md"],
      {},
      projectDir,
    );

    expect(result).toEqual([".claude/agents/executor.md"]);
  });

  it("detects unmanaged hook file", async () => {
    await mkdir(join(projectDir, ".claude/hooks"), { recursive: true });
    await writeFile(
      join(projectDir, ".claude/hooks/pre-commit.sh"),
      "#!/bin/bash",
    );

    const result = await checkUnmanagedConflicts(
      [".claude/hooks/pre-commit.sh"],
      {},
      projectDir,
    );

    expect(result).toEqual([".claude/hooks/pre-commit.sh"]);
  });

  it("detects empty directory as conflict", async () => {
    // Empty dir still counts as a conflict
    await mkdir(join(projectDir, ".claude/skills/empty-skill"), {
      recursive: true,
    });

    const result = await checkUnmanagedConflicts(
      [".claude/skills/empty-skill/"],
      {},
      projectDir,
    );

    expect(result).toEqual([".claude/skills/empty-skill/"]);
  });

  it("detects mixed asset-level conflicts", async () => {
    await mkdir(join(projectDir, ".claude/skills/planning"), {
      recursive: true,
    });
    await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
    await writeFile(
      join(projectDir, ".claude/agents/executor.md"),
      "# Agent",
    );
    await mkdir(join(projectDir, ".claude/hooks"), { recursive: true });
    await writeFile(
      join(projectDir, ".claude/hooks/pre-commit.sh"),
      "#!/bin/bash",
    );

    const result = await checkUnmanagedConflicts(
      [
        ".claude/skills/planning/",
        ".claude/agents/executor.md",
        ".claude/hooks/pre-commit.sh",
      ],
      {},
      projectDir,
    );

    expect(result).toEqual([
      ".claude/skills/planning/",
      ".claude/agents/executor.md",
      ".claude/hooks/pre-commit.sh",
    ]);
  });

  it("excludes files tracked by any manifest entry", async () => {
    // skill-a is tracked by repo-a, skill-b is unmanaged
    await mkdir(join(projectDir, ".claude/skills/skill-a"), {
      recursive: true,
    });
    await mkdir(join(projectDir, ".claude/skills/skill-b"), {
      recursive: true,
    });

    const manifest: Manifest = {
      "owner/repo-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill-a/"],
      },
    };

    const result = await checkUnmanagedConflicts(
      [".claude/skills/skill-a/", ".claude/skills/skill-b/"],
      manifest,
      projectDir,
    );

    expect(result).toEqual([".claude/skills/skill-b/"]);
  });

  it("collects tracked files from all manifest entries", async () => {
    await mkdir(join(projectDir, ".claude/skills/skill-a"), {
      recursive: true,
    });
    await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
    await writeFile(
      join(projectDir, ".claude/agents/executor.md"),
      "# Agent",
    );

    const manifest: Manifest = {
      "owner/repo-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill-a/"],
      },
      "owner/repo-b": {
        ref: null,
        commit: "def456",
        installedAt: "2026-01-16T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/agents/executor.md"],
      },
    };

    const result = await checkUnmanagedConflicts(
      [".claude/skills/skill-a/", ".claude/agents/executor.md"],
      manifest,
      projectDir,
    );

    expect(result).toEqual([]);
  });

  it("returns empty when incoming files list is empty", async () => {
    const result = await checkUnmanagedConflicts([], {}, projectDir);

    expect(result).toEqual([]);
  });

  it("only reports files that exist on disk AND are untracked", async () => {
    // skill-a exists on disk, untracked -> conflict
    // skill-b does NOT exist on disk -> no conflict
    // agent exists on disk, tracked -> no conflict
    await mkdir(join(projectDir, ".claude/skills/skill-a"), {
      recursive: true,
    });
    await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
    await writeFile(
      join(projectDir, ".claude/agents/executor.md"),
      "# Agent",
    );

    const manifest: Manifest = {
      "owner/repo-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/agents/executor.md"],
      },
    };

    const result = await checkUnmanagedConflicts(
      [
        ".claude/skills/skill-a/",
        ".claude/skills/skill-b/",
        ".claude/agents/executor.md",
      ],
      manifest,
      projectDir,
    );

    expect(result).toEqual([".claude/skills/skill-a/"]);
  });
});

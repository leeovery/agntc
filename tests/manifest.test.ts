import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdir,
  writeFile,
  readFile,
  rm,
  mkdtemp,
  chmod,
  rename,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readManifest,
  writeManifest,
  addEntry,
  type ManifestEntry,
  type Manifest,
} from "../src/manifest.js";

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), "agntc-manifest-test-"));
});

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true });
});

describe("readManifest", () => {
  it("returns empty object when dir missing", async () => {
    const result = await readManifest(join(testDir, "nonexistent"));
    expect(result).toEqual({});
  });

  it("returns empty object when file missing but dir exists", async () => {
    await mkdir(join(testDir, ".agntc"), { recursive: true });
    const result = await readManifest(testDir);
    expect(result).toEqual({});
  });

  it("parses single entry", async () => {
    const manifest: Manifest = {
      "owner/repo/skill": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill/"],
      },
    };
    await mkdir(join(testDir, ".agntc"), { recursive: true });
    await writeFile(
      join(testDir, ".agntc", "manifest.json"),
      JSON.stringify(manifest),
    );

    const result = await readManifest(testDir);
    expect(result).toEqual(manifest);
  });

  it("parses multiple entries", async () => {
    const manifest: Manifest = {
      "owner/repo/skill-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill-a/"],
      },
      "owner/repo/skill-b": {
        ref: null,
        commit: "def456",
        installedAt: "2026-01-16T10:00:00.000Z",
        agents: ["claude", "codex"],
        files: [".claude/skills/skill-b/", ".codex/skills/skill-b/"],
      },
    };
    await mkdir(join(testDir, ".agntc"), { recursive: true });
    await writeFile(
      join(testDir, ".agntc", "manifest.json"),
      JSON.stringify(manifest),
    );

    const result = await readManifest(testDir);
    expect(result).toEqual(manifest);
  });

  it("propagates permission errors", async () => {
    await mkdir(join(testDir, ".agntc"), { recursive: true });
    const manifestPath = join(testDir, ".agntc", "manifest.json");
    await writeFile(manifestPath, "{}");
    await chmod(manifestPath, 0o000);

    try {
      await expect(readManifest(testDir)).rejects.toThrow();
      await expect(readManifest(testDir)).rejects.toMatchObject({
        code: "EACCES",
      });
    } finally {
      await chmod(manifestPath, 0o644);
    }
  });

  it("throws on invalid JSON", async () => {
    await mkdir(join(testDir, ".agntc"), { recursive: true });
    await writeFile(join(testDir, ".agntc", "manifest.json"), "{bad json}");

    await expect(readManifest(testDir)).rejects.toThrow();
  });
});

describe("writeManifest", () => {
  it("creates dir and file when missing", async () => {
    const manifest: Manifest = {
      "owner/repo/skill": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill/"],
      },
    };

    await writeManifest(testDir, manifest);

    const content = await readFile(
      join(testDir, ".agntc", "manifest.json"),
      "utf-8",
    );
    expect(JSON.parse(content)).toEqual(manifest);
  });

  it("overwrites existing file", async () => {
    const old: Manifest = {
      "owner/repo/old": {
        ref: "main",
        commit: "old123",
        installedAt: "2026-01-01T00:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/old/"],
      },
    };
    const updated: Manifest = {
      "owner/repo/new": {
        ref: "v2",
        commit: "new456",
        installedAt: "2026-02-01T00:00:00.000Z",
        agents: ["codex"],
        files: [".codex/skills/new/"],
      },
    };

    await mkdir(join(testDir, ".agntc"), { recursive: true });
    await writeFile(
      join(testDir, ".agntc", "manifest.json"),
      JSON.stringify(old),
    );

    await writeManifest(testDir, updated);

    const content = await readFile(
      join(testDir, ".agntc", "manifest.json"),
      "utf-8",
    );
    expect(JSON.parse(content)).toEqual(updated);
  });

  it("formats with 2-space indent and trailing newline", async () => {
    const manifest: Manifest = {
      "owner/repo/skill": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill/"],
      },
    };

    await writeManifest(testDir, manifest);

    const content = await readFile(
      join(testDir, ".agntc", "manifest.json"),
      "utf-8",
    );
    const expected = JSON.stringify(manifest, null, 2) + "\n";
    expect(content).toBe(expected);
  });

  it("uses atomic write (no partial writes)", async () => {
    const manifest: Manifest = {
      "owner/repo/skill": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill/"],
      },
    };

    await writeManifest(testDir, manifest);

    // Verify the manifest.json exists and is valid
    const content = await readFile(
      join(testDir, ".agntc", "manifest.json"),
      "utf-8",
    );
    expect(JSON.parse(content)).toEqual(manifest);

    // Verify no temp files remain in .agntc/
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(join(testDir, ".agntc"));
    expect(files).toEqual(["manifest.json"]);
  });
});

describe("addEntry", () => {
  it("adds to empty manifest", () => {
    const entry: ManifestEntry = {
      ref: "main",
      commit: "abc123",
      installedAt: "2026-01-15T10:00:00.000Z",
      agents: ["claude"],
      files: [".claude/skills/skill/"],
    };

    const result = addEntry({}, "owner/repo/skill", entry);
    expect(result).toEqual({ "owner/repo/skill": entry });
  });

  it("preserves existing entries", () => {
    const existing: Manifest = {
      "owner/repo/skill-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill-a/"],
      },
    };
    const newEntry: ManifestEntry = {
      ref: "v2",
      commit: "def456",
      installedAt: "2026-01-16T10:00:00.000Z",
      agents: ["codex"],
      files: [".codex/skills/skill-b/"],
    };

    const result = addEntry(existing, "owner/repo/skill-b", newEntry);
    expect(result).toEqual({
      "owner/repo/skill-a": existing["owner/repo/skill-a"],
      "owner/repo/skill-b": newEntry,
    });
  });

  it("overwrites same key (reinstall)", () => {
    const original: ManifestEntry = {
      ref: "main",
      commit: "old123",
      installedAt: "2026-01-15T10:00:00.000Z",
      agents: ["claude"],
      files: [".claude/skills/skill/"],
    };
    const updated: ManifestEntry = {
      ref: "v2",
      commit: "new456",
      installedAt: "2026-02-01T00:00:00.000Z",
      agents: ["claude", "codex"],
      files: [".claude/skills/skill/", ".codex/skills/skill/"],
    };
    const manifest: Manifest = { "owner/repo/skill": original };

    const result = addEntry(manifest, "owner/repo/skill", updated);
    expect(result["owner/repo/skill"]).toEqual(updated);
  });

  it("does not mutate input", () => {
    const original: Manifest = {
      "owner/repo/skill-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill-a/"],
      },
    };
    const originalCopy = JSON.parse(JSON.stringify(original)) as Manifest;
    const newEntry: ManifestEntry = {
      ref: "v2",
      commit: "def456",
      installedAt: "2026-01-16T10:00:00.000Z",
      agents: ["codex"],
      files: [".codex/skills/skill-b/"],
    };

    const result = addEntry(original, "owner/repo/skill-b", newEntry);

    expect(original).toEqual(originalCopy);
    expect(result).not.toBe(original);
  });
});

describe("round-trip", () => {
  it("write then read returns same data", async () => {
    const manifest: Manifest = {
      "owner/repo/skill-a": {
        ref: "main",
        commit: "abc123",
        installedAt: "2026-01-15T10:00:00.000Z",
        agents: ["claude"],
        files: [".claude/skills/skill-a/"],
      },
      "owner/repo/skill-b": {
        ref: null,
        commit: "def456",
        installedAt: "2026-01-16T10:00:00.000Z",
        agents: ["claude", "codex"],
        files: [".claude/skills/skill-b/", ".codex/skills/skill-b/"],
      },
    };

    await writeManifest(testDir, manifest);
    const result = await readManifest(testDir);
    expect(result).toEqual(manifest);
  });
});

describe("ManifestEntry fields", () => {
  it("stores null ref for HEAD, string commit, ISO timestamp, agent array, file array", () => {
    const entry: ManifestEntry = {
      ref: null,
      commit: "abc123def456",
      installedAt: "2026-01-15T10:00:00.000Z",
      agents: ["claude", "codex"],
      files: [".claude/skills/skill/", ".codex/skills/skill/"],
    };

    expect(entry.ref).toBeNull();
    expect(typeof entry.commit).toBe("string");
    expect(entry.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Array.isArray(entry.agents)).toBe(true);
    expect(Array.isArray(entry.files)).toBe(true);
  });
});

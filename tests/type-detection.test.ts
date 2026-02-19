import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectType, ASSET_DIRS } from "../src/type-detection.js";

let testDir: string;

async function createDir(...segments: string[]): Promise<void> {
  await mkdir(join(testDir, ...segments), { recursive: true });
}

async function createFile(...segments: string[]): Promise<void> {
  const filePath = join(testDir, ...segments);
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, "");
}

describe("ASSET_DIRS", () => {
  it("contains skills, agents, and hooks", () => {
    expect(ASSET_DIRS).toEqual(["skills", "agents", "hooks"]);
  });
});

describe("detectType", () => {
  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "agntc-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  describe("bare-skill", () => {
    it("returns bare-skill when hasConfig=true and SKILL.md exists with no asset dirs", async () => {
      await createFile("SKILL.md");

      const result = await detectType(testDir, { hasConfig: true });

      expect(result).toEqual({ type: "bare-skill" });
    });

    it("returns bare-skill with non-asset dirs alongside SKILL.md", async () => {
      await createFile("SKILL.md");
      await createDir("references");
      await createDir("examples");

      const result = await detectType(testDir, { hasConfig: true });

      expect(result).toEqual({ type: "bare-skill" });
    });
  });

  describe("plugin", () => {
    it("returns plugin with skills dir", async () => {
      await createDir("skills");

      const result = await detectType(testDir, { hasConfig: true });

      expect(result).toEqual({ type: "plugin", assetDirs: ["skills"] });
    });

    it("returns plugin with agents dir", async () => {
      await createDir("agents");

      const result = await detectType(testDir, { hasConfig: true });

      expect(result).toEqual({ type: "plugin", assetDirs: ["agents"] });
    });

    it("returns plugin with hooks dir", async () => {
      await createDir("hooks");

      const result = await detectType(testDir, { hasConfig: true });

      expect(result).toEqual({ type: "plugin", assetDirs: ["hooks"] });
    });

    it("returns plugin with all three asset dirs", async () => {
      await createDir("skills");
      await createDir("agents");
      await createDir("hooks");

      const result = await detectType(testDir, { hasConfig: true });

      expect(result).toEqual({
        type: "plugin",
        assetDirs: ["skills", "agents", "hooks"],
      });
    });

    it("warns when SKILL.md coexists with asset dirs", async () => {
      await createFile("SKILL.md");
      await createDir("skills");
      const onWarn = vi.fn();

      const result = await detectType(testDir, { hasConfig: true, onWarn });

      expect(result.type).toBe("plugin");
      expect(onWarn).toHaveBeenCalledOnce();
      expect(onWarn).toHaveBeenCalledWith(
        expect.stringContaining("SKILL.md"),
      );
    });
  });

  describe("not-agntc (with config)", () => {
    it("returns not-agntc with warning when config but no SKILL.md or asset dirs", async () => {
      const onWarn = vi.fn();

      const result = await detectType(testDir, { hasConfig: true, onWarn });

      expect(result).toEqual({ type: "not-agntc" });
      expect(onWarn).toHaveBeenCalledOnce();
    });
  });

  describe("collection", () => {
    it("returns collection with multiple subdirs having agntc.json", async () => {
      await createFile("plugin-a/agntc.json");
      await createFile("plugin-b/agntc.json");

      const result = await detectType(testDir, { hasConfig: false });

      expect(result.type).toBe("collection");
      if (result.type === "collection") {
        expect(result.plugins.sort()).toEqual(["plugin-a", "plugin-b"]);
      }
    });

    it("skips subdirs without agntc.json", async () => {
      await createFile("plugin-a/agntc.json");
      await createDir("not-a-plugin");

      const result = await detectType(testDir, { hasConfig: false });

      expect(result.type).toBe("collection");
      if (result.type === "collection") {
        expect(result.plugins).toEqual(["plugin-a"]);
      }
    });

    it("scan checks immediate subdirs only — not recursive", async () => {
      await createFile("sub/nested/agntc.json");

      const result = await detectType(testDir, { hasConfig: false });

      expect(result).toEqual({ type: "not-agntc" });
    });

    it("scan ignores files (only checks directories)", async () => {
      await createFile("some-file.txt");

      const result = await detectType(testDir, { hasConfig: false });

      expect(result).toEqual({ type: "not-agntc" });
    });
  });

  describe("not-agntc (no config)", () => {
    it("returns not-agntc when no config and no subdirs have config", async () => {
      await createDir("random-dir");

      const result = await detectType(testDir, { hasConfig: false });

      expect(result).toEqual({ type: "not-agntc" });
    });

    it("returns not-agntc for empty directory", async () => {
      const result = await detectType(testDir, { hasConfig: false });

      expect(result).toEqual({ type: "not-agntc" });
    });
  });
});

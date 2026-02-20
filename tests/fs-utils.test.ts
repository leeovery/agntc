import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readDirEntries } from "../src/fs-utils.js";
import type { DirEntry } from "../src/fs-utils.js";

describe("readDirEntries", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), "fs-utils-test-"));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("returns empty array for non-existent directory", async () => {
    const result = await readDirEntries(join(testDir, "does-not-exist"));

    expect(result).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const dir = join(testDir, "empty");
    await mkdir(dir);

    const result = await readDirEntries(dir);

    expect(result).toEqual([]);
  });

  it("correctly maps file entries with name and isDirectory false", async () => {
    await writeFile(join(testDir, "file.txt"), "content");

    const result = await readDirEntries(testDir);

    expect(result).toEqual(
      expect.arrayContaining([
        { name: "file.txt", isDirectory: false },
      ]),
    );
  });

  it("correctly maps directory entries with name and isDirectory true", async () => {
    await mkdir(join(testDir, "subdir"));

    const result = await readDirEntries(testDir);

    expect(result).toEqual(
      expect.arrayContaining([
        { name: "subdir", isDirectory: true },
      ]),
    );
  });

  it("maps mixed files and directories", async () => {
    await writeFile(join(testDir, "readme.md"), "# Hello");
    await mkdir(join(testDir, "src"));
    await writeFile(join(testDir, "config.json"), "{}");
    await mkdir(join(testDir, "tests"));

    const result = await readDirEntries(testDir);
    const sorted = [...result].sort((a, b) => a.name.localeCompare(b.name));

    expect(sorted).toEqual([
      { name: "config.json", isDirectory: false },
      { name: "readme.md", isDirectory: false },
      { name: "src", isDirectory: true },
      { name: "tests", isDirectory: true },
    ]);
  });
});

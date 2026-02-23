import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DirEntry } from "../src/fs-utils.js";
import { readDirEntries, validateLocalSourcePath } from "../src/fs-utils.js";

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
			expect.arrayContaining([{ name: "file.txt", isDirectory: false }]),
		);
	});

	it("correctly maps directory entries with name and isDirectory true", async () => {
		await mkdir(join(testDir, "subdir"));

		const result = await readDirEntries(testDir);

		expect(result).toEqual(
			expect.arrayContaining([{ name: "subdir", isDirectory: true }]),
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

describe("validateLocalSourcePath", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "fs-utils-validate-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("returns valid:true for existing directories", async () => {
		const dir = join(testDir, "my-plugin");
		await mkdir(dir);

		const result = await validateLocalSourcePath(dir);

		expect(result).toEqual({ valid: true });
	});

	it("returns valid:false with reason for non-existent paths", async () => {
		const result = await validateLocalSourcePath(
			join(testDir, "does-not-exist"),
		);

		expect(result).toEqual({
			valid: false,
			reason: "path does not exist",
		});
	});

	it("returns valid:false with reason for file paths (not directories)", async () => {
		const filePath = join(testDir, "some-file.txt");
		await writeFile(filePath, "content");

		const result = await validateLocalSourcePath(filePath);

		expect(result).toEqual({
			valid: false,
			reason: "path is not a directory",
		});
	});
});

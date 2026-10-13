import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { relativePosix, validateLocalSourcePath } from "../src/fs-utils.js";

describe("relativePosix", () => {
	it("is the path between two folders, joined with /", () => {
		expect(relativePosix("/src/repo", "/src/repo/skills/go")).toBe("skills/go");
	});

	it("is empty for the folder itself", () => {
		expect(relativePosix("/src/repo", "/src/repo")).toBe("");
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

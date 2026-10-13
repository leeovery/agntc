import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeScaffold } from "../../src/init/scaffold-utils.js";

describe("writeScaffold", () => {
	let testDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "scaffold-utils-test-"));
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	it("writes each file, creating the folders on its path", async () => {
		const result = await writeScaffold(testDir, [
			{ path: "top.md", content: "top" },
			{ path: "a/b/deep.md", content: "deep" },
		]);

		expect(await readFile(join(testDir, "top.md"), "utf-8")).toBe("top");
		expect(await readFile(join(testDir, "a", "b", "deep.md"), "utf-8")).toBe(
			"deep",
		);
		expect(result).toEqual({
			created: ["top.md", "a/b/deep.md"],
			skipped: [],
		});
	});

	it("leaves a file that already exists untouched and reports it skipped", async () => {
		await writeFile(join(testDir, "top.md"), "mine");

		const result = await writeScaffold(testDir, [
			{ path: "top.md", content: "theirs" },
			{ path: "other.md", content: "other" },
		]);

		expect(await readFile(join(testDir, "top.md"), "utf-8")).toBe("mine");
		expect(result).toEqual({ created: ["other.md"], skipped: ["top.md"] });
	});

	it("writes a file with the mode it asks for", async () => {
		await writeScaffold(testDir, [
			{ path: "run.sh", content: "exit 0\n", mode: 0o755 },
		]);

		expect((await stat(join(testDir, "run.sh"))).mode & 0o111).toBe(0o111);
	});
});

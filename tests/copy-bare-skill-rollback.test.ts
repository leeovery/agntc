import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyBareSkill } from "../src/copy-bare-skill.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, copyFile: vi.fn(actual.copyFile) };
});
vi.mock("../src/copy-rollback.js");

import { rollbackCopiedFiles } from "../src/copy-rollback.js";

const actualFs =
	await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const mockedCopyFile = vi.mocked(fs.copyFile);
const mockedRollback = vi.mocked(rollbackCopiedFiles);

let base: string;
let sourceDir: string;
let projectDir: string;

beforeEach(async () => {
	vi.clearAllMocks();
	mockedCopyFile.mockImplementation(actualFs.copyFile);
	mockedRollback.mockResolvedValue(undefined);
	base = await actualFs.mkdtemp(join(tmpdir(), "agntc-copy-skill-rollback-"));
	sourceDir = join(base, "my-skill");
	projectDir = join(base, "project");
	for (const path of ["SKILL.md", "references/guide.md"]) {
		await actualFs.mkdir(dirname(join(sourceDir, path)), { recursive: true });
		await actualFs.writeFile(join(sourceDir, path), "");
	}
});

afterEach(async () => {
	await actualFs.rm(base, { recursive: true, force: true });
});

function copy() {
	return copyBareSkill({
		sourceDir,
		source: { root: sourceDir, local: false },
		projectDir,
	});
}

describe("copyBareSkill rollback", () => {
	it("rolls back the partly copied skill folder, then rethrows the copy's error", async () => {
		const error = new Error("disk full");
		mockedCopyFile.mockRejectedValueOnce(error);

		const thrown = await copy().catch((e) => e);

		expect(thrown).toBe(error);
		expect(mockedRollback).toHaveBeenCalledExactlyOnceWith(
			[".claude/skills/my-skill/"],
			projectDir,
		);
	});

	it("does not roll back on success", async () => {
		await copy();

		expect(mockedRollback).not.toHaveBeenCalled();
	});
});

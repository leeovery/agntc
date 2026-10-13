import * as fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyBareSkill } from "../src/copy-bare-skill.js";

vi.mock("node:fs/promises");
vi.mock("../src/copy-rollback.js");

const mockedFs = vi.mocked(fs);

import { rollbackCopiedFiles } from "../src/copy-rollback.js";

const mockedRollback = vi.mocked(rollbackCopiedFiles);

describe("copyBareSkill rollback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFs.mkdir.mockResolvedValue(undefined);
		mockedFs.cp.mockResolvedValue(undefined);
		mockedFs.access.mockRejectedValue(new Error("ENOENT")); // agntc.json doesn't exist
		mockedFs.rm.mockResolvedValue(undefined);
		mockedRollback.mockResolvedValue(undefined);
	});

	it("rolls back the partially-copied skill dir when cp fails", async () => {
		mockedFs.cp.mockRejectedValueOnce(new Error("disk full"));

		await expect(
			copyBareSkill({
				sourceDir: "/source/my-skill",
				projectDir: "/project",
			}),
		).rejects.toThrow("disk full");

		expect(mockedRollback).toHaveBeenCalledOnce();
		expect(mockedRollback).toHaveBeenCalledWith(
			[".claude/skills/my-skill/"],
			"/project",
		);
	});

	it("re-throws the original error after rollback", async () => {
		const originalError = new Error("copy failed");
		mockedFs.cp.mockRejectedValueOnce(originalError);

		const thrownError = await copyBareSkill({
			sourceDir: "/source/my-skill",
			projectDir: "/project",
		}).catch((e) => e);

		expect(thrownError).toBe(originalError);
	});

	it("does not call rollback on success", async () => {
		await copyBareSkill({
			sourceDir: "/source/my-skill",
			projectDir: "/project",
		});

		expect(mockedRollback).not.toHaveBeenCalled();
	});
});

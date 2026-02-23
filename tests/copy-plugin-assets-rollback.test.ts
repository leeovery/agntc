import * as fs from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import type { AgentDriver } from "../src/drivers/types.js";

vi.mock("node:fs/promises");
vi.mock("../src/copy-rollback.js");

const mockedFs = vi.mocked(fs);

import { rollbackCopiedFiles } from "../src/copy-rollback.js";

const mockedRollback = vi.mocked(rollbackCopiedFiles);

function makeDriver(targets: Record<string, string | null>): AgentDriver {
	return {
		detect: async () => true,
		getTargetDir: (assetType: string) => targets[assetType] ?? null,
	};
}

function makeDirent(name: string, isDir: boolean) {
	return {
		name,
		isDirectory: () => isDir,
		isFile: () => !isDir,
		isBlockDevice: () => false,
		isCharacterDevice: () => false,
		isFIFO: () => false,
		isSocket: () => false,
		isSymbolicLink: () => false,
		parentPath: "",
		path: "",
	} as fs.Dirent;
}

describe("copyPluginAssets rollback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockedFs.mkdir.mockResolvedValue(undefined);
		mockedFs.cp.mockResolvedValue(undefined);
		mockedFs.readdir.mockResolvedValue([]);
		mockedRollback.mockResolvedValue(undefined);
	});

	it("rolls back copied files when cp fails midway", async () => {
		const copyError = new Error("disk full");

		// First readdir: returns a file entry for the first asset dir
		mockedFs.readdir
			.mockResolvedValueOnce([makeDirent("file1.md", false)] as never)
			// Second readdir: returns a file entry for the second asset dir
			.mockResolvedValueOnce([makeDirent("file2.md", false)] as never);

		// First cp succeeds, second cp fails
		mockedFs.cp
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(copyError);

		await expect(
			copyPluginAssets({
				sourceDir: "/source/my-plugin",
				assetDirs: ["skills", "hooks"],
				agents: [
					{
						id: "claude",
						driver: makeDriver({
							skills: ".claude/skills",
							hooks: ".claude/hooks",
						}),
					},
				],
				projectDir: "/project",
			}),
		).rejects.toThrow("disk full");

		expect(mockedRollback).toHaveBeenCalledOnce();
		// The first file was successfully copied before the error
		const rolledBackFiles = mockedRollback.mock.calls[0]![0];
		expect(rolledBackFiles).toContain(".claude/skills/file1.md");
	});

	it("re-throws the original error after rollback", async () => {
		const originalError = new Error("copy failed");

		mockedFs.readdir.mockResolvedValueOnce([
			makeDirent("file1.md", false),
		] as never);
		mockedFs.cp.mockRejectedValueOnce(originalError);

		const thrownError = await copyPluginAssets({
			sourceDir: "/source/my-plugin",
			assetDirs: ["skills"],
			agents: [
				{
					id: "claude",
					driver: makeDriver({ skills: ".claude/skills" }),
				},
			],
			projectDir: "/project",
		}).catch((e) => e);

		expect(thrownError).toBe(originalError);
	});

	it("does not call rollback on success", async () => {
		mockedFs.readdir.mockResolvedValueOnce([
			makeDirent("file1.md", false),
		] as never);

		await copyPluginAssets({
			sourceDir: "/source/my-plugin",
			assetDirs: ["skills"],
			agents: [
				{
					id: "claude",
					driver: makeDriver({ skills: ".claude/skills" }),
				},
			],
			projectDir: "/project",
		});

		expect(mockedRollback).not.toHaveBeenCalled();
	});

	it("passes projectDir to rollback", async () => {
		mockedFs.readdir.mockResolvedValueOnce([
			makeDirent("file1.md", false),
		] as never);
		mockedFs.cp.mockRejectedValueOnce(new Error("fail"));

		await copyPluginAssets({
			sourceDir: "/source/my-plugin",
			assetDirs: ["skills"],
			agents: [
				{
					id: "claude",
					driver: makeDriver({ skills: ".claude/skills" }),
				},
			],
			projectDir: "/my-project",
		}).catch(() => {});

		expect(mockedRollback).toHaveBeenCalledWith(
			expect.any(Array),
			"/my-project",
		);
	});
});

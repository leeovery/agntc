import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/nuke-files.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/nuke-files.js")>();
	return { ...actual, removeInstallPath: vi.fn(actual.removeInstallPath) };
});

import { rollbackCopiedFiles } from "../src/copy-rollback.js";
import { removeInstallPath } from "../src/nuke-files.js";

const mockedRemove = vi.mocked(removeInstallPath);

let base: string;
let projectDir: string;

beforeEach(async () => {
	vi.clearAllMocks();
	base = await mkdtemp(join(tmpdir(), "agntc-rollback-"));
	projectDir = join(base, "project");
	await mkdir(join(projectDir, ".claude/skills/my-skill"), { recursive: true });
	await writeFile(join(projectDir, ".claude/skills/my-skill/SKILL.md"), "");
	await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
	await writeFile(join(projectDir, ".claude/agents/reviewer.md"), "");
});

afterEach(async () => {
	await rm(base, { recursive: true, force: true });
});

async function exists(relPath: string): Promise<boolean> {
	return access(join(projectDir, relPath)).then(
		() => true,
		() => false,
	);
}

describe("rollbackCopiedFiles", () => {
	it("deletes each path in the list through the link-safe delete", async () => {
		await rollbackCopiedFiles(
			[".claude/skills/my-skill/", ".claude/agents/reviewer.md"],
			projectDir,
		);

		expect(mockedRemove.mock.calls).toEqual([
			[projectDir, ".claude/skills/my-skill/"],
			[projectDir, ".claude/agents/reviewer.md"],
		]);
		expect(await exists(".claude/skills/my-skill")).toBe(false);
		expect(await exists(".claude/agents/reviewer.md")).toBe(false);
	});

	it("unlinks a link at a path without touching what it points to", async () => {
		const mine = join(base, "mine");
		await mkdir(mine);
		await writeFile(join(mine, "SKILL.md"), "mine");
		await symlink(mine, join(projectDir, ".claude/skills/linked"));

		await rollbackCopiedFiles([".claude/skills/linked/"], projectDir);

		expect(
			await lstat(join(projectDir, ".claude/skills/linked")).catch(() => null),
		).toBeNull();
		expect(await readFile(join(mine, "SKILL.md"), "utf-8")).toBe("mine");
	});

	it("handles an empty list and paths already gone without error", async () => {
		await expect(rollbackCopiedFiles([], projectDir)).resolves.toBeUndefined();
		await expect(
			rollbackCopiedFiles([".claude/skills/never-copied/"], projectDir),
		).resolves.toBeUndefined();
	});

	it("continues deleting remaining paths when one fails", async () => {
		mockedRemove.mockRejectedValueOnce(new Error("permission denied"));

		await rollbackCopiedFiles(
			[".claude/agents/reviewer.md", ".claude/skills/my-skill/"],
			projectDir,
		);

		expect(mockedRemove).toHaveBeenCalledTimes(2);
		expect(await exists(".claude/agents/reviewer.md")).toBe(true);
		expect(await exists(".claude/skills/my-skill")).toBe(false);
	});

	it("calls onWarn for a failed delete", async () => {
		mockedRemove.mockRejectedValueOnce(new Error("permission denied"));
		const onWarn = vi.fn();

		await rollbackCopiedFiles(["fail-file"], projectDir, onWarn);

		expect(onWarn).toHaveBeenCalledOnce();
		expect(onWarn).toHaveBeenCalledWith(
			"Rollback: failed to delete fail-file: permission denied",
		);
	});

	it("calls onWarn with stringified error for non-Error throws", async () => {
		mockedRemove.mockRejectedValueOnce("string-error");
		const onWarn = vi.fn();

		await rollbackCopiedFiles(["fail-file"], projectDir, onWarn);

		expect(onWarn).toHaveBeenCalledWith(
			"Rollback: failed to delete fail-file: string-error",
		);
	});

	it("swallows a failed delete when no callback is provided", async () => {
		mockedRemove.mockRejectedValueOnce(new Error("some error"));

		await expect(
			rollbackCopiedFiles(["fail-file"], projectDir),
		).resolves.toBeUndefined();
	});
});

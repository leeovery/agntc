import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyPack } from "../src/copy-pack.js";
import type { FoundPack } from "../src/discover.js";

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
let root: string;
let projectDir: string;

beforeEach(async () => {
	vi.clearAllMocks();
	mockedCopyFile.mockImplementation(actualFs.copyFile);
	mockedRollback.mockResolvedValue(undefined);
	base = await actualFs.mkdtemp(join(tmpdir(), "agntc-copy-pack-rollback-"));
	root = join(base, "source");
	projectDir = join(base, "project");
	await tree({
		"p/skills/a/SKILL.md": "",
		"p/skills/b/SKILL.md": "",
		"p/skills/c/SKILL.md": "",
		"p/agents/x.md": "",
		"p/agents/y.md": "",
		"p/hooks/one.sh": "",
		"p/hooks/two.sh": "",
	});
});

afterEach(async () => {
	await actualFs.rm(base, { recursive: true, force: true });
});

async function tree(spec: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(spec)) {
		const full = join(root, path);
		await actualFs.mkdir(dirname(full), { recursive: true });
		await actualFs.writeFile(full, content);
	}
}

const PACK: FoundPack = {
	name: "p",
	path: "p",
	skills: ["a", "b", "c"].map((name) => ({ name, path: `p/skills/${name}` })),
	assetDirs: ["agents", "hooks"],
};

/** Fails the `nth` file copy whose project-relative destination matches `pattern`. */
function failCopy(pattern: RegExp, error: Error, nth = 1): void {
	let seen = 0;
	mockedCopyFile.mockImplementation(async (source, dest, mode) => {
		if (pattern.test(relative(projectDir, String(dest))) && ++seen === nth) {
			throw error;
		}
		return actualFs.copyFile(source, dest, mode);
	});
}

function copiedTo(pattern: RegExp): string[] {
	return mockedCopyFile.mock.calls
		.map(([, dest]) => relative(projectDir, String(dest)))
		.filter((dest) => pattern.test(dest));
}

describe("copyPack rollback", () => {
	it("rolls back the skills copied before one fails, then rethrows", async () => {
		const error = new Error("disk full");
		failCopy(/^\.claude\/skills\/b\//, error);

		const thrown = await copyPack(PACK, root, projectDir).catch((e) => e);

		expect(thrown).toBe(error);
		expect(mockedRollback).toHaveBeenCalledTimes(2);
		expect(mockedRollback).toHaveBeenNthCalledWith(
			1,
			[".claude/skills/b/"],
			projectDir,
		);
		expect(mockedRollback).toHaveBeenNthCalledWith(
			2,
			[".claude/skills/a/"],
			projectDir,
		);
		expect(copiedTo(/^\.claude\/skills\/c\//)).toEqual([]);
	});

	it("rolls back every skill and the agents copied so far when an agent fails, then rethrows", async () => {
		const error = new Error("disk full");
		failCopy(/^\.claude\/agents\/y\.md$/, error);

		const thrown = await copyPack(PACK, root, projectDir).catch((e) => e);

		expect(thrown).toBe(error);
		expect(mockedRollback).toHaveBeenCalledOnce();
		expect(mockedRollback).toHaveBeenCalledWith(
			[
				".claude/skills/a/",
				".claude/skills/b/",
				".claude/skills/c/",
				".claude/agents/x.md",
				".claude/agents/y.md",
			],
			projectDir,
		);
		expect(copiedTo(/^\.claude\/hooks\//)).toEqual([]);
	});

	it("rolls back the skills, agents and hooks copied so far when a hook fails, then rethrows", async () => {
		const error = new Error("disk full");
		failCopy(/^\.claude\/hooks\//, error, 2);

		const thrown = await copyPack(PACK, root, projectDir).catch((e) => e);

		expect(thrown).toBe(error);
		const hooks = copiedTo(/^\.claude\/hooks\//);
		expect([...hooks].sort()).toEqual([
			".claude/hooks/one.sh",
			".claude/hooks/two.sh",
		]);
		expect(mockedRollback).toHaveBeenCalledOnce();
		expect(mockedRollback).toHaveBeenCalledWith(
			[
				".claude/skills/a/",
				".claude/skills/b/",
				".claude/skills/c/",
				".claude/agents/x.md",
				".claude/agents/y.md",
				...hooks,
			],
			projectDir,
		);
	});

	it("rolls back a hook folder by everything its copy planned, written or not", async () => {
		await tree({ "p/hooks/lint/a.sh": "", "p/hooks/lint/b.sh": "" });
		const error = new Error("disk full");
		failCopy(/^\.claude\/hooks\/lint\/b\.sh$/, error);

		const thrown = await copyPack(PACK, root, projectDir).catch((e) => e);

		expect(thrown).toBe(error);
		const [[recorded]] = mockedRollback.mock.calls as [[string[]]];
		expect(recorded.filter((path) => path.includes("lint"))).toEqual([
			".claude/hooks/lint/",
			".claude/hooks/lint/a.sh",
			".claude/hooks/lint/b.sh",
		]);
	});

	it("does not roll back when everything copies", async () => {
		await copyPack(PACK, root, projectDir);

		expect(mockedRollback).not.toHaveBeenCalled();
	});
});

import {
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCommand } from "../../src/commands/add.js";
import { updateCommand } from "../../src/commands/update.js";
import { readManifest, writeManifest } from "../../src/manifest.js";
import { runMachine } from "../helpers/machine.js";

let testDir: string;
let projectDir: string;
/** A local source whose skill `foo` links to a sibling folder. */
let source: string;

beforeEach(async () => {
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-local-root-")));
	projectDir = join(testDir, "project");
	source = join(testDir, "source");
	await mkdir(projectDir, { recursive: true });
	await write(source, {
		"foo/SKILL.md": "foo v1",
		"common/guide.md": "shared guide",
	});
	await symlink("../common", join(source, "foo/shared"));
	vi.spyOn(process, "cwd").mockReturnValue(projectDir);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

async function write(base: string, files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		const full = join(base, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content);
	}
}

const FOO = () => join(source, "foo");

async function installedFoo(): Promise<string> {
	return readFile(join(projectDir, ".claude/skills/foo/SKILL.md"), "utf-8");
}

describe("a local add records the folder it was added from", () => {
	it("on every entry it writes", async () => {
		await runMachine(addCommand, [source]);

		expect((await readManifest(projectDir))[FOO()]).toMatchObject({
			localRoot: source,
		});
	});
});

describe("a skill linking to a sibling folder in its local source", () => {
	it("adds, as the link stays inside the source", async () => {
		const run = await runMachine(addCommand, [source]);

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			expect.objectContaining({ key: FOO(), status: "installed" }),
		]);
	});

	it.each([
		["all-mode", () => []],
		["one key", () => [FOO()]],
	])("updates in %s, against the same boundary add used", async (_mode, args) => {
		await runMachine(addCommand, [source]);
		await write(source, { "foo/SKILL.md": "foo v2" });

		const run = await runMachine(updateCommand, args());

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			expect.objectContaining({ key: FOO(), status: "refreshed" }),
		]);
		expect(await installedFoo()).toBe("foo v2");
	});

	it("still blocks an update once a link leads outside the source", async () => {
		await runMachine(addCommand, [source]);
		await symlink(join(testDir, "elsewhere"), join(source, "foo/escape"));

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({ key: FOO(), status: "blocked" }),
		]);
		expect(await installedFoo()).toBe("foo v1");
	});

	it("blocks an update of an entry from before the root was recorded, as before", async () => {
		await runMachine(addCommand, [source]);
		const manifest = await readManifest(projectDir);
		for (const entry of Object.values(manifest)) {
			delete entry.localRoot;
		}
		await writeManifest(projectDir, manifest);

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({ key: FOO(), status: "blocked" }),
		]);
	});
});

describe("a local source whose folder was renamed", () => {
	it.each([
		["all-mode", () => []],
		["one key", () => [FOO()]],
	])("fails its update in %s, naming the folder that's gone", async (_mode, args) => {
		await runMachine(addCommand, [source]);
		await rename(source, `${source}-moved`);

		const run = await runMachine(updateCommand, args());

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: FOO(),
				status: "failed",
				message: `${FOO()}: Failed — ${source}: path does not exist`,
			}),
		]);
	});
});

describe("a local skill that moved within its source", () => {
	it("is followed and recorded relative to the recorded root", async () => {
		await runMachine(addCommand, [source]);
		await rm(join(source, "foo"), { recursive: true });
		await write(source, { "skills/foo/SKILL.md": "foo moved" });

		const moved = await runMachine(updateCommand, []);
		await write(source, { "skills/foo/SKILL.md": "foo moved again" });
		const again = await runMachine(updateCommand, []);

		expect(moved.exitCode).toBe(0);
		expect((await readManifest(projectDir))[FOO()]).toMatchObject({
			localRoot: source,
			sourceSubpath: "skills/foo",
		});
		expect(again.exitCode).toBe(0);
		expect(await installedFoo()).toBe("foo moved again");
	});
});

describe("what counts as the same local source", () => {
	/** A local source holding the pack `tools`, whose skill `api` was installed on its own. */
	beforeEach(async () => {
		await write(source, {
			"tools/agntc.json": JSON.stringify({ type: "pack" }),
			"tools/skills/api/SKILL.md": "api",
		});
		await runMachine(addCommand, [source, "--skill", "api"]);
	});

	it("is the folder added from: a pack added from it takes over the loose skill", async () => {
		const run = await runMachine(addCommand, [source, "--all"]);

		expect(run.exitCode).toBe(0);
		expect(Object.keys(await readManifest(projectDir)).sort()).toEqual(
			[FOO(), join(source, "tools")].sort(),
		);
	});

	it("isn't a checkout inside it: a pack added from there finds the loose skill in its way", async () => {
		const tools = join(source, "tools");

		const run = await runMachine(addCommand, [tools]);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: tools,
				status: "skipped",
				reason: `files in the way belong to ${join(source, "api")}: .claude/skills/api/`,
				flags: ["--overwrite"],
			}),
		]);
		expect(Object.keys(await readManifest(projectDir))).toEqual([
			join(source, "api"),
		]);
	});

	it("isn't an unrelated folder: a pack added from one finds the loose skill in its way", async () => {
		const elsewhere = join(testDir, "elsewhere");
		await write(elsewhere, {
			"agntc.json": JSON.stringify({ type: "pack" }),
			"skills/api/SKILL.md": "another api",
		});

		const run = await runMachine(addCommand, [elsewhere]);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: elsewhere,
				status: "skipped",
				reason: `files in the way belong to ${join(source, "api")}: .claude/skills/api/`,
			}),
		]);
	});
});

import {
	access,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { processIo } from "../../src/command-action.js";
import { addCommand, runAdd } from "../../src/commands/add.js";
import { listCommand, runListLoop } from "../../src/commands/list.js";
import { removeCommand, runRemove } from "../../src/commands/remove.js";
import { runUpdate, updateCommand } from "../../src/commands/update.js";
import { readManifest } from "../../src/manifest.js";
import { globalScope } from "../../src/scope.js";
import { runMachine } from "../helpers/machine.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

let testDir: string;
let home: string;
let projectDir: string;
/** A local source holding one skill, `foo`. */
let globalSource: string;
/** A local source holding one skill, `bar`. */
let projectSource: string;
let ui: TestUi;

beforeEach(async () => {
	vi.clearAllMocks();
	ui = testUi();
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-global-")));
	home = join(testDir, "home");
	projectDir = join(testDir, "project");
	globalSource = join(testDir, "global-source");
	projectSource = join(testDir, "project-source");
	await mkdir(home, { recursive: true });
	await mkdir(projectDir, { recursive: true });
	await write(globalSource, { "foo/SKILL.md": "foo v1" });
	await write(projectSource, { "bar/SKILL.md": "bar v1" });
	vi.spyOn(process, "cwd").mockReturnValue(projectDir);
	vi.spyOn(processIo, "homedir").mockReturnValue(home);
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

async function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}

const FOO = () => join(globalSource, "foo");
const BAR = () => join(projectSource, "bar");

/** One skill installed in each scope. */
async function installBoth(): Promise<void> {
	await runMachine(addCommand, [globalSource, "-g"]);
	await runMachine(addCommand, [projectSource]);
}

describe("add -g", () => {
	it("installs under the home directory and records it in the home manifest, leaving the project alone", async () => {
		const run = await runMachine(addCommand, [globalSource, "-g"]);

		expect(run.exitCode).toBe(0);
		expect(run.document).toMatchObject({
			ok: true,
			command: "add",
			scope: "global",
		});
		expect(
			await readFile(join(home, ".claude/skills/foo/SKILL.md"), "utf-8"),
		).toBe("foo v1");
		expect(Object.keys(await readManifest(home))).toEqual([FOO()]);
		expect(await readdir(projectDir)).toEqual([]);
	});

	it("says project in the document of an add without it", async () => {
		const run = await runMachine(addCommand, [projectSource]);

		expect(run.document.scope).toBe("project");
		expect(Object.keys(await readManifest(projectDir))).toEqual([BAR()]);
		expect(await readdir(home)).toEqual([]);
	});

	it("carries -g in the --pack line it suggests for agents it won't install", async () => {
		await write(globalSource, { "agents/helper.md": "helper" });

		const run = await runMachine(addCommand, [globalSource, "-g"]);

		expect(run.document.warnings).toEqual([
			expect.stringContaining(
				`to install them as a pack: npx agntc add -g ${globalSource} --pack`,
			),
		]);
	});
});

describe("list -g", () => {
	it("shows only global entries, and list only project ones", async () => {
		await installBoth();

		const global = await runMachine(listCommand, ["-g"]);
		const project = await runMachine(listCommand, []);

		expect(global.document).toMatchObject({ scope: "global" });
		expect(global.document.entries).toEqual([
			expect.objectContaining({ key: FOO() }),
		]);
		expect(project.document).toMatchObject({ scope: "project" });
		expect(project.document.entries).toEqual([
			expect.objectContaining({ key: BAR() }),
		]);
	});
});

describe("update -g", () => {
	it("updates only global entries, and update only project ones", async () => {
		await installBoth();
		await write(globalSource, { "foo/SKILL.md": "foo v2" });
		await write(projectSource, { "bar/SKILL.md": "bar v2" });

		const global = await runMachine(updateCommand, ["-g"]);

		expect(global.document).toMatchObject({ ok: true, scope: "global" });
		expect(global.document.items).toEqual([
			expect.objectContaining({ key: FOO(), status: "refreshed" }),
		]);
		expect(
			await readFile(join(home, ".claude/skills/foo/SKILL.md"), "utf-8"),
		).toBe("foo v2");
		expect(
			await readFile(join(projectDir, ".claude/skills/bar/SKILL.md"), "utf-8"),
		).toBe("bar v1");

		const project = await runMachine(updateCommand, []);

		expect(project.document).toMatchObject({ ok: true, scope: "project" });
		expect(project.document.items).toEqual([
			expect.objectContaining({ key: BAR(), status: "refreshed" }),
		]);
		expect(
			await readFile(join(projectDir, ".claude/skills/bar/SKILL.md"), "utf-8"),
		).toBe("bar v2");
	});

	it("doesn't find a project entry by its key", async () => {
		await installBoth();

		const run = await runMachine(updateCommand, [BAR(), "-g"]);

		expect(run.exitCode).toBe(1);
		expect(run.document).toMatchObject({
			ok: false,
			scope: "global",
			error: { message: `${BAR()} is not installed.` },
		});
	});

	it("names the global update that removes an entry gone upstream", async () => {
		await installBoth();
		await rm(FOO(), { recursive: true });

		const run = await runMachine(updateCommand, ["-g"]);

		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: FOO(),
				status: "gone-kept",
				message: `Kept ${FOO()} — it's gone upstream; npx agntc update -g ${FOO()} -y removes it`,
			}),
		]);
	});

	it("carries -g on both commands of the remedy for an update stopped by files in the way", async () => {
		const pack = join(testDir, "tools");
		await write(pack, {
			"agntc.json": JSON.stringify({ type: "pack" }),
			"skills/lint/SKILL.md": "lint",
		});
		await runMachine(addCommand, [pack, "-g"]);
		await write(pack, { "skills/format/SKILL.md": "format" });
		await write(home, { ".claude/skills/format/SKILL.md": "someone else's" });

		const run = await runMachine(updateCommand, ["-g"]);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: pack,
				status: "aborted",
				message: expect.stringContaining(
					`replace them: npx agntc remove -g ${pack} then npx agntc add -g ${pack} --pack --overwrite`,
				),
			}),
		]);
	});
});

describe("remove -g", () => {
	it("removes a global entry from home, leaving the project's", async () => {
		await installBoth();

		const run = await runMachine(removeCommand, [FOO(), "-g", "-y"]);

		expect(run.document).toMatchObject({
			ok: true,
			scope: "global",
			removed: [expect.objectContaining({ key: FOO() })],
		});
		expect(await exists(join(home, ".claude/skills/foo"))).toBe(false);
		expect(await readManifest(home)).toEqual({});
		expect(Object.keys(await readManifest(projectDir))).toEqual([BAR()]);
		expect(await exists(join(projectDir, ".claude/skills/bar"))).toBe(true);
	});

	it("doesn't find a project entry by its key, nor remove finds a global one", async () => {
		await installBoth();

		const global = await runMachine(removeCommand, [BAR(), "-g", "-y"]);
		const project = await runMachine(removeCommand, [FOO(), "-y"]);

		expect(global.exitCode).toBe(1);
		expect(global.document.error).toEqual({
			message: `${BAR()} is not installed.`,
		});
		expect(project.exitCode).toBe(1);
		expect(project.document.error).toEqual({
			message: `${FOO()} is not installed.`,
		});
		expect(await exists(join(home, ".claude/skills/foo"))).toBe(true);
		expect(await exists(join(projectDir, ".claude/skills/bar"))).toBe(true);
	});

	it("names the global remove command when it needs a key", async () => {
		await installBoth();

		const run = await runMachine(removeCommand, ["-g"]);

		expect(run.document).toMatchObject({
			ok: false,
			scope: "global",
			error: {
				message:
					"remove needs the key of what to remove without a terminal: npx agntc remove -g <key>",
				flags: ["<key>"],
			},
		});
	});
});

describe("at a terminal", () => {
	const scope = () => globalScope(home);

	it("titles each command as global", async () => {
		await runAdd(globalSource, {}, ui, scope());
		await runUpdate(FOO(), {}, ui, scope());
		await runRemove(FOO(), { yes: true }, ui, scope());
		await runListLoop(ui, scope());

		expect(ui.intro.mock.calls).toEqual([
			["agntc add · global"],
			["agntc update · global"],
			["agntc remove · global"],
			["agntc list · global"],
		]);
	});

	it("points an empty global list at add -g", async () => {
		await runListLoop(ui, scope());

		expect(ui.outro).toHaveBeenCalledWith(
			"No skills or packs installed. Run npx agntc add -g owner/repo to get started.",
		);
	});
});

describe("skills in ~/.claude/skills agntc didn't install", () => {
	/** Kit's own copy of a skill, which `~/.claude/skills/foo` links to. */
	let kit: string;
	const FOO_TARGET = ".claude/skills/foo";

	beforeEach(async () => {
		kit = join(testDir, "kit/skills/foo");
		await write(kit, { "SKILL.md": "kit's", "references/guide.md": "kit's" });
		await mkdir(join(home, ".claude/skills"), { recursive: true });
		await symlink(kit, join(home, FOO_TARGET));
	});

	async function expectKitUntouched(): Promise<void> {
		expect((await readdir(kit)).sort()).toEqual(["SKILL.md", "references"]);
		expect(await readFile(join(kit, "SKILL.md"), "utf-8")).toBe("kit's");
		expect(await readFile(join(kit, "references/guide.md"), "utf-8")).toBe(
			"kit's",
		);
	}

	it("stop that item on add -g without --overwrite, leaving the link and its target", async () => {
		const run = await runMachine(addCommand, [globalSource, "-g"]);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: FOO(),
				status: "skipped",
				reason: `files in the way weren't installed by agntc: ${FOO_TARGET}/`,
				flags: ["--overwrite"],
			}),
		]);
		expect((await lstat(join(home, FOO_TARGET))).isSymbolicLink()).toBe(true);
		expect(await readManifest(home)).toEqual({});
		await expectKitUntouched();
	});

	it("are unlinked as links by add -g --overwrite, which installs a real folder and leaves the target", async () => {
		const run = await runMachine(addCommand, [
			globalSource,
			"-g",
			"--overwrite",
		]);

		expect(run.exitCode).toBe(0);
		expect((await lstat(join(home, FOO_TARGET))).isSymbolicLink()).toBe(false);
		expect(await readFile(join(home, FOO_TARGET, "SKILL.md"), "utf-8")).toBe(
			"foo v1",
		);
		await expectKitUntouched();
	});
});

describe("a linked ~/.claude/skills", () => {
	it("still installs, through the shared folder's link", async () => {
		const dotfiles = join(testDir, "dotfiles/skills");
		await mkdir(dotfiles, { recursive: true });
		await mkdir(join(home, ".claude"), { recursive: true });
		await symlink(dotfiles, join(home, ".claude/skills"));

		const run = await runMachine(addCommand, [globalSource, "-g"]);

		expect(run.exitCode).toBe(0);
		expect(await readFile(join(dotfiles, "foo/SKILL.md"), "utf-8")).toBe(
			"foo v1",
		);
	});
});

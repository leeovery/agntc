import {
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-clone.js")>()),
	cloneSource: vi.fn(),
}));

vi.mock("../../src/git-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-utils.js")>()),
	execGit: vi.fn(async () => ({ stdout: "", stderr: "" })),
	fetchRemoteTags: vi.fn(async () => []),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/update-check.js")>()),
	resolveGroupTarget: vi.fn(),
}));

import { type AddOptions, runAdd } from "../../src/commands/add.js";
import { runUpdate } from "../../src/commands/update.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { cloneSource } from "../../src/git-clone.js";
import { readManifest } from "../../src/manifest.js";
import { type CommandName, MachineUi } from "../../src/ui.js";
import { resolveGroupTarget } from "../../src/update-check.js";

const PACK = JSON.stringify({ type: "pack" });

let testDir: string;
let projectDir: string;
/** The upstream repo, which each clone copies with its links as written. */
let upstream: string;
/** How many times upstream was published; its commit follows. */
let pushes: number;

beforeEach(async () => {
	testDir = await realpath(
		await mkdtemp(join(tmpdir(), "agntc-source-links-")),
	);
	projectDir = join(testDir, "project");
	upstream = join(testDir, "upstream");
	pushes = 0;
	await mkdir(projectDir, { recursive: true });
	vi.spyOn(process, "cwd").mockReturnValue(projectDir);
	vi.mocked(cloneSource).mockImplementation(async () => {
		const tempDir = await mkdtemp(join(testDir, "clone-"));
		await cp(upstream, tempDir, { recursive: true, verbatimSymlinks: true });
		return { tempDir, commit: head() };
	});
	vi.mocked(resolveGroupTarget).mockImplementation(async () => ({
		kind: "head",
		resolvedSha: head(),
	}));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

function head(): string {
	return String(pushes).repeat(40);
}

async function write(base: string, files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		const full = join(base, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content);
	}
}

/** Links each path below `base` to its target, written as given. */
async function link(base: string, links: Record<string, string>) {
	for (const [path, target] of Object.entries(links)) {
		const full = join(base, path);
		await mkdir(dirname(full), { recursive: true });
		await symlink(target, full);
	}
}

/** Replaces upstream with `files` and `links`, as a new commit. */
async function publish(
	files: Record<string, string>,
	links: Record<string, string> = {},
): Promise<void> {
	await rm(upstream, { recursive: true, force: true });
	await mkdir(upstream, { recursive: true });
	await write(upstream, files);
	await link(upstream, links);
	pushes += 1;
}

async function installedText(path: string): Promise<string> {
	return readFile(join(projectDir, path), "utf-8");
}

/** Runs a command without a terminal; resolves to its document and exit code. */
async function run(
	command: CommandName,
	action: (ui: MachineUi) => Promise<void>,
) {
	const ui = new MachineUi(command, "project");
	let exitCode = 0;
	try {
		await action(ui);
	} catch (err) {
		if (!(err instanceof ExitSignal)) {
			throw err;
		}
		exitCode = err.code;
	}
	return { exitCode, document: ui.document(exitCode) };
}

function add(source: string, options: AddOptions = {}) {
	return run("add", (ui) => runAdd(source, options, ui));
}

function update() {
	return run("update", (ui) => runUpdate(undefined, {}, ui));
}

describe("an update whose recorded path upstream now runs through a symlink", () => {
	/** A folder outside the clone holding a skill named foo. */
	let outside: string;

	beforeEach(async () => {
		outside = join(testDir, "outside");
		await write(outside, { "foo/SKILL.md": "outside" });
	});

	async function addFoo(): Promise<void> {
		await publish({ "skills/foo/SKILL.md": "v1" });
		expect((await add("owner/repo")).exitCode).toBe(0);
	}

	async function expectBlockedOn(key: string, link: string): Promise<void> {
		const before = await readManifest(projectDir);

		const { exitCode, document } = await update();

		expect(exitCode).toBe(1);
		expect(document.items).toEqual([
			expect.objectContaining({
				key,
				status: "blocked",
				message: expect.stringContaining(`symlink "${link}" is on the path`),
			}),
		]);
		expect(await readManifest(projectDir)).toEqual(before);
	}

	it("blocks a skill below a folder linked outside the clone, leaving it installed", async () => {
		await addFoo();
		await publish({}, { skills: outside });

		await expectBlockedOn("owner/repo/foo", "skills");
		expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v1");
	});

	it("blocks a skill whose own folder is now a link inside the clone, leaving it installed", async () => {
		await addFoo();
		await publish(
			{ "other/foo/SKILL.md": "v2" },
			{ "skills/foo": "../other/foo" },
		);

		await expectBlockedOn("owner/repo/foo", "skills/foo");
		expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v1");
	});

	it("blocks a pack whose folder is now a link, never taking it for gone", async () => {
		await publish({
			"tools/agntc.json": PACK,
			"tools/skills/api/SKILL.md": "v1",
		});
		await add("owner/repo/tools");
		await publish(
			{
				"real-tools/agntc.json": PACK,
				"real-tools/skills/api/SKILL.md": "v2",
			},
			{ tools: "real-tools" },
		);

		await expectBlockedOn("owner/repo/tools", "tools");
		expect(await installedText(".claude/skills/api/SKILL.md")).toBe("v1");
	});

	it("follows a moved skill to its real folder, never to one behind a link", async () => {
		await addFoo();
		await publish({ "moved/foo/SKILL.md": "v2" }, { linked: outside });

		const { exitCode, document } = await update();

		expect(exitCode).toBe(0);
		expect(document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/foo", status: "updated" }),
		]);
		expect((await readManifest(projectDir))["owner/repo/foo"]).toMatchObject({
			sourceSubpath: "moved/foo",
		});
		expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v2");
	});

	it("is gone when the only skill of its name lies behind a link", async () => {
		await addFoo();
		await publish({ "README.md": "" }, { linked: outside });

		const { exitCode, document } = await update();

		expect(exitCode).toBe(0);
		expect(document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/foo", status: "gone-kept" }),
		]);
		expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v1");
	});
});

describe("a local source reached through a symlink", () => {
	/** Where the source really is, and the link the user adds it by. */
	let real: string;
	let linked: string;

	beforeEach(() => {
		real = join(testDir, "code", "foo");
		linked = join(testDir, "skills", "foo");
	});

	it("adds a linked skill folder as the folder it links to, then updates it", async () => {
		await write(real, { "SKILL.md": "v1" });
		await link(testDir, { "skills/foo": real });

		const added = await add(linked);
		await write(real, { "SKILL.md": "v2" });
		const updated = await update();

		expect(added.exitCode).toBe(0);
		expect(added.document.items).toEqual([
			expect.objectContaining({ key: real, status: "installed" }),
		]);
		expect((await readManifest(projectDir))[real]).toMatchObject({
			localRoot: real,
		});
		expect(updated.exitCode).toBe(0);
		expect(updated.document.items).toEqual([
			expect.objectContaining({ key: real, status: "refreshed" }),
		]);
		expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v2");
	});

	it("adds every skill of a linked repo folder with --all, keyed by the real folder", async () => {
		await write(real, {
			"skills/a/SKILL.md": "a",
			"skills/b/SKILL.md": "b",
		});
		await link(testDir, { "skills/foo": real });

		const { exitCode } = await add(linked, { all: true });

		expect(exitCode).toBe(0);
		const manifest = await readManifest(projectDir);
		expect(Object.keys(manifest).sort()).toEqual([
			join(real, "a"),
			join(real, "b"),
		]);
		expect(manifest[join(real, "a")]).toMatchObject({ localRoot: real });
		expect(await installedText(".claude/skills/b/SKILL.md")).toBe("b");
	});
});

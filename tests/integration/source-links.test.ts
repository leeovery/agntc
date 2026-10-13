import {
	cp,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
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
import { runRemove } from "../../src/commands/remove.js";
import { runUpdate } from "../../src/commands/update.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { cloneSource } from "../../src/git-clone.js";
import {
	type ManifestEntry,
	readManifest,
	writeManifest,
} from "../../src/manifest.js";
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

describe("symlinks in what a source installs", () => {
	/** The temp clones left behind: every command removes its own. */
	async function clonesLeft(): Promise<string[]> {
		return (await readdir(testDir)).filter((name) => name.startsWith("clone-"));
	}

	async function linkInstalled(path: string): Promise<boolean> {
		return lstat(join(projectDir, path)).then(
			() => true,
			() => false,
		);
	}

	const LINTED_PACK = {
		"tools/agntc.json": PACK,
		"tools/skills/api/SKILL.md": "api",
		"tools/hooks/pre.sh": "pre",
		"scripts/lint/run.sh": "lint",
	};
	const LINT_LINK = { "tools/hooks/lint": "../../scripts/lint" };
	const LINTED_PACK_FILES = [".claude/skills/api/", ".claude/hooks/pre.sh"];

	it("installs a remote skill whose internal links read once the clone is gone, leaving out a link to the repo above it, on add and update", async () => {
		const files = {
			"skills/foo/SKILL.md": "foo",
			"skills/foo/ref/a.md": "a",
		};
		const links = {
			"skills/foo/link.md": "ref/a.md",
			"skills/foo/repo": "../..",
		};
		await publish(files, links);

		const added = await add("owner/repo");
		const afterAdd = await linkInstalled(".claude/skills/foo/repo");
		await publish(files, links);
		const updated = await update();

		expect([added.exitCode, updated.exitCode]).toEqual([0, 0]);
		expect(updated.document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/foo", status: "updated" }),
		]);
		expect(await clonesLeft()).toEqual([]);
		expect(await readlink(join(projectDir, ".claude/skills/foo/link.md"))).toBe(
			"ref/a.md",
		);
		expect(await installedText(".claude/skills/foo/link.md")).toBe("a");
		expect(afterAdd).toBe(false);
		expect(await linkInstalled(".claude/skills/foo/repo")).toBe(false);
	});

	describe("a remote link to a folder elsewhere in the repo", () => {
		function remove(key: string) {
			return run("remove", (ui) => runRemove(key, { yes: true }, ui));
		}

		async function isRealFolder(path: string): Promise<boolean> {
			return (await lstat(join(projectDir, path))).isDirectory();
		}

		it("installs a skill's shared folder as real files, refreshes them on update and removes them with the skill", async () => {
			const shared = (guide: string) => ({
				"skills/foo/SKILL.md": "foo",
				"shared/references/guide.md": guide,
			});
			const links = { "skills/foo/references": "../../shared/references" };
			await publish(shared("v1"), links);

			const added = await add("owner/repo");
			const guideAfterAdd = await installedText(
				".claude/skills/foo/references/guide.md",
			);
			const filesAfterAdd = (await readManifest(projectDir))["owner/repo/foo"]
				?.files;
			const realAfterAdd = await isRealFolder(".claude/skills/foo/references");
			await publish(shared("v2"), links);
			const updated = await update();
			const guideAfterUpdate = await installedText(
				".claude/skills/foo/references/guide.md",
			);
			const removed = await remove("owner/repo/foo");

			expect([added.exitCode, updated.exitCode, removed.exitCode]).toEqual([
				0, 0, 0,
			]);
			expect(guideAfterAdd).toBe("v1");
			expect(realAfterAdd).toBe(true);
			expect(filesAfterAdd).toEqual([".claude/skills/foo/"]);
			expect(updated.document.items).toEqual([
				expect.objectContaining({ key: "owner/repo/foo", status: "updated" }),
			]);
			expect(guideAfterUpdate).toBe("v2");
			expect(await linkInstalled(".claude/skills/foo")).toBe(false);
			expect(await readManifest(projectDir)).toEqual({});
			expect(await clonesLeft()).toEqual([]);
		});

		it("records each file a pack's hook folder copies in a link's place, and update and remove replace and remove them", async () => {
			const scripts = (util: string) => ({
				"tools/agntc.json": PACK,
				"tools/skills/api/SKILL.md": "api",
				"tools/hooks/lint/run.sh": "run",
				"scripts/lib/util.sh": util,
			});
			const links = { "tools/hooks/lint/lib": "../../../scripts/lib" };
			await publish(scripts("v1"), links);

			const added = await add("owner/repo/tools");
			const filesAfterAdd = (await readManifest(projectDir))["owner/repo/tools"]
				?.files;
			await publish(scripts("v2"), links);
			const updated = await update();
			const utilAfterUpdate = await installedText(
				".claude/hooks/lint/lib/util.sh",
			);
			const removed = await remove("owner/repo/tools");

			expect([added.exitCode, updated.exitCode, removed.exitCode]).toEqual([
				0, 0, 0,
			]);
			expect(filesAfterAdd).toEqual([
				".claude/skills/api/",
				".claude/hooks/lint/",
				".claude/hooks/lint/lib/",
				".claude/hooks/lint/lib/util.sh",
				".claude/hooks/lint/run.sh",
			]);
			expect(utilAfterUpdate).toBe("v2");
			expect(await linkInstalled(".claude/hooks/lint")).toBe(false);
			expect(await readManifest(projectDir)).toEqual({});
		});

		it("blocks an update, before removing anything, when the folder holds a link out of the clone", async () => {
			const files = {
				"skills/foo/SKILL.md": "v1",
				"shared/guide.md": "guide",
			};
			const links = { "skills/foo/shared": "../../shared" };
			await publish(files, links);
			await add("owner/repo");
			const before = await readManifest(projectDir);
			await publish(
				{ ...files, "skills/foo/SKILL.md": "v2" },
				{ ...links, "shared/leak": join(testDir, "outside") },
			);

			const { exitCode, document } = await update();

			expect(exitCode).toBe(1);
			expect(document.items).toEqual([
				expect.objectContaining({
					key: "owner/repo/foo",
					status: "blocked",
					message: expect.stringContaining(
						'symlink "shared/leak" points outside the clone',
					),
				}),
			]);
			expect(await readManifest(projectDir)).toEqual(before);
			expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v1");
			expect(await installedText(".claude/skills/foo/shared/guide.md")).toBe(
				"guide",
			);
		});
	});

	it("links a local skill's link to a folder beside it absolutely into the source, on add and update", async () => {
		const source = join(testDir, "code", "repo");
		await write(source, {
			"skills/foo/SKILL.md": "v1",
			"shared/guide.md": "guide",
		});
		await link(source, { "skills/foo/shared": "../../shared" });
		const shared = join(projectDir, ".claude/skills/foo/shared");

		const added = await add(source);
		const afterAdd = await readlink(shared).catch(() => null);
		await write(source, { "skills/foo/SKILL.md": "v2" });
		const updated = await update();

		expect([added.exitCode, updated.exitCode]).toEqual([0, 0]);
		expect(updated.document.items).toEqual([
			expect.objectContaining({ status: "refreshed" }),
		]);
		expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v2");
		expect(afterAdd).toBe(join(source, "shared"));
		expect(await readlink(shared)).toBe(join(source, "shared"));
		expect(await installedText(".claude/skills/foo/shared/guide.md")).toBe(
			"guide",
		);
	});

	describe("a link to a folder beside the skill holding a link out of the source", () => {
		const files = {
			"skills/foo/SKILL.md": "v1",
			"shared/guide.md": "guide",
		};
		const links = () => ({
			"skills/foo/shared": "../../shared",
			"shared/leak": join(testDir, "outside"),
		});

		it("adds and updates a local skill, linking the folder absolutely without reading it", async () => {
			const source = join(testDir, "code", "repo");
			await write(source, files);
			await link(source, links());

			const added = await add(source);
			const updated = await update();

			expect([added.exitCode, updated.exitCode]).toEqual([0, 0]);
			expect(added.document.items).toEqual([
				expect.objectContaining({ status: "installed" }),
			]);
			expect(updated.document.items).toEqual([
				expect.objectContaining({ status: "refreshed" }),
			]);
			expect(
				await readlink(join(projectDir, ".claude/skills/foo/shared")),
			).toBe(join(source, "shared"));
		});

		it("refuses to add a remote skill, installing nothing", async () => {
			await publish(files, links());

			const { exitCode, document } = await add("owner/repo");

			expect(exitCode).toBe(1);
			expect(document.items).toEqual([
				expect.objectContaining({
					key: "owner/repo/foo",
					status: "failed",
					reason: expect.stringContaining(
						'symlink "shared/leak" points outside the clone',
					),
				}),
			]);
			expect(await linkInstalled(".claude/skills/foo")).toBe(false);
			expect(await readManifest(projectDir)).toEqual({});
		});
	});

	it("never installs a link at the top of a pack's hooks/, on add or update", async () => {
		await publish(LINTED_PACK, LINT_LINK);
		const added = await add("owner/repo/tools");
		const afterAdd = await linkInstalled(".claude/hooks/lint");
		await publish(
			{ ...LINTED_PACK, "tools/hooks/pre.sh": "pre v2" },
			LINT_LINK,
		);

		const { exitCode, document } = await update();

		expect(added.exitCode).toBe(0);
		expect(afterAdd).toBe(false);
		expect(exitCode).toBe(0);
		expect(document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/tools", status: "updated" }),
		]);
		expect((await readManifest(projectDir))["owner/repo/tools"]?.files).toEqual(
			LINTED_PACK_FILES,
		);
		expect(await installedText(".claude/hooks/pre.sh")).toBe("pre v2");
		expect(await linkInstalled(".claude/hooks/lint")).toBe(false);
		expect(await clonesLeft()).toEqual([]);
	});

	it("updates an entry that recorded its linked hook as a link into the clone, removing the link", async () => {
		await publish(LINTED_PACK, LINT_LINK);
		await add("owner/repo/tools");
		await symlink(
			join(testDir, "clone-gone/scripts/lint"),
			join(projectDir, ".claude/hooks/lint"),
		);
		const { "owner/repo/tools": entry, ...rest } =
			await readManifest(projectDir);
		await writeManifest(projectDir, {
			...rest,
			"owner/repo/tools": {
				...(entry as ManifestEntry),
				files: [...LINTED_PACK_FILES, ".claude/hooks/lint"],
			},
		});
		await publish(LINTED_PACK, LINT_LINK);

		const { exitCode } = await update();

		expect(exitCode).toBe(0);
		expect((await readManifest(projectDir))["owner/repo/tools"]?.files).toEqual(
			LINTED_PACK_FILES,
		);
		expect(await linkInstalled(".claude/hooks/lint")).toBe(false);
	});

	it("blocks an update, before removing anything, when the skill holds a link out of the clone", async () => {
		await publish({ "skills/foo/SKILL.md": "v1" });
		await add("owner/repo");
		await publish(
			{ "skills/foo/SKILL.md": "v2" },
			{ "skills/foo/leak": join(testDir, "outside") },
		);

		const { exitCode, document } = await update();

		expect(exitCode).toBe(1);
		expect(document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/foo", status: "blocked" }),
		]);
		expect(await installedText(".claude/skills/foo/SKILL.md")).toBe("v1");
	});
});

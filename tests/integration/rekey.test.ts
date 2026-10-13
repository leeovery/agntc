import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack({ confirm: vi.fn(), isCancel: vi.fn(() => false) });
});

vi.mock("../../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-clone.js")>()),
	cloneSource: vi.fn(),
}));

vi.mock("../../src/git-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-utils.js")>()),
	execGit: vi.fn(),
	fetchRemoteTagRefs: vi.fn(),
	fetchRemoteTags: vi.fn(),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/update-check.js")>()),
	resolveGroupTarget: vi.fn(),
}));

import * as p from "@clack/prompts";
import { addCommand } from "../../src/commands/add.js";
import { removeCommand } from "../../src/commands/remove.js";
import { runUpdate, updateCommand } from "../../src/commands/update.js";
import { groupReAddCommands, reAddCommand } from "../../src/entry-source.js";
import { cloneSource } from "../../src/git-clone.js";
import {
	execGit,
	fetchRemoteTagRefs,
	fetchRemoteTags,
} from "../../src/git-utils.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { ParsedSource } from "../../src/source-parser.js";
import { resolveGroupTarget } from "../../src/update-check.js";
import { type MachineRun, runMachine } from "../helpers/machine.js";

const mockCloneSource = vi.mocked(cloneSource);
const mockExecGit = vi.mocked(execGit);
const mockFetchRemoteTags = vi.mocked(fetchRemoteTags);
const mockFetchRemoteTagRefs = vi.mocked(fetchRemoteTagRefs);
const mockResolveGroupTarget = vi.mocked(resolveGroupTarget);

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const PACK = { type: "pack" };

let testDir: string;
let projectDir: string;
/** The upstream tree each `owner/repo` clones from. */
let upstream: Map<string, string>;
/** The commit a clone lands on and HEAD resolves to. */
let head: string;

beforeEach(async () => {
	vi.clearAllMocks();
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-rekey-")));
	projectDir = join(testDir, "project");
	await mkdir(projectDir, { recursive: true });
	vi.spyOn(process, "cwd").mockReturnValue(projectDir);
	upstream = new Map();
	head = OLD_SHA;

	mockFetchRemoteTags.mockResolvedValue([]);
	mockCloneSource.mockImplementation(async (parsed: ParsedSource) => {
		if (parsed.type === "local-path") {
			throw new Error("local sources aren't cloned");
		}
		const fixture = upstream.get(`${parsed.owner}/${parsed.repo}`);
		if (fixture === undefined) {
			throw new Error(`no upstream for ${parsed.owner}/${parsed.repo}`);
		}
		const tempDir = await mkdtemp(join(testDir, "clone-"));
		await cp(fixture, tempDir, { recursive: true });
		return { tempDir, commit: head };
	});
	mockResolveGroupTarget.mockImplementation(async () => ({
		kind: "head",
		resolvedSha: head,
	}));
	mockExecGit.mockImplementation(async ([, , ...refs]: string[]) => ({
		stdout: refs.includes("HEAD") ? `${head}\tHEAD` : "",
		stderr: "",
	}));
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

/** Writes an upstream repo; a value that isn't a string is written as JSON. */
async function repo(
	name: string,
	files: Record<string, string | object>,
): Promise<void> {
	const dir = join(testDir, "upstream", name);
	await rm(dir, { recursive: true, force: true });
	await write(dir, files);
	upstream.set(name, dir);
}

async function write(
	base: string,
	files: Record<string, string | object>,
): Promise<void> {
	await mkdir(base, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(base, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(
			full,
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
}

async function installed(path: string): Promise<boolean> {
	return access(join(projectDir, path)).then(
		() => true,
		() => false,
	);
}

async function savedManifest(): Promise<Manifest> {
	const raw = await readFile(
		join(projectDir, ".agntc", "manifest.json"),
		"utf-8",
	);
	return JSON.parse(raw) as Manifest;
}

/** The saved entry at `key`, with its key. */
async function saved(
	key: string,
): Promise<{ key: string; entry: ManifestEntry }> {
	const entry = (await savedManifest())[key];
	if (entry === undefined) {
		throw new Error(`${key} isn't installed`);
	}
	return { key, entry };
}

/** Adds from upstream as it stands, at the old commit. */
async function add(...args: string[]): Promise<void> {
	const run = await runMachine(addCommand, args);
	expect(run.exitCode).toBe(0);
}

/** Moves upstream to the new commit, holding `files`. */
async function push(
	name: string,
	files: Record<string, string | object>,
): Promise<void> {
	await repo(name, files);
	head = NEW_SHA;
}

/**
 * Runs a printed `npx agntc add|remove …` line as a user pasting it would.
 * `answers` are the flags that stand in for what a terminal would ask.
 */
async function runPrinted(
	command: string,
	...answers: string[]
): Promise<MachineRun> {
	const [npx, agntc, verb, ...args] = command.split(" ");
	expect([npx, agntc]).toEqual(["npx", "agntc"]);
	const printed = verb === "remove" ? removeCommand : addCommand;
	expect(printed.name()).toBe(verb);
	return runMachine(printed, [...args, ...answers]);
}

/** Running `command` installs onto the entries it was printed for, under the same keys. */
async function expectLandsOnEntries(
	command: string,
	keys: string[],
): Promise<void> {
	const before = Object.keys(await savedManifest()).sort();

	const run = await runPrinted(command);

	expect(run.exitCode).toBe(0);
	expect(run.document.warnings).toEqual([]);
	expect(run.document.items).toEqual(
		keys.map((key) => expect.objectContaining({ key, status: "installed" })),
	);
	expect(Object.keys(await savedManifest()).sort()).toEqual(before);
}

interface RekeyCase {
	name: string;
	repo: string;
	before: Record<string, string | object>;
	after: Record<string, string | object>;
	added: string;
	oldKey: string;
	newKey: string;
	sourceSubpath: string;
	note: string;
	/** Another skill from the repo, in the same update group. */
	sibling: { add: string; key: string; files: Record<string, string> };
}

const CASES: RekeyCase[] = [
	{
		name: "a pack whose path is now a single skill",
		repo: "owner/repo",
		before: {
			"packs/foo/agntc.json": PACK,
			"packs/foo/skills/a/SKILL.md": "a v1",
		},
		after: { "packs/foo/SKILL.md": "foo v2" },
		added: "owner/repo/packs/foo",
		oldKey: "owner/repo/packs/foo",
		newKey: "owner/repo/foo",
		sourceSubpath: "packs/foo",
		note: "owner/repo/packs/foo is a single skill — reinstalled as a skill, now keyed owner/repo/foo",
		sibling: {
			add: "owner/repo/bar",
			key: "owner/repo/bar",
			files: { "bar/SKILL.md": "bar" },
		},
	},
	{
		name: "a root skill that moved below the root",
		repo: "owner/my-skill",
		before: { "SKILL.md": "v1" },
		after: { "skills/my-skill/SKILL.md": "v2" },
		added: "owner/my-skill",
		oldKey: "owner/my-skill",
		newKey: "owner/my-skill/my-skill",
		sourceSubpath: "skills/my-skill",
		note: "owner/my-skill moved from my-skill to skills/my-skill, now keyed owner/my-skill/my-skill",
		sibling: {
			add: "owner/my-skill/extras/bar",
			key: "owner/my-skill/bar",
			files: { "extras/bar/SKILL.md": "bar" },
		},
	},
];

describe.each(CASES)("update of $name", (c) => {
	async function arrange(withSibling: boolean): Promise<void> {
		const sibling = withSibling ? c.sibling.files : {};
		await repo(c.repo, { ...c.before, ...sibling });
		await add(c.added);
		if (withSibling) {
			await add(c.sibling.add);
		}
		await push(c.repo, { ...c.after, ...sibling });
	}

	async function expectMoved(run: MachineRun): Promise<void> {
		expect(run.exitCode).toBe(0);
		expect(run.document.notes).toEqual([c.note]);
		expect(run.document.items).toContainEqual(
			expect.objectContaining({
				key: c.newKey,
				previousKey: c.oldKey,
				type: "skill",
				status: "updated",
				previousCommit: OLD_SHA,
				commit: NEW_SHA,
			}),
		);
		const manifest = await savedManifest();
		expect(manifest).not.toHaveProperty([c.oldKey]);
		expect(manifest[c.newKey]).toMatchObject({
			type: "skill",
			sourceSubpath: c.sourceSubpath,
			commit: NEW_SHA,
			files: [`.claude/skills/${c.newKey.split("/").pop()}/`],
		});
	}

	it("by key, moves the entry to the key add gives it, and its re-add command lands on it", async () => {
		await arrange(false);

		const run = await runMachine(updateCommand, [c.oldKey]);

		await expectMoved(run);
		expect(Object.keys(await savedManifest())).toEqual([c.newKey]);
		const { key, entry } = await saved(c.newKey);
		await expectLandsOnEntries(reAddCommand(key, entry, "project"), [key]);
	});

	it("in all-mode, moves it beside a sibling of its group, and the group's re-add line lands on both", async () => {
		await arrange(true);

		const run = await runMachine(updateCommand, []);

		await expectMoved(run);
		expect(run.document.items).toContainEqual(
			expect.objectContaining({ key: c.sibling.key, status: "updated" }),
		);
		expect(run.document.items).not.toContainEqual(
			expect.objectContaining({ previousKey: c.sibling.key }),
		);
		expect(Object.keys(await savedManifest()).sort()).toEqual(
			[c.newKey, c.sibling.key].sort(),
		);
		const moved = await saved(c.newKey);
		await expectLandsOnEntries(
			reAddCommand(moved.key, moved.entry, "project"),
			[moved.key],
		);
		const [line = ""] = groupReAddCommands(
			[moved, await saved(c.sibling.key)],
			"project",
		);
		await expectLandsOnEntries(line, [c.sibling.key, c.newKey].sort());
	});
});

describe("update of a pack whose path is now a single skill, by a prefix", () => {
	it("moves the entry beside the other keys under the prefix", async () => {
		const [c] = CASES;
		if (c === undefined) {
			throw new Error("no case");
		}
		await repo(c.repo, { ...c.before, ...c.sibling.files });
		await add(c.added);
		await add(c.sibling.add);
		await push(c.repo, { ...c.after, ...c.sibling.files });

		const run = await runMachine(updateCommand, ["owner/repo"]);

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			expect.objectContaining({ key: c.newKey, previousKey: c.oldKey }),
			expect.objectContaining({ key: c.sibling.key, status: "updated" }),
		]);
		expect(Object.keys(await savedManifest()).sort()).toEqual(
			[c.newKey, c.sibling.key].sort(),
		);
	});
});

describe("the out-of-constraint footer of a run that moves an entry", () => {
	/** A pack at `packs/foo` and a loose skill `bar`, added at v1.0.0, with v1.1.0 and v2.0.0 out since. */
	async function arrange(): Promise<void> {
		mockFetchRemoteTags.mockResolvedValue(["v1.0.0"]);
		await repo("owner/repo", {
			"packs/foo/agntc.json": PACK,
			"packs/foo/skills/a/SKILL.md": "",
			"bar/SKILL.md": "",
		});
		await add("owner/repo/packs/foo");
		await add("owner/repo/bar");
		await push("owner/repo", {
			"packs/foo/SKILL.md": "",
			"bar/SKILL.md": "",
		});
		mockFetchRemoteTagRefs.mockResolvedValue(
			["v1.0.0", "v1.1.0", "v2.0.0"].map((tag) => ({ tag, sha: NEW_SHA })),
		);
		mockResolveGroupTarget.mockResolvedValue({
			kind: "constrained",
			tag: "v1.1.0",
			commit: NEW_SHA,
			latestOverall: "v2.0.0",
		});
	}

	it("in all-mode, prints the group's command with the entry under the key it moved to", async () => {
		await arrange();

		await runUpdate();

		expect(vi.mocked(p.log).info).toHaveBeenCalledWith(
			"  owner/repo  v1.1.0 -> v2.0.0 available. To upgrade: npx agntc add owner/repo --skill bar foo",
		);
	});

	it("by key, prints the command for the key the entry moved to", async () => {
		await arrange();

		await runUpdate("owner/repo/packs/foo");

		expect(vi.mocked(p.outro)).toHaveBeenCalledWith(
			"Updated owner/repo/foo: v1.0.0 -> v1.1.0 — 1 file(s)",
		);
		expect(vi.mocked(p.log).info).toHaveBeenCalledWith(
			"  owner/repo/foo  v1.1.0 -> v2.0.0 available. To upgrade: npx agntc add owner/repo/packs/foo",
		);
	});
});

describe("a key another entry already holds", () => {
	async function arrange(): Promise<void> {
		await repo("owner/repo", {
			"packs/foo/agntc.json": PACK,
			"packs/foo/skills/a/SKILL.md": "a v1",
			"foo/agntc.json": PACK,
			"foo/skills/x/SKILL.md": "x v1",
		});
		await add("owner/repo/packs/foo");
		await add("owner/repo/foo");
		await push("owner/repo", {
			"packs/foo/SKILL.md": "foo v2",
			"foo/agntc.json": PACK,
			"foo/skills/x/SKILL.md": "x v2",
		});
	}

	it("aborts that entry before removing anything, naming both keys and the remedy, and the remedy moves it", async () => {
		await arrange();

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: "owner/repo/packs/foo",
				type: "pack",
				status: "aborted",
				message:
					"owner/repo/packs/foo can't be updated: it would move to owner/repo/foo, which is already installed. The existing install is unchanged. To replace that entry with it: npx agntc remove owner/repo/foo then npx agntc update owner/repo/packs/foo",
			}),
			expect.objectContaining({ key: "owner/repo/foo", status: "updated" }),
		]);
		expect(await installed(".claude/skills/a/SKILL.md")).toBe(true);
		expect(await savedManifest()).toMatchObject({
			"owner/repo/packs/foo": { type: "pack", commit: OLD_SHA },
			"owner/repo/foo": { type: "pack", commit: NEW_SHA },
		});

		await runMachine(removeCommand, ["owner/repo/foo", "-y"]);
		const moved = await runMachine(updateCommand, ["owner/repo/packs/foo"]);

		expect(moved.exitCode).toBe(0);
		expect(Object.keys(await savedManifest())).toEqual(["owner/repo/foo"]);
		expect(await installed(".claude/skills/foo/SKILL.md")).toBe(true);
	});
});

describe("absorption around a moved entry", () => {
	it("a pack updating first takes over a root skill that moved into it, before it would move", async () => {
		await repo("owner/tools", {
			"SKILL.md": "tools v1",
			"bundle/agntc.json": PACK,
			"bundle/skills/y/SKILL.md": "y v1",
		});
		await add("owner/tools");
		await add("owner/tools/bundle");
		await push("owner/tools", {
			"bundle/agntc.json": PACK,
			"bundle/skills/y/SKILL.md": "y v2",
			"bundle/skills/tools/SKILL.md": "tools v2",
		});

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			{
				key: "owner/tools",
				type: "skill",
				ref: null,
				commit: OLD_SHA,
				constraint: null,
				status: "absorbed",
				message: "owner/tools is now part of the pack owner/tools/bundle",
			},
			expect.objectContaining({
				key: "owner/tools/bundle",
				status: "updated",
			}),
		]);
		expect(Object.keys(await savedManifest())).toEqual(["owner/tools/bundle"]);
	});

	it("a pack updating later takes over an entry this run moved, reporting the key it moved from", async () => {
		await repo("owner/repo", {
			"packs/agntc.json": PACK,
			"packs/foo/SKILL.md": "foo v2",
			"packs/skills/z/SKILL.md": "z v2",
		});
		head = NEW_SHA;
		const entry = {
			ref: null,
			commit: OLD_SHA,
			installedAt: "2026-10-01T00:00:00.000Z",
			cloneUrl: "https://github.com/owner/repo.git",
			type: "pack",
		};
		await write(projectDir, {
			".claude/skills/a/SKILL.md": "a v1",
			".claude/skills/z/SKILL.md": "z v1",
			".agntc/manifest.json": {
				"owner/repo/packs/foo": { ...entry, files: [".claude/skills/a/"] },
				"owner/repo/packs": { ...entry, files: [".claude/skills/z/"] },
			},
		});

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: "owner/repo/foo",
				previousKey: "owner/repo/packs/foo",
				status: "absorbed",
				message: "owner/repo/foo is now part of the pack owner/repo/packs",
			}),
			expect.objectContaining({ key: "owner/repo/packs", status: "updated" }),
		]);
		const manifest = await savedManifest();
		expect(Object.keys(manifest)).toEqual(["owner/repo/packs"]);
		expect(manifest).toMatchObject({
			"owner/repo/packs": {
				files: [".claude/skills/foo/", ".claude/skills/z/"],
			},
		});
		expect(await installed(".claude/skills/a")).toBe(false);
	});
});

describe("a pack re-typed as a skill with files in its way", () => {
	it("prints a remedy that, run in order, installs it under its new key", async () => {
		await repo("owner/repo", {
			"packs/foo/agntc.json": PACK,
			"packs/foo/skills/a/SKILL.md": "a v1",
		});
		await add("owner/repo/packs/foo");
		await push("owner/repo", { "packs/foo/SKILL.md": "foo v2" });
		await write(projectDir, { ".claude/skills/foo/SKILL.md": "mine" });

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(1);
		const [item] = run.document.items as Array<{ message: string }>;
		const remedy =
			/replace them: (npx agntc remove .+) then (npx agntc add .+)$/
				.exec(item?.message ?? "")
				?.slice(1);
		expect(remedy).toEqual([
			"npx agntc remove owner/repo/packs/foo",
			"npx agntc add owner/repo/packs/foo --overwrite",
		]);
		expect(await installed(".claude/skills/a/SKILL.md")).toBe(true);

		const [remove = "", reAdd = ""] = remedy ?? [];
		expect((await runPrinted(remove, "-y")).exitCode).toBe(0);
		const added = await runPrinted(reAdd);

		expect(added.exitCode).toBe(0);
		expect(added.document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/foo", status: "installed" }),
		]);
		expect(await savedManifest()).toEqual({
			"owner/repo/foo": expect.objectContaining({
				type: "skill",
				sourceSubpath: "packs/foo",
			}),
		});
		expect(
			await readFile(join(projectDir, ".claude/skills/foo/SKILL.md"), "utf-8"),
		).toBe("foo v2");
	});
});

describe("a local source's printed re-add commands", () => {
	let source: string;

	beforeEach(() => {
		source = join(testDir, "kit");
	});

	async function expectReAddLands(key: string): Promise<void> {
		const { entry } = await saved(key);
		await expectLandsOnEntries(reAddCommand(key, entry, "project"), [key]);
	}

	it("land on a pack re-typed as a skill and moved to its new key", async () => {
		await write(source, {
			"packs/foo/agntc.json": PACK,
			"packs/foo/skills/a/SKILL.md": "a v1",
		});
		await add(source);
		await rm(join(source, "packs/foo"), { recursive: true });
		await write(source, { "packs/foo/SKILL.md": "foo v2" });

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: join(source, "foo"),
				previousKey: join(source, "packs/foo"),
				status: "refreshed",
			}),
		]);
		expect((await savedManifest())[join(source, "foo")]).toMatchObject({
			sourceSubpath: "packs/foo",
			localRoot: source,
		});
		expect(
			reAddCommand(
				join(source, "foo"),
				(await saved(join(source, "foo"))).entry,
				"project",
			),
		).toBe(`npx agntc add ${source} --skill foo`);
		await expectReAddLands(join(source, "foo"));
	});

	it("land on a loose skill added from its root with its path recorded", async () => {
		await write(source, {
			"skills/foo/SKILL.md": "foo",
			"skills/bar/SKILL.md": "bar",
		});
		await add(source, "--skill", "foo");

		await expectReAddLands(join(source, "foo"));
	});

	it("land on a pack added from its root", async () => {
		await write(source, {
			"packs/tools/agntc.json": PACK,
			"packs/tools/skills/a/SKILL.md": "a",
			"skills/bar/SKILL.md": "bar",
		});
		await add(source, "--all");

		await expectReAddLands(join(source, "packs/tools"));
	});
});

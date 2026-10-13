import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CANCEL } = vi.hoisted(() => ({ CANCEL: Symbol("cancel") }));

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack({
		multiselect: vi.fn(),
		isCancel: vi.fn((value: unknown) => value === CANCEL),
	});
});

vi.mock("../../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../../src/git-utils.js", () => ({
	fetchRemoteTags: vi.fn(),
}));

vi.mock("../../src/collision-resolve.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/collision-resolve.js")>()),
	resolveCollisions: vi.fn(),
}));

vi.mock("../../src/unmanaged-resolve.js", () => ({
	resolveUnmanagedConflicts: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/nuke-files.js")>()),
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../../src/copy-item.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/copy-item.js")>()),
	copyItem: vi.fn(),
}));

import * as p from "@clack/prompts";
import { resolveCollisions } from "../../src/collision-resolve.js";
import { addCommand, runAdd } from "../../src/commands/add.js";
import { copyItem } from "../../src/copy-item.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { cleanupTempDir, cloneSource } from "../../src/git-clone.js";
import { fetchRemoteTags } from "../../src/git-utils.js";
import type { EntryType, Manifest, ManifestEntry } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { interactiveUi } from "../../src/ui.js";
import { resolveUnmanagedConflicts } from "../../src/unmanaged-resolve.js";
import { clackCalls, runMachine } from "../helpers/machine.js";

const actualNuke = await vi.importActual<
	typeof import("../../src/nuke-files.js")
>("../../src/nuke-files.js");
const actualCopyItem = await vi.importActual<
	typeof import("../../src/copy-item.js")
>("../../src/copy-item.js");

const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockFetchRemoteTags = vi.mocked(fetchRemoteTags);
const mockResolveCollisions = vi.mocked(resolveCollisions);
const mockResolveUnmanaged = vi.mocked(resolveUnmanagedConflicts);
const mockNuke = vi.mocked(nukeManifestFiles);
const mockCopyItem = vi.mocked(copyItem);
const mockMultiselect = vi.mocked(p.multiselect);
const mockCancel = vi.mocked(p.cancel);
const mockOutro = vi.mocked(p.outro);
const mockLog = vi.mocked(p.log);

const SHA = "c".repeat(40);
const PACK = { type: "pack" };

let testDir: string;
let projectDir: string;
let upstreamDir: string;
let cloneDir: string;

beforeEach(async () => {
	vi.clearAllMocks();
	testDir = await mkdtemp(join(tmpdir(), "agntc-add-"));
	projectDir = join(testDir, "project");
	upstreamDir = join(testDir, "upstream");
	cloneDir = join(testDir, "clone");
	await mkdir(projectDir, { recursive: true });
	await mkdir(upstreamDir, { recursive: true });
	vi.spyOn(process, "cwd").mockReturnValue(projectDir);

	mockFetchRemoteTags.mockResolvedValue([]);
	mockCloneSource.mockImplementation(async () => {
		await cp(upstreamDir, cloneDir, { recursive: true });
		return { tempDir: cloneDir, commit: SHA };
	});
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockNuke.mockImplementation(actualNuke.nukeManifestFiles);
	mockCopyItem.mockImplementation(actualCopyItem.copyItem);
	mockResolveCollisions.mockImplementation(async (_, manifest) => ({
		resolved: true,
		updatedManifest: manifest,
	}));
	mockResolveUnmanaged.mockResolvedValue({ approved: [], cancelled: [] });
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

/** Writes files under the upstream repo; a non-string value is written as JSON. */
async function upstream(files: Record<string, string | object>): Promise<void> {
	await write(upstreamDir, files);
}

async function write(
	base: string,
	files: Record<string, string | object>,
): Promise<void> {
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

async function manifest(): Promise<Manifest> {
	const raw = await readFile(
		join(projectDir, ".agntc", "manifest.json"),
		"utf-8",
	).catch(() => "{}");
	return JSON.parse(raw) as Manifest;
}

/** An entry from an earlier install that owns `files`. */
function installedEntry(
	files: string[],
	type: EntryType = "skill",
): ManifestEntry {
	return {
		ref: null,
		commit: "old",
		installedAt: "2026-01-01T00:00:00.000Z",
		files,
		type,
		cloneUrl: null,
	};
}

async function seedManifest(entries: Manifest): Promise<void> {
	await write(projectDir, { ".agntc/manifest.json": entries });
}

async function exitCode(run: Promise<void>): Promise<number | null> {
	const err = await run.then(
		() => null,
		(error: unknown) => error,
	);
	if (err === null) {
		return null;
	}
	if (err instanceof ExitSignal) {
		return err.code;
	}
	throw err;
}

function cancelled(): string[] {
	return mockCancel.mock.calls.map(([message]) => String(message));
}

function logged(level: "info" | "warn" | "success" | "error"): string[] {
	return mockLog[level].mock.calls.map(([message]) => String(message));
}

describe("add command", () => {
	describe("options", () => {
		function option(flag: string) {
			return addCommand.options.find((o) => o.long === flag);
		}

		it("takes --skill names, --pack, --all and the hidden --plugin", () => {
			expect(option("--skill")?.variadic).toBe(true);
			expect(option("--pack")).toBeDefined();
			expect(option("--all")).toBeDefined();
			expect(option("--plugin")?.hidden).toBe(true);
		});
	});

	describe("flags", () => {
		it("refuses clashing flags before reading the source", async () => {
			const code = await exitCode(
				runAdd("owner/repo", { skill: ["a"], pack: true }),
			);

			expect(code).toBe(1);
			expect(cancelled()).toEqual(["--skill and --pack can't be combined"]);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("notes --plugin is now --pack and bundles the source as one pack", async () => {
			await upstream({ "skills/a/SKILL.md": "", "skills/b/SKILL.md": "" });

			await runAdd("owner/repo", { plugin: true });

			expect(logged("info")).toContain("--plugin is now --pack");
			expect(await manifest()).toEqual({
				"owner/repo": expect.objectContaining({
					type: "pack",
					files: [".claude/skills/a/", ".claude/skills/b/"],
				}),
			});
		});

		it("takes --plugin alongside --pack", async () => {
			await upstream({ "skills/a/SKILL.md": "" });

			await runAdd("owner/repo", { plugin: true, pack: true });

			expect((await manifest())["owner/repo"]).toMatchObject({ type: "pack" });
		});
	});

	describe("source", () => {
		it("clones a remote source, installs from it and cleans the clone up", async () => {
			await upstream({ "SKILL.md": "" });

			await runAdd("owner/repo");

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ owner: "owner", repo: "repo", ref: null }),
			);
			expect(await installed(".claude/skills/repo/SKILL.md")).toBe(true);
			expect(mockCleanupTempDir).toHaveBeenCalledWith(cloneDir);
		});

		it("refuses, naming the error, when the clone fails", async () => {
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const code = await exitCode(runAdd("owner/repo"));

			expect(code).toBe(1);
			expect(cancelled()).toEqual(["git clone failed"]);
			expect(await manifest()).toEqual({});
		});

		it("refuses a malformed source without cloning", async () => {
			const code = await exitCode(runAdd("not-a-source"));

			expect(code).toBe(1);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("still cleans the clone up when the add fails", async () => {
			await upstream({ "README.md": "" });

			await exitCode(runAdd("owner/repo"));

			expect(mockCleanupTempDir).toHaveBeenCalledWith(cloneDir);
		});

		it("installs a local folder in place, keyed by its path and named after it", async () => {
			const local = join(testDir, "my-skills");
			await write(local, { "skills/a/SKILL.md": "", "b/SKILL.md": "" });

			await runAdd(local, { all: true });

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockFetchRemoteTags).not.toHaveBeenCalled();
			expect(await manifest()).toEqual({
				[`${local}/b`]: expect.objectContaining({
					ref: null,
					commit: null,
					cloneUrl: null,
					type: "skill",
					localRoot: local,
				}),
				[`${local}/a`]: expect.objectContaining({
					sourceSubpath: "skills/a",
					localRoot: local,
				}),
			});
			expect(mockOutro).toHaveBeenCalledWith(`Installed ${local}@local`);
		});

		it("names a local root skill after the folder", async () => {
			const local = join(testDir, "solo-skill");
			await write(local, { "SKILL.md": "" });

			await runAdd(local);

			expect(
				await installed(`.claude/skills/${basename(local)}/SKILL.md`),
			).toBe(true);
			expect(Object.keys(await manifest())).toEqual([local]);
		});

		it("walks a tree URL from its path at its ref, with no tag lookup", async () => {
			await upstream({
				"tools/lint/SKILL.md": "",
				"other/SKILL.md": "",
			});

			await runAdd("https://github.com/owner/repo/tree/main/tools");

			expect(mockFetchRemoteTags).not.toHaveBeenCalled();
			expect(await manifest()).toEqual({
				"owner/repo/lint": expect.objectContaining({
					ref: "main",
					sourceSubpath: "tools/lint",
				}),
			});
		});
	});

	describe("version", () => {
		beforeEach(async () => {
			await upstream({ "SKILL.md": "" });
		});

		it("resolves a bare add to the latest tag and stores a caret constraint", async () => {
			mockFetchRemoteTags.mockResolvedValue([
				"v1.0.0",
				"v1.4.2",
				"v2.0.0-rc.1",
			]);

			await runAdd("owner/repo");

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "v1.4.2" }),
			);
			expect((await manifest())["owner/repo"]).toMatchObject({
				ref: "v1.4.2",
				constraint: "^1.4.2",
			});
		});

		it("does the same for owner/repo/path", async () => {
			await upstream({ "sub/SKILL.md": "" });
			mockFetchRemoteTags.mockResolvedValue(["v3.1.0"]);

			await runAdd("owner/repo/sub");

			expect((await manifest())["owner/repo/sub"]).toMatchObject({
				ref: "v3.1.0",
				constraint: "^3.1.0",
			});
		});

		it("tracks HEAD with no constraint when the repo has no semver tags", async () => {
			await runAdd("owner/repo");

			const entry = (await manifest())["owner/repo"]!;
			expect(entry.ref).toBeNull();
			expect(entry).not.toHaveProperty("constraint");
		});

		it("resolves an explicit constraint to its best tag, storing the constraint", async () => {
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.3.0", "v2.0.0"]);

			await runAdd("owner/repo@^1.0");

			expect((await manifest())["owner/repo"]).toMatchObject({
				ref: "v1.3.0",
				constraint: "^1.0",
			});
		});

		it("refuses a constraint no tag satisfies", async () => {
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0"]);

			const code = await exitCode(runAdd("owner/repo@^2.0"));

			expect(code).toBe(1);
			expect(cancelled()).toEqual([
				"No tags satisfy constraint ^2.0 for owner/repo",
			]);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("installs an exact ref as given, with no constraint", async () => {
			await runAdd("owner/repo@v1.0.0");

			expect(mockFetchRemoteTags).not.toHaveBeenCalled();
			const entry = (await manifest())["owner/repo"]!;
			expect(entry.ref).toBe("v1.0.0");
			expect(entry).not.toHaveProperty("constraint");
		});
	});

	describe("engine errors", () => {
		it("refuses a path that isn't in the source, naming the source", async () => {
			await upstream({ "SKILL.md": "" });

			const code = await exitCode(runAdd("owner/repo/nope"));

			expect(code).toBe(1);
			expect(cancelled()).toEqual([
				'owner/repo: path "nope" not found in source',
			]);
			expect(await installed(".agntc")).toBe(false);
		});

		it("refuses a path escaping the source", async () => {
			const code = await exitCode(runAdd("owner/repo/../outside"));

			expect(code).toBe(1);
			expect(cancelled()[0]).toMatch(/^owner\/repo: subpath "..\/outside"/);
		});

		it("refuses --pack on a single skill", async () => {
			await upstream({ "SKILL.md": "" });

			const code = await exitCode(runAdd("owner/repo", { pack: true }));

			expect(code).toBe(1);
			expect(cancelled()).toEqual([
				`owner/repo: "repo" is a single skill — --pack can't bundle it`,
			]);
		});

		it("refuses --pack on a folder holding packs", async () => {
			await upstream({ "a/agntc.json": PACK, "a/s/SKILL.md": "" });

			const code = await exitCode(runAdd("owner/repo", { pack: true }));

			expect(code).toBe(1);
			expect(cancelled()[0]).toContain("contains packs (a)");
		});
	});

	describe("choosing", () => {
		it("prints stray notices first, then refuses when nothing is found", async () => {
			await upstream({ "agents/a.md": "" });

			const code = await exitCode(runAdd("owner/repo@v1.0.0"));

			expect(code).toBe(1);
			expect(logged("warn")).toEqual([
				"repo has agents/ that won't be installed — to install them as a pack: npx agntc add owner/repo@v1.0.0 --pack",
			]);
			expect(cancelled()).toEqual([
				"owner/repo: no skills or packs were found",
			]);
			expect(mockLog.warn.mock.invocationCallOrder[0]).toBeLessThan(
				mockCancel.mock.invocationCallOrder[0]!,
			);
		});

		it("refuses --pack on an empty folder as nothing to install", async () => {
			await upstream({ "README.md": "" });

			const code = await exitCode(runAdd("owner/repo", { pack: true }));

			expect(code).toBe(1);
			expect(cancelled()).toEqual([
				"owner/repo: nothing to install — repo has no skills, agents or hooks",
			]);
		});

		it("installs the one thing found without a menu", async () => {
			await upstream({ "p/agntc.json": PACK, "p/s/SKILL.md": "" });

			await runAdd("owner/repo");

			expect(mockMultiselect).not.toHaveBeenCalled();
			expect(Object.keys(await manifest())).toEqual(["owner/repo/p"]);
		});

		it("shows a menu of packs then skills and installs what's picked", async () => {
			await upstream({
				"z/SKILL.md": "",
				"p/agntc.json": PACK,
				"p/s/SKILL.md": "",
				"a/SKILL.md": "",
			});
			mockMultiselect.mockResolvedValue([0, 2]);

			await runAdd("owner/repo");

			expect(
				mockMultiselect.mock.calls[0]![0].options.map((o) => o.label),
			).toEqual(["p", "a", "z"]);
			expect(Object.keys(await manifest())).toEqual([
				"owner/repo/p",
				"owner/repo/z",
			]);
		});

		it("ends cleanly when the menu is cancelled", async () => {
			await upstream({ "a/SKILL.md": "", "b/SKILL.md": "" });
			mockMultiselect.mockResolvedValue(CANCEL);

			const code = await exitCode(runAdd("owner/repo"));

			expect(code).toBe(0);
			expect(cancelled()).toEqual(["Cancelled — nothing selected"]);
			expect(await installed(".agntc")).toBe(false);
		});

		it("ends cleanly when nothing is picked", async () => {
			await upstream({ "a/SKILL.md": "", "b/SKILL.md": "" });
			mockMultiselect.mockResolvedValue([]);

			expect(await exitCode(runAdd("owner/repo"))).toBe(0);
			expect(await installed(".agntc")).toBe(false);
		});

		it("refuses --skill naming a skill that isn't there, installing nothing", async () => {
			await upstream({ "a/SKILL.md": "", "b/SKILL.md": "" });

			const code = await exitCode(
				runAdd("owner/repo", { skill: ["a", "missing"] }),
			);

			expect(code).toBe(1);
			expect(cancelled()).toEqual(['owner/repo: no skill named "missing"']);
			expect(await installed(".claude")).toBe(false);
		});

		it("notes what a skill taken from a pack leaves behind", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/a/SKILL.md": "",
				"p/skills/b/SKILL.md": "",
				"p/hooks/h.sh": "",
			});

			await runAdd("owner/repo", { skill: ["a"] });

			expect(logged("info")).toContain(
				"a is part of the pack p — installed on its own, without b and its hooks",
			);
			expect(await manifest()).toEqual({
				"owner/repo/a": expect.objectContaining({
					type: "skill",
					sourceSubpath: "p/skills/a",
				}),
			});
			expect(await installed(".claude/hooks")).toBe(false);
		});

		it("installs everything with --all", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/s/SKILL.md": "",
				"a/SKILL.md": "",
			});

			await runAdd("owner/repo", { all: true });

			expect(mockMultiselect).not.toHaveBeenCalled();
			expect(await manifest()).toEqual({
				"owner/repo/p": expect.objectContaining({ type: "pack" }),
				"owner/repo/a": expect.objectContaining({ type: "skill" }),
			});
		});

		it("refuses two picked items that would share a key, naming both paths", async () => {
			await upstream({
				"foo/agntc.json": PACK,
				"foo/skills/bar/SKILL.md": "",
				"x/foo/SKILL.md": "",
			});

			const code = await exitCode(runAdd("owner/repo", { all: true }));

			expect(code).toBe(1);
			expect(cancelled()).toEqual([
				"owner/repo: foo and x/foo would share the key owner/repo/foo — choose one",
			]);
			expect(await installed(".claude")).toBe(false);
		});

		it("refuses two picked skills that would install to one place, naming both paths", async () => {
			await upstream({ "x/foo/SKILL.md": "", "y/foo/SKILL.md": "" });

			const code = await exitCode(runAdd("owner/repo", { all: true }));

			expect(code).toBe(1);
			expect(cancelled()).toEqual([
				"owner/repo: x/foo and y/foo would both install to .claude/skills/foo — choose one",
			]);
			expect(await installed(".claude")).toBe(false);
		});
	});

	describe("reinstalling under the same key", () => {
		const OLD_PACK = installedEntry([".claude/skills/s/"], "pack");

		beforeEach(async () => {
			await write(projectDir, { ".claude/skills/s/SKILL.md": "old" });
			await seedManifest({ "owner/repo/p": OLD_PACK });
		});

		it("replaces the earlier install without asking about its own files", async () => {
			await upstream({ "p/agntc.json": PACK, "p/skills/t/SKILL.md": "" });

			await runAdd("owner/repo/p");

			expect(mockResolveCollisions).not.toHaveBeenCalled();
			expect(mockResolveUnmanaged).not.toHaveBeenCalled();
			expect(await installed(".claude/skills/s")).toBe(false);
			expect(await installed(".claude/skills/t/SKILL.md")).toBe(true);
			expect((await manifest())["owner/repo/p"]).toMatchObject({
				commit: SHA,
				files: [".claude/skills/t/"],
			});
		});

		it("leaves the earlier install and its entry alone when a collision isn't resolved", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/s/SKILL.md": "new",
				"p/skills/t/SKILL.md": "",
			});
			await seedManifest({
				"owner/repo/p": OLD_PACK,
				"other/repo": installedEntry([".claude/skills/t/"]),
			});
			mockResolveCollisions.mockImplementation(async (_, current) => ({
				resolved: false,
				updatedManifest: current,
			}));

			await runAdd("owner/repo/p");

			expect(mockNuke).not.toHaveBeenCalled();
			expect(
				await readFile(join(projectDir, ".claude/skills/s/SKILL.md"), "utf-8"),
			).toBe("old");
			expect((await manifest())["owner/repo/p"]).toEqual(OLD_PACK);
			expect(logged("warn")).toEqual(["p: skipped — conflict not resolved"]);
		});

		it("leaves the earlier install and its entry alone when unmanaged files aren't overwritten", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/s/SKILL.md": "new",
				"p/agents/x.md": "",
			});
			await write(projectDir, { ".claude/agents/x.md": "mine" });
			mockResolveUnmanaged.mockResolvedValue({
				approved: [],
				cancelled: [".claude/agents/x.md"],
			});

			await runAdd("owner/repo/p");

			expect(mockResolveUnmanaged).toHaveBeenCalledWith(
				[{ pluginKey: "owner/repo/p", files: [".claude/agents/x.md"] }],
				interactiveUi,
			);
			expect(mockNuke).not.toHaveBeenCalled();
			expect(
				await readFile(join(projectDir, ".claude/skills/s/SKILL.md"), "utf-8"),
			).toBe("old");
			expect((await manifest())["owner/repo/p"]).toEqual(OLD_PACK);
		});

		it("drops the entry when the copy fails after the earlier install is removed", async () => {
			await upstream({ "p/agntc.json": PACK, "p/skills/s/SKILL.md": "new" });
			mockCopyItem.mockRejectedValue(new Error("disk full"));

			const code = await exitCode(runAdd("owner/repo/p"));

			expect(code).toBe(1);
			expect(await installed(".claude/skills/s")).toBe(false);
			expect(await manifest()).toEqual({});
			expect(logged("error")).toEqual([
				"p: failed — disk full; its earlier install was removed",
			]);
		});

		it("keeps the entry, and copies nothing, when the earlier install can't be removed", async () => {
			await upstream({ "p/agntc.json": PACK, "p/skills/s/SKILL.md": "new" });
			mockNuke.mockRejectedValue(new Error("EACCES"));

			const code = await exitCode(runAdd("owner/repo/p"));

			expect(code).toBe(1);
			expect(mockCopyItem).not.toHaveBeenCalled();
			expect((await manifest())["owner/repo/p"]).toEqual(OLD_PACK);
			expect(logged("error")).toEqual([
				"p: failed — couldn't remove its earlier install: EACCES",
			]);
		});
	});

	describe("a pack and the loose skills from its own source", () => {
		const PACKED = installedEntry([".claude/skills/api/"], "pack");
		const API_NOTE =
			"api is already installed as part of the pack owner/repo/p";

		it("drops a loose skill the pack took over even when the pack's copy then fails", async () => {
			await upstream({ "p/agntc.json": PACK, "p/skills/api/SKILL.md": "new" });
			await write(projectDir, { ".claude/skills/api/SKILL.md": "old" });
			await seedManifest({
				"owner/repo/api": installedEntry([".claude/skills/api/"]),
			});
			mockCopyItem.mockRejectedValue(new Error("disk full"));

			const code = await exitCode(runAdd("owner/repo/p"));

			expect(code).toBe(1);
			expect(mockResolveCollisions).not.toHaveBeenCalled();
			expect(await installed(".claude/skills/api")).toBe(false);
			expect(await manifest()).toEqual({});
			expect(logged("error")).toEqual([
				"p: failed — disk full; the skill it took over was removed: owner/repo/api",
			]);
			expect(logged("info")).toEqual([]);
		});

		it("--skill on a skill the installed pack holds says so once and installs nothing, exiting 0", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/api/SKILL.md": "",
				"p/skills/models/SKILL.md": "",
			});
			await seedManifest({ "owner/repo/p": PACKED });

			const code = await exitCode(runAdd("owner/repo", { skill: ["api"] }));

			expect(code).toBeNull();
			expect(logged("info")).toEqual([API_NOTE]);
			expect(mockCopyItem).not.toHaveBeenCalled();
			expect(await manifest()).toEqual({ "owner/repo/p": PACKED });
			expect(mockOutro).toHaveBeenCalledWith(
				"Nothing installed from owner/repo",
			);
		});

		it("--skill on such a skill and another installs the other, with only the one note for the first", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/api/SKILL.md": "",
				"tools/SKILL.md": "",
			});
			await seedManifest({ "owner/repo/p": PACKED });

			await runAdd("owner/repo", { skill: ["api", "tools"] });

			expect(logged("info")).toEqual([API_NOTE]);
			expect(Object.keys(await manifest())).toEqual([
				"owner/repo/p",
				"owner/repo/tools",
			]);
		});

		it("leaves such a skill off the menu, noting it before the menu", async () => {
			await upstream({
				"skills/api/SKILL.md": "",
				"skills/jobs/SKILL.md": "",
				"skills/lint/SKILL.md": "",
			});
			await seedManifest({ "owner/repo/p": PACKED });
			mockMultiselect.mockResolvedValue([0]);

			await runAdd("owner/repo");

			const [menu] = mockMultiselect.mock.calls[0]!;
			expect(menu.options.map((option) => option.label)).toEqual([
				"skills/jobs",
				"skills/lint",
			]);
			expect(logged("info")).toEqual([API_NOTE]);
			expect(mockLog.info.mock.invocationCallOrder[0]).toBeLessThan(
				mockMultiselect.mock.invocationCallOrder[0]!,
			);
			expect(Object.keys(await manifest())).toEqual([
				"owner/repo/p",
				"owner/repo/jobs",
			]);
		});

		it("without a terminal, reports the note and nothing installed, exiting 0", async () => {
			await upstream({ "p/agntc.json": PACK, "p/skills/api/SKILL.md": "" });
			await seedManifest({ "owner/repo/p": PACKED });

			const run = await runMachine(addCommand, [
				"owner/repo",
				"--skill",
				"api",
			]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toMatchObject({
				ok: true,
				items: [],
				notes: [API_NOTE],
			});
		});
	});

	describe("installing", () => {
		it("records ref, commit, clone URL and constraint on every entry", async () => {
			await upstream({
				"a/SKILL.md": "",
				"p/agntc.json": PACK,
				"p/s/SKILL.md": "",
			});
			mockFetchRemoteTags.mockResolvedValue(["v1.2.0"]);

			await runAdd("owner/repo", { all: true });

			const shared = {
				ref: "v1.2.0",
				commit: SHA,
				cloneUrl: "https://github.com/owner/repo.git",
				constraint: "^1.2.0",
			};
			expect(await manifest()).toEqual({
				"owner/repo/p": expect.objectContaining({
					...shared,
					type: "pack",
					files: [".claude/skills/s/"],
				}),
				"owner/repo/a": expect.objectContaining({
					...shared,
					type: "skill",
					files: [".claude/skills/a/"],
				}),
			});
			for (const entry of Object.values(await manifest())) {
				expect(entry).not.toHaveProperty("localRoot");
			}
		});

		it("asks about a collision with another entry and installs once it's resolved", async () => {
			await upstream({ "a/SKILL.md": "" });
			await seedManifest({
				"other/repo": installedEntry([".claude/skills/a/"]),
			});
			mockResolveCollisions.mockImplementation(async (collisions, current) => {
				expect([...collisions.keys()]).toEqual(["other/repo"]);
				const { "other/repo": _, ...rest } = current;
				return { resolved: true, updatedManifest: rest };
			});

			await runAdd("owner/repo");

			expect(Object.keys(await manifest())).toEqual(["owner/repo/a"]);
		});

		it("skips an item whose collision isn't resolved and installs the rest", async () => {
			await upstream({ "a/SKILL.md": "", "b/SKILL.md": "" });
			await seedManifest({
				"other/repo": installedEntry([".claude/skills/a/"]),
			});
			mockResolveCollisions.mockImplementation(async (_, current) => ({
				resolved: false,
				updatedManifest: current,
			}));

			const code = await exitCode(runAdd("owner/repo", { all: true }));

			expect(code).toBeNull();
			expect(Object.keys(await manifest()).sort()).toEqual([
				"other/repo",
				"owner/repo/b",
			]);
			expect(logged("warn")).toEqual(["a: skipped — conflict not resolved"]);
		});

		it("skips an item whose unmanaged files the user won't overwrite", async () => {
			await upstream({ "a/SKILL.md": "" });
			await write(projectDir, { ".claude/skills/a/SKILL.md": "mine" });
			mockResolveUnmanaged.mockResolvedValue({
				approved: [],
				cancelled: [".claude/skills/a/"],
			});

			await runAdd("owner/repo");

			expect(mockResolveUnmanaged).toHaveBeenCalledWith(
				[{ pluginKey: "owner/repo/a", files: [".claude/skills/a/"] }],
				interactiveUi,
			);
			expect(
				await readFile(join(projectDir, ".claude/skills/a/SKILL.md"), "utf-8"),
			).toBe("mine");
			expect(mockOutro).toHaveBeenCalledWith(
				"Nothing installed from owner/repo",
			);
		});

		it("fails an item holding an escaping symlink, installs its siblings, then exits non-zero", async () => {
			await upstream({ "good/SKILL.md": "", "bad/SKILL.md": "" });
			await write(testDir, { "secret.txt": "" });
			await symlink(join(testDir, "secret.txt"), join(upstreamDir, "bad/leak"));

			const code = await exitCode(runAdd("owner/repo", { all: true }));

			expect(code).toBe(1);
			expect(Object.keys(await manifest())).toEqual(["owner/repo/good"]);
			expect(await installed(".claude/skills/bad")).toBe(false);
			expect(logged("error")[0]).toMatch(/^bad: failed — symlink "leak"/);
		});

		it("fails an item whose copy throws and exits non-zero after the summary", async () => {
			await upstream({ "a/SKILL.md": "", "b/SKILL.md": "" });
			mockCopyItem.mockImplementation(async (item, root, dir) => {
				if (item.kind === "skill" && item.skill.name === "a") {
					throw new Error("disk full");
				}
				return actualCopyItem.copyItem(item, root, dir);
			});

			const code = await exitCode(runAdd("owner/repo", { all: true }));

			expect(code).toBe(1);
			expect(Object.keys(await manifest())).toEqual(["owner/repo/b"]);
			expect(logged("error")).toEqual(["a: failed — disk full"]);
			expect(mockOutro).toHaveBeenCalledWith("Installed owner/repo@HEAD");
		});

		it("summarises one line per item, with a pack's counts", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/x/SKILL.md": "",
				"p/skills/y/SKILL.md": "",
				"p/agents/a.md": "",
				"p/hooks/h.sh": "",
				"tools/lint/SKILL.md": "",
			});

			await runAdd("owner/repo", { all: true });

			expect(logged("success")).toEqual([
				"p (pack · 2 skills, 1 agent, 1 hook)\ntools/lint",
			]);
			expect(mockOutro).toHaveBeenCalledWith("Installed owner/repo@HEAD");
		});

		it("copies under a spinner only when something will be copied", async () => {
			await upstream({ "a/SKILL.md": "" });
			mockResolveUnmanaged.mockResolvedValue({
				approved: [],
				cancelled: [".claude/skills/a/"],
			});
			await write(projectDir, { ".claude/skills/a/SKILL.md": "" });

			await runAdd("owner/repo");

			const spinners = vi
				.mocked(p.spinner)
				.mock.results.map(
					(result) =>
						result.value as { start: { mock: { calls: unknown[][] } } },
				);
			const started = spinners.flatMap((spin) =>
				spin.start.mock.calls.map(([text]) => text),
			);
			expect(started).toEqual(["Cloning repository..."]);
		});
	});
	describe("--overwrite", () => {
		beforeEach(async () => {
			await upstream({ "a/SKILL.md": "new" });
		});

		it("replaces another entry's files without asking, removing that entry", async () => {
			await write(projectDir, { ".claude/skills/a/SKILL.md": "theirs" });
			await seedManifest({
				"other/repo": installedEntry([
					".claude/skills/a/",
					".claude/skills/z/",
				]),
			});

			await runAdd("owner/repo", { overwrite: true });

			expect(mockResolveCollisions).not.toHaveBeenCalled();
			expect(Object.keys(await manifest())).toEqual(["owner/repo/a"]);
			expect(
				await readFile(join(projectDir, ".claude/skills/a/SKILL.md"), "utf-8"),
			).toBe("new");
		});

		it("replaces files agntc didn't install without asking", async () => {
			await write(projectDir, { ".claude/skills/a/SKILL.md": "mine" });

			await runAdd("owner/repo", { overwrite: true });

			expect(mockResolveUnmanaged).not.toHaveBeenCalled();
			expect(
				await readFile(join(projectDir, ".claude/skills/a/SKILL.md"), "utf-8"),
			).toBe("new");
			expect(Object.keys(await manifest())).toEqual(["owner/repo/a"]);
		});

		it("replaces another entry's files without a terminal", async () => {
			await write(projectDir, { ".claude/skills/a/SKILL.md": "theirs" });
			await seedManifest({
				"other/repo": installedEntry([".claude/skills/a/"]),
			});

			const run = await runMachine(addCommand, ["owner/repo", "--overwrite"]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toMatchObject({
				ok: true,
				items: [{ key: "owner/repo/a", status: "installed" }],
			});
			expect(Object.keys(await manifest())).toEqual(["owner/repo/a"]);
			expect(
				await readFile(join(projectDir, ".claude/skills/a/SKILL.md"), "utf-8"),
			).toBe("new");
		});

		it("replaces files agntc didn't install without a terminal", async () => {
			await write(projectDir, { ".claude/skills/a/SKILL.md": "mine" });

			const run = await runMachine(addCommand, ["owner/repo", "--overwrite"]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toMatchObject({
				ok: true,
				items: [{ key: "owner/repo/a", status: "installed" }],
			});
			expect(mockResolveUnmanaged).not.toHaveBeenCalled();
			expect(
				await readFile(join(projectDir, ".claude/skills/a/SKILL.md"), "utf-8"),
			).toBe("new");
		});

		describe("left off, without a terminal", () => {
			beforeEach(async () => {
				await upstream({ "b/SKILL.md": "" });
			});

			it("stops an item whose files belong to another entry, naming the flag, and installs the rest", async () => {
				await write(projectDir, { ".claude/skills/a/SKILL.md": "theirs" });
				await seedManifest({
					"other/repo": installedEntry([".claude/skills/a/"]),
				});

				const run = await runMachine(addCommand, ["owner/repo", "--all"]);

				expect(run.exitCode).toBe(1);
				expect(run.document.ok).toBe(false);
				expect(run.document.items).toEqual([
					{
						key: "owner/repo/a",
						type: "skill",
						path: "a",
						status: "skipped",
						reason: "files in the way belong to other/repo: .claude/skills/a/",
						flags: ["--overwrite"],
					},
					expect.objectContaining({
						key: "owner/repo/b",
						status: "installed",
					}),
				]);
				expect(mockResolveCollisions).not.toHaveBeenCalled();
				expect(Object.keys(await manifest()).sort()).toEqual([
					"other/repo",
					"owner/repo/b",
				]);
				expect(
					await readFile(
						join(projectDir, ".claude/skills/a/SKILL.md"),
						"utf-8",
					),
				).toBe("theirs");
			});

			it("stops an item whose files agntc didn't install, naming the flag, and installs the rest", async () => {
				await write(projectDir, { ".claude/skills/a/SKILL.md": "mine" });

				const run = await runMachine(addCommand, ["owner/repo", "--all"]);

				expect(run.exitCode).toBe(1);
				expect(run.document.items).toEqual([
					{
						key: "owner/repo/a",
						type: "skill",
						path: "a",
						status: "skipped",
						reason:
							"files in the way weren't installed by agntc: .claude/skills/a/",
						flags: ["--overwrite"],
					},
					expect.objectContaining({
						key: "owner/repo/b",
						status: "installed",
					}),
				]);
				expect(mockResolveUnmanaged).not.toHaveBeenCalled();
				expect(
					await readFile(
						join(projectDir, ".claude/skills/a/SKILL.md"),
						"utf-8",
					),
				).toBe("mine");
			});
		});
	});

	describe("--list", () => {
		beforeEach(async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/s/SKILL.md": "",
				"p/hooks/h.sh": "",
				"tools/a/SKILL.md": "---\ndescription: Does A\n---\n",
				"agents/x.md": "",
			});
		});

		it("shows each pack with its skill count and each skill with its description, installing nothing", async () => {
			await runAdd("owner/repo@v1.0.0", { list: true });

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "v1.0.0" }),
			);
			expect(mockLog.message).toHaveBeenCalledWith(
				"p (pack · 1 skill)\ntools/a (Does A)",
			);
			expect(logged("warn")).toEqual([
				"repo has agents/ that won't be installed — to install them as a pack: npx agntc add owner/repo@v1.0.0 --pack",
			]);
			expect(mockOutro).toHaveBeenCalledWith(
				"owner/repo@v1.0.0 holds 1 pack and 1 skill",
			);
			expect(mockMultiselect).not.toHaveBeenCalled();
			expect(await installed(".agntc")).toBe(false);
			expect(await installed(".claude")).toBe(false);
		});

		it("prints the listing as one document without a terminal", async () => {
			mockFetchRemoteTags.mockResolvedValue(["v1.2.0"]);

			const run = await runMachine(addCommand, ["owner/repo", "--list"]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toEqual({
				ok: true,
				command: "add",
				scope: "project",
				source: "owner/repo",
				ref: "v1.2.0",
				commit: SHA,
				constraint: "^1.2.0",
				packs: [
					{
						name: "p",
						path: "p",
						skillCount: 1,
						skills: [{ name: "s", path: "p/skills/s", description: null }],
						assetDirs: ["hooks"],
					},
				],
				skills: [{ name: "a", path: "tools/a", description: "Does A" }],
				strays: [{ path: "", assetDirs: ["agents"] }],
				warnings: [],
				notes: [],
			});
			expect(clackCalls(p)).toEqual([]);
			expect(await installed(".claude")).toBe(false);
		});

		it("reads only the path given", async () => {
			const run = await runMachine(addCommand, ["owner/repo/tools", "--list"]);

			expect(run.document).toMatchObject({
				source: "owner/repo",
				packs: [],
				skills: [{ name: "a", path: "tools/a" }],
				strays: [],
			});
		});

		it("reads the path as one pack with --pack", async () => {
			const run = await runMachine(addCommand, [
				"owner/repo/tools",
				"--list",
				"--pack",
			]);

			expect(run.document).toMatchObject({
				packs: [{ name: "tools", path: "tools", skillCount: 1 }],
				skills: [],
			});
		});

		it.each([
			[{ skill: ["a"] }, "--skill and --list can't be combined"],
			[{ all: true }, "--all and --list can't be combined"],
		])("refuses %o alongside it before reading the source", async (flags, message) => {
			const code = await exitCode(
				runAdd("owner/repo", { list: true, ...flags }),
			);

			expect(code).toBe(1);
			expect(cancelled()).toEqual([message]);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("without a terminal", () => {
		it("prints one document of what it installed, and never touches clack", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/s/SKILL.md": "",
				"a/SKILL.md": "",
			});
			mockFetchRemoteTags.mockResolvedValue(["v1.2.0"]);

			const run = await runMachine(addCommand, ["owner/repo", "--all"]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toEqual({
				ok: true,
				command: "add",
				scope: "project",
				source: "owner/repo",
				ref: "v1.2.0",
				commit: SHA,
				constraint: "^1.2.0",
				items: [
					{
						key: "owner/repo/p",
						type: "pack",
						path: "p",
						status: "installed",
						files: [".claude/skills/s/"],
					},
					{
						key: "owner/repo/a",
						type: "skill",
						path: "a",
						status: "installed",
						files: [".claude/skills/a/"],
					},
				],
				warnings: [],
				notes: [],
			});
			expect(clackCalls(p)).toEqual([]);
		});

		it("installs the one thing found without asking", async () => {
			await upstream({ "a/SKILL.md": "" });

			const run = await runMachine(addCommand, ["owner/repo"]);

			expect(run.document.ok).toBe(true);
			expect(Object.keys(await manifest())).toEqual(["owner/repo/a"]);
		});

		it("refuses to guess when several things are found, naming the flags and listing what was found", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/s/SKILL.md": "",
				"a/SKILL.md": "---\ndescription: Does A\n---\n",
			});

			const run = await runMachine(addCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document.error).toEqual({
				message:
					"owner/repo: found more than one thing to install — name what to install with --skill, --pack or --all, or add the path to one skill or pack:\n  p (pack · 1 skill)\n  a (Does A)",
				flags: ["--skill", "--pack", "--all"],
			});
			expect(run.document).toMatchObject({
				ok: false,
				packs: [{ name: "p", path: "p", skillCount: 1 }],
				skills: [{ name: "a", path: "a", description: "Does A" }],
			});
			expect(clackCalls(p)).toEqual([]);
			expect(await installed(".agntc")).toBe(false);
		});

		it("reports each item when some install and some fail, exiting 1", async () => {
			await upstream({ "good/SKILL.md": "", "bad/SKILL.md": "" });
			await write(testDir, { "secret.txt": "" });
			await symlink(join(testDir, "secret.txt"), join(upstreamDir, "bad/leak"));

			const run = await runMachine(addCommand, ["owner/repo", "--all"]);

			expect(run.exitCode).toBe(1);
			expect(run.document.ok).toBe(false);
			expect(run.document.items).toEqual([
				{
					key: "owner/repo/bad",
					type: "skill",
					path: "bad",
					status: "failed",
					reason: expect.stringMatching(/^symlink "leak"/),
				},
				expect.objectContaining({
					key: "owner/repo/good",
					status: "installed",
				}),
			]);
		});

		it("prints an error document when the clone fails", async () => {
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const run = await runMachine(addCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toEqual({
				ok: false,
				command: "add",
				scope: "project",
				error: { message: "git clone failed" },
				warnings: [],
				notes: [],
			});
		});

		it("carries stray notices and malformed config warnings as warnings, and notes as notes", async () => {
			await upstream({
				"p/agntc.json": PACK,
				"p/skills/a/SKILL.md": "",
				"p/skills/b/SKILL.md": "",
				"x/agntc.json": "{not json",
				"agents/x.md": "",
			});

			const run = await runMachine(addCommand, ["owner/repo", "--skill", "a"]);

			expect(run.document.warnings).toEqual([
				expect.stringMatching(/^Ignoring malformed agntc\.json/),
				"repo has agents/ that won't be installed — to install them as a pack: npx agntc add owner/repo --pack",
			]);
			expect(run.document.notes).toEqual([
				"a is part of the pack p — installed on its own, without b",
			]);
		});

		it("notes that --plugin is now --pack", async () => {
			await upstream({ "skills/a/SKILL.md": "" });

			const run = await runMachine(addCommand, ["owner/repo", "--plugin"]);

			expect(run.document.notes).toEqual(["--plugin is now --pack"]);
		});
	});
});

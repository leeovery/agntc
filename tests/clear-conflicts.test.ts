import {
	lstat,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/collision-resolve.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/collision-resolve.js")>()),
	resolveCollisions: vi.fn(),
}));

vi.mock("../src/unmanaged-resolve.js", () => ({
	resolveUnmanagedConflicts: vi.fn(),
}));

vi.mock("../src/nuke-files.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/nuke-files.js")>();
	return {
		...actual,
		nukeManifestFiles: vi.fn(actual.nukeManifestFiles),
		removePathsInTheWay: vi.fn(actual.removePathsInTheWay),
	};
});

import {
	type ConflictPolicy,
	clearConflicts,
	conflictPolicy,
} from "../src/clear-conflicts.js";
import {
	PartialRemovalError,
	resolveCollisions,
} from "../src/collision-resolve.js";
import { ExitSignal } from "../src/exit-signal.js";
import type { Manifest, ManifestEntry } from "../src/manifest.js";
import { nukeManifestFiles, removePathsInTheWay } from "../src/nuke-files.js";
import { resolveUnmanagedConflicts } from "../src/unmanaged-resolve.js";
import { type TestUi, testUi } from "./helpers/test-ui.js";

const actualNuke = await vi.importActual<typeof import("../src/nuke-files.js")>(
	"../src/nuke-files.js",
);

const mockResolveCollisions = vi.mocked(resolveCollisions);
const mockResolveUnmanaged = vi.mocked(resolveUnmanagedConflicts);
const mockNuke = vi.mocked(nukeManifestFiles);
const mockRemovePaths = vi.mocked(removePathsInTheWay);

const INCOMING = [".claude/skills/a/"];

let projectDir: string;
let ui: TestUi;

beforeEach(async () => {
	vi.clearAllMocks();
	ui = testUi();
	projectDir = await mkdtemp(join(tmpdir(), "agntc-conflicts-"));
});

afterEach(async () => {
	await rm(projectDir, { recursive: true, force: true });
});

function entry(files: string[]): ManifestEntry {
	return {
		ref: null,
		commit: "c",
		installedAt: "2026-01-01T00:00:00.000Z",
		files,
		cloneUrl: null,
	};
}

async function onDisk(file: string): Promise<void> {
	const full = join(projectDir, file, "SKILL.md");
	await mkdir(dirname(full), { recursive: true });
	await writeFile(full, "");
}

function clear(
	manifest: Manifest,
	policy: ConflictPolicy,
	incomingFiles = INCOMING,
) {
	return clearConflicts(
		{ incomingFiles, manifest, key: "owner/repo/a", projectDir },
		policy,
		ui,
	);
}

describe("conflictPolicy", () => {
	it.each([
		[true, "interactive", "overwrite"],
		[true, "machine", "overwrite"],
		[false, "interactive", "ask"],
		[false, "machine", "stop"],
	] as const)("with --overwrite %s in %s mode is %s", (overwrite, mode, policy) => {
		expect(conflictPolicy(overwrite, mode)).toBe(policy);
	});
});

describe("clearConflicts", () => {
	describe("against another entry's files", () => {
		const manifest: Manifest = { "other/repo": entry(INCOMING) };

		beforeEach(async () => {
			await onDisk(".claude/skills/a/");
		});

		it("removes that entry and its files when overwriting", async () => {
			const cleared = await clear(manifest, "overwrite");

			expect(cleared).toEqual({ manifest: {}, stop: null });
			expect(mockResolveCollisions).not.toHaveBeenCalled();
		});

		it("asks when it may", async () => {
			mockResolveCollisions.mockResolvedValue({
				resolved: false,
				updatedManifest: manifest,
			});

			const cleared = await clear(manifest, "ask");

			expect(cleared.stop).toEqual({
				status: "skipped",
				reason: "conflict not resolved",
			});
			expect(mockResolveCollisions).toHaveBeenCalledOnce();
		});

		it("stops the item, naming the owner, the files and --overwrite", async () => {
			const cleared = await clear(manifest, "stop");

			expect(cleared).toEqual({
				manifest,
				stop: {
					status: "skipped",
					reason: "files in the way belong to other/repo: .claude/skills/a/",
					flags: ["--overwrite"],
				},
			});
		});
	});

	describe("against files agntc didn't install", () => {
		beforeEach(async () => {
			await onDisk(".claude/skills/a/");
		});

		it("lets them be replaced when overwriting", async () => {
			expect(await clear({}, "overwrite")).toEqual({
				manifest: {},
				stop: null,
			});
			expect(mockResolveUnmanaged).not.toHaveBeenCalled();
		});

		it("asks when it may", async () => {
			mockResolveUnmanaged.mockResolvedValue({
				approved: INCOMING,
				cancelled: [],
			});

			expect((await clear({}, "ask")).stop).toBeNull();
			expect(mockResolveUnmanaged).toHaveBeenCalledWith(
				[{ pluginKey: "owner/repo/a", files: INCOMING }],
				ui,
			);
		});

		it("stops the item, naming the files and --overwrite", async () => {
			expect((await clear({}, "stop")).stop).toEqual({
				status: "skipped",
				reason:
					"files in the way weren't installed by agntc: .claude/skills/a/",
				flags: ["--overwrite"],
			});
		});
	});

	describe("replacing what's in the way", () => {
		let mine: string;

		beforeEach(async () => {
			mine = await mkdtemp(join(tmpdir(), "agntc-conflicts-mine-"));
			await writeFile(join(mine, "SKILL.md"), "mine");
			await mkdir(join(projectDir, ".claude/skills"), { recursive: true });
		});

		afterEach(async () => {
			await rm(mine, { recursive: true, force: true });
		});

		async function linkToMine(): Promise<void> {
			await symlink(mine, join(projectDir, ".claude/skills/a"));
		}

		async function gone(): Promise<boolean> {
			return (
				(await lstat(join(projectDir, ".claude/skills/a")).catch(
					() => null,
				)) === null
			);
		}

		it("removes a folder agntc didn't install when overwriting, rather than merging into it", async () => {
			await onDisk(".claude/skills/a/");

			await clear({}, "overwrite");

			expect(await gone()).toBe(true);
		});

		it("removes it once the prompt approves", async () => {
			await onDisk(".claude/skills/a/");
			mockResolveUnmanaged.mockResolvedValue({
				approved: INCOMING,
				cancelled: [],
			});

			await clear({}, "ask");

			expect(await gone()).toBe(true);
		});

		it("leaves it when the prompt cancels", async () => {
			await onDisk(".claude/skills/a/");
			mockResolveUnmanaged.mockResolvedValue({
				approved: [],
				cancelled: INCOMING,
			});

			await clear({}, "ask");

			expect(await gone()).toBe(false);
		});

		describe("a real folder at an agent or hook file target", () => {
			const FILE_TARGETS = [".claude/agents/foo.md", ".claude/hooks/x.sh"];

			beforeEach(async () => {
				for (const target of FILE_TARGETS) {
					await onDisk(target);
				}
			});

			async function targetsGone(): Promise<boolean[]> {
				return Promise.all(
					FILE_TARGETS.map(async (target) =>
						lstat(join(projectDir, target)).then(
							() => false,
							() => true,
						),
					),
				);
			}

			it("is removed when overwriting", async () => {
				expect(await clear({}, "overwrite", FILE_TARGETS)).toEqual({
					manifest: {},
					stop: null,
				});

				expect(await targetsGone()).toEqual([true, true]);
			});

			it("is removed once the prompt approves", async () => {
				mockResolveUnmanaged.mockResolvedValue({
					approved: FILE_TARGETS,
					cancelled: [],
				});

				expect((await clear({}, "ask", FILE_TARGETS)).stop).toBeNull();

				expect(await targetsGone()).toEqual([true, true]);
			});
		});

		it("unlinks a link at an agent file target, leaving the file it points to", async () => {
			const agent = ".claude/agents/foo.md";
			await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
			await symlink(join(mine, "SKILL.md"), join(projectDir, agent));

			await clear({}, "overwrite", [agent]);

			expect(await lstat(join(projectDir, agent)).catch(() => null)).toBeNull();
			expect(await readFile(join(mine, "SKILL.md"), "utf-8")).toBe("mine");
		});

		it("unlinks a link agntc didn't install, leaving what it points to", async () => {
			await linkToMine();

			expect(await clear({}, "overwrite")).toEqual({
				manifest: {},
				stop: null,
			});

			expect(await gone()).toBe(true);
			expect(await readFile(join(mine, "SKILL.md"), "utf-8")).toBe("mine");
		});

		it("unlinks another entry's recorded path that is a link, leaving what it points to", async () => {
			await linkToMine();

			expect(
				await clear({ "other/repo": entry(INCOMING) }, "overwrite"),
			).toEqual({ manifest: {}, stop: null });

			expect(await gone()).toBe(true);
			expect(await readFile(join(mine, "SKILL.md"), "utf-8")).toBe("mine");
		});
	});

	describe("a removal that fails", () => {
		const EACCES = new Error("EACCES: permission denied");
		const FAILED = {
			status: "failed",
			reason: "couldn't clear the files in its way: EACCES: permission denied",
		};
		const one = entry([".claude/skills/a/"]);
		const two = entry([".claude/skills/b/"]);

		async function present(path: string): Promise<boolean> {
			return lstat(join(projectDir, path)).then(
				() => true,
				() => false,
			);
		}

		it("fails the item, still dropping the entry a collision removed before it", async () => {
			await onDisk(".claude/skills/a/");
			await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
			await writeFile(join(projectDir, ".claude/agents/x.md"), "mine");
			mockRemovePaths.mockRejectedValueOnce(EACCES);

			const cleared = await clear({ "other/one": one }, "overwrite", [
				".claude/skills/a/",
				".claude/agents/x.md",
			]);

			expect(cleared).toEqual({ manifest: {}, stop: FAILED });
			expect(await present(".claude/skills/a")).toBe(false);
			expect(await present(".claude/agents/x.md")).toBe(true);
		});

		it("keeps an entry whose removal failed, dropping those removed before it", async () => {
			await onDisk(".claude/skills/a/");
			await onDisk(".claude/skills/b/");
			mockNuke
				.mockImplementationOnce(actualNuke.nukeManifestFiles)
				.mockRejectedValueOnce(EACCES);

			const cleared = await clear(
				{ "other/one": one, "other/two": two },
				"overwrite",
				[".claude/skills/a/", ".claude/skills/b/"],
			);

			expect(cleared).toEqual({
				manifest: { "other/two": two },
				stop: FAILED,
			});
			expect(await present(".claude/skills/a")).toBe(false);
			expect(await present(".claude/skills/b")).toBe(true);
		});

		it("keeps what the prompt's removals left recorded", async () => {
			await onDisk(".claude/skills/a/");
			mockResolveCollisions.mockRejectedValueOnce(
				new PartialRemovalError({ "other/two": two }, EACCES),
			);

			const cleared = await clear(
				{ "other/one": one, "other/two": two },
				"ask",
				[".claude/skills/a/", ".claude/skills/b/"],
			);

			expect(cleared).toEqual({
				manifest: { "other/two": two },
				stop: FAILED,
			});
		});

		it("lets a command's exit through rather than failing the item", async () => {
			await onDisk(".claude/skills/a/");
			const exit = new ExitSignal(1);
			mockResolveCollisions.mockRejectedValueOnce(exit);

			await expect(clear({ "other/one": one }, "ask")).rejects.toBe(exit);
		});
	});

	it("lets an item through with nothing in its way, whatever the policy", async () => {
		for (const policy of ["overwrite", "ask", "stop"] as const) {
			expect(await clear({}, policy)).toEqual({ manifest: {}, stop: null });
		}
		expect(mockResolveCollisions).not.toHaveBeenCalled();
		expect(mockResolveUnmanaged).not.toHaveBeenCalled();
	});
});

import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestEntry } from "../src/manifest.js";
import { makeEntry } from "./helpers/factories.js";

vi.mock("../src/fs-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/fs-utils.js")>()),
	pathExists: vi.fn(),
}));

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/copy-pack.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/copy-pack.js")>()),
	copyPack: vi.fn(),
}));

vi.mock("../src/discover.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/discover.js")>()),
	discover: vi.fn(),
}));

vi.mock("../src/copy-bare-skill.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/copy-bare-skill.js")>()),
	copyBareSkill: vi.fn(),
}));

vi.mock("../src/copy-safety.js", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/copy-safety.js")>();
	const { mockCopySafety } = await import("./helpers/copy-safety-mock.js");
	return {
		...actual,
		assertSubpathWithinClone: vi.fn(),
		...mockCopySafety(actual.SymlinkEscapeError),
	};
});

vi.mock("../src/unmanaged-check.js", () => ({
	checkUnmanagedConflicts: vi.fn(),
}));

import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPack } from "../src/copy-pack.js";
import {
	assertSubpathWithinClone,
	inspectSourcePath,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import {
	type Discovery,
	discover,
	type FoundPack,
	type FoundSkill,
	PackConflictError,
	StartPathError,
} from "../src/discover.js";
import { pathExists } from "../src/fs-utils.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import {
	executeNukeAndReinstall,
	type NukeReinstallOptions,
	type NukeReinstallResult,
	sourceWalk,
} from "../src/nuke-reinstall-pipeline.js";
import { globalScope, projectScope } from "../src/scope.js";
import { checkUnmanagedConflicts } from "../src/unmanaged-check.js";

const mockPathExists = vi.mocked(pathExists);
const mockCheckUnmanaged = vi.mocked(checkUnmanagedConflicts);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPack = vi.mocked(copyPack);
const mockDiscover = vi.mocked(discover);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);
const mockAssertSubpathWithinClone = vi.mocked(assertSubpathWithinClone);
const mockInspectSourcePath = vi.mocked(inspectSourcePath);
const actualCopySafety = await vi.importActual<
	typeof import("../src/copy-safety.js")
>("../src/copy-safety.js");
const { discover: actualDiscover } =
	await vi.importActual<typeof import("../src/discover.js")>(
		"../src/discover.js",
	);
const { pathExists: actualPathExists } =
	await vi.importActual<typeof import("../src/fs-utils.js")>(
		"../src/fs-utils.js",
	);

function makeOptions(
	overrides: Partial<NukeReinstallOptions> = {},
): NukeReinstallOptions {
	return {
		key: "owner/repo",
		sourceDir: "/tmp/source",
		cloneRoot: "/tmp/source",
		existingEntry: makeEntry({ type: "skill" }),
		installed: {},
		scope: projectScope("/fake/project"),
		...overrides,
	};
}

function looseSkills(...skills: FoundSkill[]): Discovery {
	return { packs: [], skills, strays: [] };
}

function foundPack(overrides: Partial<FoundPack> = {}): FoundPack {
	return {
		name: "laravel",
		path: "laravel",
		skills: [{ name: "api", path: "laravel/skills/api" }],
		supportFolders: [],
		assetDirs: [],
		...overrides,
	};
}

function onlyPack(pack: FoundPack): Discovery {
	return { packs: [pack], skills: [], strays: [] };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockPathExists.mockResolvedValue(true);
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
	mockInspectSourcePath.mockResolvedValue({ kind: "directory" });
	mockDiscover.mockResolvedValue(onlyPack(foundPack()));
	mockCopyPack.mockResolvedValue({ copiedFiles: [], assetCounts: {} });
	mockCheckUnmanaged.mockResolvedValue([]);
});

describe("executeNukeAndReinstall", () => {
	describe("recorded-skill replay", () => {
		it("replays recorded skill: checks SKILL.md, nukes, copies via copyBareSkill, returns entry", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("success");
			if (result.status !== "success") return;

			expect(mockPathExists).toHaveBeenCalledWith("/tmp/source/SKILL.md");
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: "/tmp/source",
					projectDir: "/fake/project",
				}),
			);
			expect(mockCopyPack).not.toHaveBeenCalled();
			expect(result.entry.files).toEqual([".claude/skills/my-skill/"]);
			expect(result.copiedFiles).toEqual([".claude/skills/my-skill/"]);
		});

		it("re-copies a root skill under the repo's name, not basename(sourceDir)", async () => {
			// Regression: on update/change-version the sourceDir is the random mkdtemp
			// clone dir, so a root skill must take its name from the repo, as add
			// names it (owner/repo → "repo"), not basename(tempDir) — otherwise the
			// skill (and the recorded files) land under a garbage temp-dir name.
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});

			await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo",
					sourceDir: "/tmp/agntc-Xy12ab",
					cloneRoot: "/tmp/agntc-Xy12ab",
				}),
			);

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: "/tmp/agntc-Xy12ab",
					skillName: "repo",
				}),
			);
		});

		it("uses the member basename as the skill name for a keyed member", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/alpha/"],
			});

			await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/alpha",
					sourceDir: "/tmp/agntc-Xy/skills/alpha",
					cloneRoot: "/tmp/agntc-Xy",
				}),
			);

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ skillName: "alpha" }),
			);
		});

		it("replays a skill as a skill, never re-walking it as a pack", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("success");
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
			expect(mockDiscover).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("preserves recorded type on the rewritten entry", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(result.entry.type).toBe("skill");
		});
	});

	describe("recorded-pack replay", () => {
		const PACK_ENTRY = makeEntry({
			type: "pack",
			files: [".claude/skills/old/", ".claude/agents/old.md"],
		});

		function packOptions(overrides: Partial<NukeReinstallOptions> = {}) {
			return makeOptions({
				key: "owner/repo/laravel",
				sourceDir: "/tmp/clone/laravel",
				cloneRoot: "/tmp/clone",
				existingEntry: PACK_ENTRY,
				...overrides,
			});
		}

		it("re-walks the pack from the clone root at its path, forcing a pack, the root named after the repo", async () => {
			await executeNukeAndReinstall(packOptions());

			expect(mockDiscover).toHaveBeenCalledWith("/tmp/clone", {
				startPath: "laravel",
				forcePack: true,
				rootName: "repo",
			});
		});

		it("walks a root pack from the root, named after the repo", async () => {
			await executeNukeAndReinstall(
				packOptions({
					key: "owner/repo",
					sourceDir: "/tmp/clone",
				}),
			);

			expect(mockDiscover).toHaveBeenCalledWith("/tmp/clone", {
				startPath: "",
				forcePack: true,
				rootName: "repo",
			});
		});

		it("nukes the recorded files and copies everything the pack holds now", async () => {
			const current = foundPack({
				skills: [
					{ name: "kept", path: "laravel/skills/kept" },
					{ name: "added", path: "laravel/skills/added" },
				],
			});
			mockDiscover.mockResolvedValue(onlyPack(current));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/kept/", ".claude/skills/added/"],
				assetCounts: { skills: 2 },
			});

			const result = await executeNukeAndReinstall(packOptions());

			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				PACK_ENTRY.files,
			);
			expect(mockCopyPack).toHaveBeenCalledWith(
				current,
				{ root: "/tmp/clone", local: false },
				"/fake/project",
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: "success",
				copiedFiles: [".claude/skills/kept/", ".claude/skills/added/"],
				entry: {
					type: "pack",
					files: [".claude/skills/kept/", ".claude/skills/added/"],
				},
				notes: [],
				absorbed: [],
			});
		});

		it("re-walks before removing anything", async () => {
			const callOrder: string[] = [];
			mockDiscover.mockImplementation(async () => {
				callOrder.push("walk");
				return onlyPack(foundPack());
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});
			mockCopyPack.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [], assetCounts: {} };
			});

			await executeNukeAndReinstall(packOptions());

			expect(callOrder).toEqual(["walk", "nuke", "copy"]);
		});

		it("reinstalls a path that is now a single skill as a skill, with a note", async () => {
			mockDiscover.mockRejectedValue(
				new PackConflictError('"laravel" is a single skill', "single-skill"),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/laravel/"],
			});
			const v1BugEntry = makeEntry({
				type: "pack",
				files: [".claude/agents/openai.yaml"],
				sourceSubpath: undefined,
			});

			const result = await executeNukeAndReinstall(
				packOptions({ existingEntry: v1BugEntry }),
			);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/agents/openai.yaml",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/tmp/clone/laravel",
				source: { root: "/tmp/clone", local: false },
				projectDir: "/fake/project",
				skillName: "laravel",
			});
			expect(mockCopyPack).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/laravel",
				notes: [
					"owner/repo/laravel is a single skill — reinstalled as a skill",
				],
				entry: { type: "skill", files: [".claude/skills/laravel/"] },
			});
		});

		it("keeps the entry's sourceSubpath when it becomes a skill", async () => {
			mockDiscover.mockRejectedValue(
				new PackConflictError("single", "single-skill"),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/laravel/"],
			});

			const result = await executeNukeAndReinstall(
				packOptions({
					existingEntry: makeEntry({
						type: "pack",
						sourceSubpath: "plugins/laravel",
					}),
					sourceDir: "/tmp/clone/plugins/laravel",
				}),
			);

			expect(result).toMatchObject({
				entry: { type: "skill", sourceSubpath: "plugins/laravel" },
			});
		});

		it("aborts, leaving the install intact, when its folder now contains packs", async () => {
			mockDiscover.mockRejectedValue(
				new PackConflictError("contains packs", "contains-packs"),
			);

			const result = await executeNukeAndReinstall(packOptions());

			expect(result).toEqual({
				status: "aborted",
				reason: "its folder now contains packs",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("is gone upstream, leaving the install intact, when the re-walk finds nothing", async () => {
			mockDiscover.mockResolvedValue(onlyPack(foundPack({ skills: [] })));

			const result = await executeNukeAndReinstall(packOptions());

			expect(result).toEqual({ status: "gone" });
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("still reinstalls a pack left with only agents or hooks", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(foundPack({ skills: [], assetDirs: ["hooks"] })),
			);

			const result = await executeNukeAndReinstall(packOptions());

			expect(result.status).toBe("success");
		});

		it("aborts, leaving the install intact, when two of its skills share a folder name", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(
					foundPack({
						skills: [
							{ name: "api", path: "laravel/skills/api" },
							{ name: "lint", path: "laravel/skills/a/lint" },
							{ name: "lint", path: "laravel/tools/lint" },
						],
					}),
				),
			);

			const result = await executeNukeAndReinstall(packOptions());

			expect(result).toEqual({
				status: "aborted",
				reason:
					"laravel/skills/a/lint and laravel/tools/lint would both install to .claude/skills/lint",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("still reinstalls a pack left with only support folders", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(
					foundPack({
						skills: [],
						supportFolders: [{ name: "shared", path: "laravel/skills/shared" }],
					}),
				),
			);

			const result = await executeNukeAndReinstall(packOptions());

			expect(result.status).toBe("success");
		});

		it("aborts, leaving the install intact, when a skill and a support folder share a folder name", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(
					foundPack({
						skills: [{ name: "shared", path: "laravel/skills/cat/shared" }],
						supportFolders: [{ name: "shared", path: "laravel/skills/shared" }],
					}),
				),
			);

			const result = await executeNukeAndReinstall(packOptions());

			expect(result).toEqual({
				status: "aborted",
				reason:
					"laravel/skills/cat/shared and laravel/skills/shared would both install to .claude/skills/shared",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("is gone upstream, leaving the install intact, when its path is missing", async () => {
			mockDiscover.mockRejectedValue(
				new StartPathError('path "laravel" not found in source'),
			);

			const result = await executeNukeAndReinstall(packOptions());

			expect(result).toEqual({ status: "gone" });
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockScanForEscapingSymlinks).not.toHaveBeenCalled();
		});

		it("lets any other walk error through", async () => {
			mockDiscover.mockRejectedValue(new Error("EACCES"));

			await expect(executeNukeAndReinstall(packOptions())).rejects.toThrow(
				"EACCES",
			);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("a symlink at or above the recorded path", () => {
		let base: string;
		let clone: string;

		beforeEach(async () => {
			mockInspectSourcePath.mockImplementation(
				actualCopySafety.inspectSourcePath,
			);
			base = await realpath(
				await mkdtemp(join(tmpdir(), "agntc-pipeline-link-")),
			);
			clone = join(base, "clone");
			await mkdir(join(base, "outside/foo"), { recursive: true });
			await writeFile(join(base, "outside/foo/SKILL.md"), "outside");
			await mkdir(join(clone, "real/foo"), { recursive: true });
			await writeFile(join(clone, "real/foo/SKILL.md"), "inside");
		});

		afterEach(async () => {
			await rm(base, { recursive: true, force: true });
		});

		function skillOptions(): NukeReinstallOptions {
			return makeOptions({
				key: "owner/repo/foo",
				sourceDir: join(clone, "skills/foo"),
				cloneRoot: clone,
				existingEntry: makeEntry({
					type: "skill",
					files: [".claude/skills/foo/"],
					sourceSubpath: "skills/foo",
				}),
			});
		}

		function blockedOn(link: string, path: string): NukeReinstallResult {
			return {
				status: "blocked",
				reason: `symlink "${link}" is on the path to ${path} — agntc won't copy through it`,
			};
		}

		function expectNothingRead(): void {
			expect(mockPathExists).not.toHaveBeenCalled();
			expect(mockDiscover).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		}

		it("blocks a skill reached through a folder linked outside the clone", async () => {
			await symlink(join(base, "outside"), join(clone, "skills"));

			const result = await executeNukeAndReinstall(skillOptions());

			expect(result).toEqual(blockedOn("skills", "skills/foo"));
			expectNothingRead();
		});

		it("blocks a skill whose own folder is a link, even one inside the clone", async () => {
			await mkdir(join(clone, "skills"));
			await symlink("../real/foo", join(clone, "skills/foo"));

			const result = await executeNukeAndReinstall(skillOptions());

			expect(result).toEqual(blockedOn("skills/foo", "skills/foo"));
			expectNothingRead();
		});

		it("blocks a pack whose folder is a link, rather than calling it gone", async () => {
			await symlink("real", join(clone, "tools"));

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/tools",
					sourceDir: join(clone, "tools"),
					cloneRoot: clone,
					existingEntry: makeEntry({ type: "pack" }),
				}),
			);

			expect(result).toEqual(blockedOn("tools", "tools"));
			expectNothingRead();
		});
	});

	describe("a skill whose recorded path no longer holds one", () => {
		const MEMBER = {
			key: "owner/repo/go",
			sourceDir: "/tmp/clone/skills/go",
			cloneRoot: "/tmp/clone",
			existingEntry: makeEntry({
				type: "skill",
				files: [".claude/skills/go/"],
				sourceSubpath: "skills/go",
			}),
		};

		beforeEach(() => {
			mockPathExists.mockResolvedValue(false);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});
		});

		it("re-walks the whole source from its root, named after the repo", async () => {
			mockDiscover.mockResolvedValue(looseSkills());

			await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(mockPathExists).toHaveBeenCalledWith(
				"/tmp/clone/skills/go/SKILL.md",
			);
			expect(mockDiscover).toHaveBeenCalledWith("/tmp/clone", {
				rootName: "repo",
			});
		});

		it("follows the one skill of that name, recording its new path and a note", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills(
					{ name: "go", path: "lang/go" },
					{ name: "rust", path: "lang/rust" },
				),
			);

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/tmp/clone/lang/go",
				source: { root: "/tmp/clone", local: false },
				projectDir: "/fake/project",
				skillName: "go",
			});
			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/go",
				entry: { type: "skill", sourceSubpath: "lang/go" },
				notes: ["owner/repo/go moved from skills/go to lang/go"],
			});
		});

		it("follows a skill that moved into a pack, installing it on its own", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(
					foundPack({
						path: "tools",
						skills: [{ name: "go", path: "tools/skills/go" }],
					}),
				),
			);

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(mockCopyPack).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: "/tmp/clone/tools/skills/go" }),
			);
			expect(result).toMatchObject({
				status: "success",
				entry: { type: "skill", sourceSubpath: "tools/skills/go" },
			});
		});

		it("never follows a pack's support folder of that name, which isn't a skill", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(
					foundPack({
						path: "tools",
						skills: [],
						supportFolders: [{ name: "go", path: "tools/skills/go" }],
					}),
				),
			);

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(result).toEqual({ status: "gone" });
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("drops the recorded path when the skill moved to where its key points", async () => {
			mockDiscover.mockResolvedValue(looseSkills({ name: "go", path: "go" }));

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(result.entry).not.toHaveProperty("sourceSubpath");
		});

		it("follows a root skill that moved below the root, keying it by its folder as add would", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "repo", path: "skills/repo" }),
			);

			const result = await executeNukeAndReinstall(
				makeOptions({ cloneRoot: "/tmp/clone", sourceDir: "/tmp/clone" }),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/repo",
				entry: { sourceSubpath: "skills/repo" },
				notes: [
					"owner/repo moved from repo to skills/repo, now keyed owner/repo/repo",
				],
			});
		});

		it("scans the folder it follows for escaping symlinks", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "go", path: "lang/go" }),
			);

			await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
				"/tmp/clone/lang/go",
				{ root: "/tmp/clone", local: false },
				expect.any(Function),
			);
		});

		it("matches on folder name only, not a frontmatter name", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "golang", path: "golang", frontmatterName: "go" }),
			);

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(result).toEqual({ status: "gone" });
		});

		it("is gone upstream when no skill has its name, touching nothing", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "rust", path: "rust" }),
			);

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(result).toEqual({ status: "gone" });
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockScanForEscapingSymlinks).not.toHaveBeenCalled();
		});

		it("aborts, touching nothing, when several skills now have its name, listing their paths", async () => {
			mockDiscover.mockResolvedValue({
				packs: [
					foundPack({
						path: "tools",
						skills: [{ name: "go", path: "tools/go" }],
					}),
				],
				skills: [{ name: "go", path: "lang/go" }],
				strays: [],
			});

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(result).toEqual({
				status: "aborted",
				reason:
					"its SKILL.md is gone from skills/go and 2 skills are now named go: lang/go, tools/go",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("keys a moved local skill below the folder it was walked from, as add would", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "go", path: "lang/go" }),
			);

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "/src/kit/go",
					sourceDir: "/src/kit/go",
					cloneRoot: "/src/kit/go",
					existingEntry: makeEntry({ type: "skill", commit: null }),
				}),
			);

			expect(mockDiscover).toHaveBeenCalledWith("/src/kit/go", {
				rootName: "go",
			});
			expect(result).toMatchObject({
				status: "success",
				key: "/src/kit/go/go",
				entry: { sourceSubpath: "lang/go" },
			});
		});

		it("on success validation runs before nuke (ordering: validate then nuke then copy)", async () => {
			const callOrder: string[] = [];
			mockPathExists.mockImplementation(async () => {
				callOrder.push("validate");
				return true;
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-skill/"] };
			});

			await executeNukeAndReinstall(makeOptions());

			expect(callOrder).toEqual(["validate", "nuke", "copy"]);
		});

		it("re-walks for a moved skill before removing anything", async () => {
			const callOrder: string[] = [];
			mockDiscover.mockImplementation(async () => {
				callOrder.push("walk");
				return looseSkills({ name: "go", path: "lang/go" });
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});

			await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(callOrder).toEqual(["walk", "nuke"]);
		});

		it("follows a moved skill through the walk it is given", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "go", path: "lang/go" }),
			);
			const walk = sourceWalk("/tmp/clone");
			await walk("repo");

			const result = await executeNukeAndReinstall(
				makeOptions({ ...MEMBER, walk }),
			);

			expect(mockDiscover).toHaveBeenCalledTimes(1);
			expect(result).toMatchObject({
				status: "success",
				entry: { sourceSubpath: "lang/go" },
			});
		});

		it("walks on its own when given no walk, sharing nothing with another reinstall", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "go", path: "lang/go" }),
			);

			await executeNukeAndReinstall(makeOptions(MEMBER));
			await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(mockDiscover).toHaveBeenCalledTimes(2);
		});
	});

	describe("the key add gives what it replays", () => {
		const PACK_KEY = "owner/repo/packs/foo";
		const PACK_ENTRY = makeEntry({
			type: "pack",
			files: [".claude/skills/a/", ".claude/skills/b/"],
		});

		function retypedOptions(
			overrides: Partial<NukeReinstallOptions> = {},
		): NukeReinstallOptions {
			return makeOptions({
				key: PACK_KEY,
				sourceDir: "/tmp/clone/packs/foo",
				cloneRoot: "/tmp/clone",
				existingEntry: PACK_ENTRY,
				installed: { [PACK_KEY]: PACK_ENTRY },
				...overrides,
			});
		}

		beforeEach(() => {
			mockDiscover.mockRejectedValue(
				new PackConflictError("single", "single-skill"),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
			});
		});

		it("moves a pack whose path is now a single skill to the skill's key, with one note naming both", async () => {
			const result = await executeNukeAndReinstall(retypedOptions());

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/foo",
				entry: { type: "skill", sourceSubpath: "packs/foo" },
				notes: [
					"owner/repo/packs/foo is a single skill — reinstalled as a skill, now keyed owner/repo/foo",
				],
			});
		});

		it("moves a local pack to the skill's key below its recorded root, keeping the root", async () => {
			const entry = makeEntry({
				type: "pack",
				commit: null,
				localRoot: "/src/kit",
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "/src/kit/packs/foo",
					sourceDir: "/src/kit/packs/foo",
					cloneRoot: "/src/kit",
					existingEntry: entry,
				}),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "/src/kit/foo",
				entry: { sourceSubpath: "packs/foo", localRoot: "/src/kit" },
			});
		});

		it("re-keys a skill still recorded under a pack's path, with a note naming both", async () => {
			mockPathExists.mockResolvedValue(true);

			const result = await executeNukeAndReinstall(
				retypedOptions({ existingEntry: makeEntry({ type: "skill" }) }),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/foo",
				entry: { type: "skill", sourceSubpath: "packs/foo" },
				notes: ["owner/repo/packs/foo is now keyed owner/repo/foo"],
			});
		});

		it("re-keys a pack recorded by name with a path to the path that keys a pack, absorbing under that key", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(foundPack({ path: "plugins/laravel" })),
			);
			const loose = makeEntry({
				type: "skill",
				files: [".claude/skills/api/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/laravel",
					sourceDir: "/tmp/clone/plugins/laravel",
					cloneRoot: "/tmp/clone",
					existingEntry: makeEntry({
						type: "pack",
						files: [],
						sourceSubpath: "plugins/laravel",
					}),
					installed: { "owner/repo/api": loose },
				}),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/plugins/laravel",
				absorbed: ["owner/repo/api"],
				notes: [
					"owner/repo/laravel is now keyed owner/repo/plugins/laravel",
					"owner/repo/plugins/laravel now includes api, installed on its own before",
				],
			});
			if (result.status !== "success") return;
			expect(result.entry).not.toHaveProperty("sourceSubpath");
		});

		it("keys a loose skill that moved to the root as the source itself", async () => {
			mockPathExists.mockResolvedValue(false);
			mockDiscover.mockResolvedValue(looseSkills({ name: "repo", path: "" }));

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/repo",
					sourceDir: "/tmp/clone/skills/repo",
					cloneRoot: "/tmp/clone",
					existingEntry: makeEntry({
						type: "skill",
						sourceSubpath: "skills/repo",
					}),
				}),
			);

			expect(result).toMatchObject({ status: "success", key: "owner/repo" });
			if (result.status !== "success") return;
			expect(result.entry).not.toHaveProperty("sourceSubpath");
		});

		it("names a pack recorded by name, now a single skill, by its folder: where it installs and how it's keyed", async () => {
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/my-plugin",
					sourceDir: "/tmp/clone/plugins/foo",
					cloneRoot: "/tmp/clone",
					existingEntry: makeEntry({
						type: "pack",
						sourceSubpath: "plugins/foo",
						files: [".claude/skills/a/"],
					}),
				}),
			);

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ skillName: "foo" }),
			);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/a/",
			]);
			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/foo",
				entry: {
					type: "skill",
					sourceSubpath: "plugins/foo",
					files: [".claude/skills/foo/"],
				},
			});
		});

		it("names a skill recorded under a key that isn't its folder by the folder, removing the old install", async () => {
			mockPathExists.mockResolvedValue(true);

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/my-plugin",
					sourceDir: "/tmp/clone/plugins/foo",
					cloneRoot: "/tmp/clone",
					existingEntry: makeEntry({
						type: "skill",
						sourceSubpath: "plugins/foo",
						files: [".claude/skills/my-plugin/"],
					}),
				}),
			);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-plugin/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ skillName: "foo" }),
			);
			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/foo",
				entry: { sourceSubpath: "plugins/foo", files: [".claude/skills/foo/"] },
				notes: ["owner/repo/my-plugin is now keyed owner/repo/foo"],
			});
		});

		it("looks for a moved skill by its folder's name, not its key's", async () => {
			mockPathExists.mockResolvedValue(false);
			mockDiscover.mockResolvedValue(
				looseSkills(
					{ name: "my-plugin", path: "my-plugin" },
					{ name: "foo", path: "skills/foo" },
				),
			);

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/my-plugin",
					sourceDir: "/tmp/clone/plugins/foo",
					cloneRoot: "/tmp/clone",
					existingEntry: makeEntry({
						type: "skill",
						sourceSubpath: "plugins/foo",
					}),
				}),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/foo",
				entry: { sourceSubpath: "skills/foo" },
			});
		});

		it("moves onto a key held by a loose skill from its source that it takes over", async () => {
			mockDiscover.mockResolvedValue(
				onlyPack(
					foundPack({
						path: "packs/tools",
						skills: [
							{ name: "a", path: "packs/tools/skills/a" },
							{ name: "tools", path: "packs/tools/skills/tools" },
						],
					}),
				),
			);
			const pack = makeEntry({
				type: "pack",
				sourceSubpath: "packs/tools",
				files: [".claude/skills/a/"],
			});
			const loose = makeEntry({ files: [".claude/skills/tools/"] });

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/tools",
					sourceDir: "/tmp/clone/packs/tools",
					cloneRoot: "/tmp/clone",
					existingEntry: pack,
					installed: {
						"owner/repo/tools": pack,
						"owner/repo/packs/tools": loose,
					},
				}),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/packs/tools",
				absorbed: ["owner/repo/packs/tools"],
			});
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/a/", ".claude/skills/tools/"],
			);
		});

		it("aborts before removing anything when another entry holds the key it would move to", async () => {
			const other = makeEntry({ type: "pack", files: [".claude/skills/x/"] });

			const result = await executeNukeAndReinstall(
				retypedOptions({
					installed: { [PACK_KEY]: PACK_ENTRY, "owner/repo/foo": other },
				}),
			);

			expect(result).toEqual({
				status: "aborted",
				reason: "it would move to owner/repo/foo, which is already installed",
				takenKey: "owner/repo/foo",
				replayed: {
					key: "owner/repo/foo",
					entry: expect.objectContaining({
						type: "skill",
						sourceSubpath: "packs/foo",
						files: [],
					}),
				},
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("carries the skill it now is, under its new key, when files are in its way", async () => {
			mockCheckUnmanaged.mockResolvedValue([".claude/skills/foo/"]);

			const result = await executeNukeAndReinstall(retypedOptions());

			expect(result).toEqual({
				status: "aborted",
				reason:
					"files agntc didn't install are in the way: .claude/skills/foo/",
				inTheWay: true,
				replayed: {
					key: "owner/repo/foo",
					entry: expect.objectContaining({
						type: "skill",
						sourceSubpath: "packs/foo",
					}),
				},
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("tells a copy failure to install it again as the skill it now is", async () => {
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeNukeAndReinstall(retypedOptions());

			expect(result).toMatchObject({
				status: "copy-failed",
				recoveryHint:
					"Update failed for owner/repo/packs/foo after removing old files. It is currently uninstalled. Run `npx agntc add owner/repo/packs/foo` to install it again.",
			});
		});
	});

	describe("what is in the way of the replayed item", () => {
		const PACK_KEY = "owner/repo/laravel";
		const PACK_ENTRY = makeEntry({
			type: "pack",
			files: [".claude/skills/api/"],
		});

		function packOptions(installed: Record<string, ManifestEntry>) {
			return makeOptions({
				key: PACK_KEY,
				sourceDir: "/tmp/clone/laravel",
				cloneRoot: "/tmp/clone",
				existingEntry: PACK_ENTRY,
				installed: { [PACK_KEY]: PACK_ENTRY, ...installed },
			});
		}

		beforeEach(() => {
			mockDiscover.mockResolvedValue(
				onlyPack(
					foundPack({
						skills: [
							{ name: "api", path: "laravel/skills/api" },
							{ name: "queues", path: "laravel/skills/queues" },
						],
					}),
				),
			);
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/api/", ".claude/skills/queues/"],
				assetCounts: { skills: 2 },
			});
		});

		it("checks every path the item would claim against the installed entries", async () => {
			const installed = { [PACK_KEY]: PACK_ENTRY };

			await executeNukeAndReinstall(packOptions({}));

			expect(mockCheckUnmanaged).toHaveBeenCalledWith(
				[".claude/skills/api/", ".claude/skills/queues/"],
				installed,
				"/fake/project",
			);
		});

		it("aborts, touching nothing, when files agntc didn't install sit at a new skill's target", async () => {
			mockCheckUnmanaged.mockResolvedValue([".claude/skills/queues/"]);

			const result = await executeNukeAndReinstall(packOptions({}));

			expect(result).toEqual({
				status: "aborted",
				reason:
					"files agntc didn't install are in the way: .claude/skills/queues/",
				inTheWay: true,
				replayed: expect.objectContaining({ key: PACK_KEY }),
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("aborts, naming the entry, when a different source's entry records a new skill's target", async () => {
			const other = makeEntry({
				type: "skill",
				files: [".claude/skills/queues/"],
				cloneUrl: "https://github.com/other/tools.git",
			});

			const result = await executeNukeAndReinstall(
				packOptions({ "other/tools/queues": other }),
			);

			expect(result).toEqual({
				status: "aborted",
				reason:
					"files of other/tools/queues are in the way: .claude/skills/queues/",
				inTheWay: true,
				replayed: expect.objectContaining({ key: PACK_KEY }),
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("absorbs a loose skill from its own source: removes its files, reports it, notes it", async () => {
			const loose = makeEntry({
				type: "skill",
				files: [".claude/skills/queues/"],
			});

			const result = await executeNukeAndReinstall(
				packOptions({ "owner/repo/queues": loose }),
			);

			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/api/", ".claude/skills/queues/"],
			);
			expect(result).toMatchObject({
				status: "success",
				absorbed: ["owner/repo/queues"],
				notes: [
					"owner/repo/laravel now includes queues, installed on its own before",
				],
			});
		});

		it("removes the absorbed skill's files before copying the pack over them", async () => {
			const callOrder: string[] = [];
			mockNukeManifestFiles.mockImplementation(async (_dir, files) => {
				callOrder.push(`nuke ${files.join(",")}`);
				return { removed: [], skipped: [] };
			});
			mockCopyPack.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [], assetCounts: {} };
			});

			await executeNukeAndReinstall(
				packOptions({
					"owner/repo/queues": makeEntry({
						type: "skill",
						files: [".claude/skills/queues/"],
					}),
				}),
			);

			expect(callOrder).toEqual([
				"nuke .claude/skills/api/,.claude/skills/queues/",
				"copy",
			]);
		});

		it("still reports what it took over when the copy then fails, naming it in the hint", async () => {
			mockCopyPack.mockRejectedValue(new Error("disk full"));

			const result = await executeNukeAndReinstall(
				packOptions({
					"owner/repo/queues": makeEntry({
						type: "skill",
						files: [".claude/skills/queues/"],
					}),
				}),
			);

			expect(result).toEqual({
				status: "copy-failed",
				errorMessage: "disk full",
				absorbed: ["owner/repo/queues"],
				recoveryHint:
					"Update failed for owner/repo/laravel after removing old files, and the skill it took over was removed: owner/repo/queues. It is currently uninstalled. Run `npx agntc add owner/repo/laravel --pack` to install it again.",
			});
		});

		it("reports a removal that fails part way, copying nothing and taking nothing over", async () => {
			mockNukeManifestFiles.mockRejectedValue(
				new Error("EISDIR: illegal operation on a directory"),
			);

			const result = await executeNukeAndReinstall(
				packOptions({
					"owner/repo/queues": makeEntry({
						type: "skill",
						files: [".claude/skills/queues/"],
					}),
				}),
			);

			expect(result).toEqual({
				status: "remove-failed",
				reason:
					"couldn't remove its old files: EISDIR: illegal operation on a directory",
			});
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("treats a same-source pack's files as a clash, not something to absorb", async () => {
			const sibling = makeEntry({
				type: "pack",
				files: [".claude/skills/queues/"],
			});

			const result = await executeNukeAndReinstall(
				packOptions({ "owner/repo/jobs": sibling }),
			);

			expect(result).toMatchObject({ status: "aborted", inTheWay: true });
		});

		it("never absorbs into a skill: a same-source loose skill at its target clashes", async () => {
			const sameName = makeEntry({
				type: "skill",
				files: [".claude/skills/repo/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({ installed: { "owner/repo/repo": sameName } }),
			);

			expect(result).toMatchObject({
				status: "aborted",
				reason: "files of owner/repo/repo are in the way: .claude/skills/repo/",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("reinstalls over the entry's own recorded files", async () => {
			const result = await executeNukeAndReinstall(
				packOptions({
					"owner/repo/laravel-copy": makeEntry({ files: [".claude/other/"] }),
				}),
			);

			expect(result.status).toBe("success");
			expect(result).toMatchObject({ absorbed: [], notes: [] });
		});
	});

	describe("a recorded skills folder the reinstall wouldn't write", () => {
		let clone: string;

		beforeEach(async () => {
			clone = await realpath(
				await mkdtemp(join(tmpdir(), "agntc-pipeline-dropped-")),
			);
			mockDiscover.mockImplementation(actualDiscover);
			mockPathExists.mockImplementation(actualPathExists);
		});

		afterEach(async () => {
			await rm(clone, { recursive: true, force: true });
		});

		async function upstream(...files: string[]): Promise<void> {
			for (const file of files) {
				await mkdir(dirname(join(clone, file)), { recursive: true });
				await writeFile(join(clone, file), "");
			}
		}

		function packOptions(files: string[]): NukeReinstallOptions {
			return makeOptions({
				key: "owner/repo/tools",
				sourceDir: join(clone, "tools"),
				cloneRoot: clone,
				existingEntry: makeEntry({ type: "pack", files }),
			});
		}

		function skillOptions(
			key: string,
			sourceSubpath: string,
			files: string[],
		): NukeReinstallOptions {
			return makeOptions({
				key,
				sourceDir: join(clone, sourceSubpath),
				cloneRoot: clone,
				existingEntry: makeEntry({ type: "skill", sourceSubpath, files }),
			});
		}

		function expectNothingRemoved(): void {
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		}

		it("aborts, removing nothing, when a pack would drop folders its source still has outside anything it installs", async () => {
			await upstream(
				"tools/skills/api/SKILL.md",
				"tools/shared/workflow-shared/references/casing.md",
				"tools/lib/deep/workflow-gates/hooks.json",
			);

			const result = await executeNukeAndReinstall(
				packOptions([
					".claude/skills/api/",
					".claude/skills/workflow-shared/",
					".claude/skills/workflow-shared/references/casing.md",
					".claude/skills/workflow-gates/",
				]),
			);

			expect(result).toEqual({
				status: "aborted",
				reason:
					"it would remove workflow-shared and workflow-gates, which are still in the source but would no longer be installed",
				stillInSource: true,
				replayed: {
					key: "owner/repo/tools",
					entry: expect.objectContaining({ type: "pack", files: [] }),
				},
			});
			expectNothingRemoved();
		});

		it("names a single folder it would drop as one", async () => {
			await upstream("tools/skills/api/SKILL.md", "tools/docs/shared/a.md");

			const result = await executeNukeAndReinstall(
				packOptions([".claude/skills/api/", ".claude/skills/shared/"]),
			);

			expect(result).toMatchObject({
				status: "aborted",
				reason:
					"it would remove shared, which is still in the source but would no longer be installed",
			});
			expectNothingRemoved();
		});

		it("aborts on a namesake holding a skill the pack doesn't install", async () => {
			await upstream(
				"tools/skills/api/SKILL.md",
				"tools/hooks/frontend/react/SKILL.md",
			);

			const result = await executeNukeAndReinstall(
				packOptions([".claude/skills/api/", ".claude/skills/frontend/"]),
			);

			expect(result).toMatchObject({ status: "aborted", stillInSource: true });
			expectNothingRemoved();
		});

		it("lets a category folder go when the pack installs the skills it holds", async () => {
			await upstream(
				"tools/skills/frontend/react/SKILL.md",
				"tools/skills/frontend/vue/SKILL.md",
			);
			const files = [
				".claude/skills/frontend/",
				".claude/skills/frontend/react/SKILL.md",
			];

			const result = await executeNukeAndReinstall(packOptions(files));

			expect(result.status).toBe("success");
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				files,
			);
		});

		it("lets a folder go when its name is gone from the pack, even if the repo has it elsewhere", async () => {
			await upstream("tools/skills/api/SKILL.md", "elsewhere/models/a.md");
			const files = [".claude/skills/api/", ".claude/skills/models/"];

			const result = await executeNukeAndReinstall(packOptions(files));

			expect(result.status).toBe("success");
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				files,
			);
		});

		it("never counts a hidden namesake, or one in a folder the walk skips", async () => {
			await upstream(
				"tools/skills/api/SKILL.md",
				"tools/.cache/models/a.md",
				"tools/node_modules/models/a.md",
				"tools/dist/models/a.md",
			);

			const result = await executeNukeAndReinstall(
				packOptions([".claude/skills/api/", ".claude/skills/models/"]),
			);

			expect(result.status).toBe("success");
		});

		it("never checks agents, hooks, legacy skill roots or loose files in .claude/skills", async () => {
			await upstream(
				"tools/skills/api/SKILL.md",
				"tools/agents/helpers/notes.txt",
				"tools/lib/a.sh",
				"tools/docs/extra/a.md",
				"tools/docs/notes/a.md",
			);
			const files = [
				".claude/skills/api/",
				".claude/agents/helpers/",
				".claude/hooks/lib/",
				".agents/skills/extra/",
				".cursor/skills/extra/",
				".claude/skills/notes",
			];

			const result = await executeNukeAndReinstall(packOptions(files));

			expect(result.status).toBe("success");
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				files,
			);
		});

		it("aborts a loose skill that would drop a folder still in its skill folder", async () => {
			await upstream("skills/foo/SKILL.md", "skills/foo/helpers/a.md");

			const result = await executeNukeAndReinstall(
				skillOptions("owner/repo/foo", "skills/foo", [
					".claude/skills/foo/",
					".claude/skills/helpers/",
				]),
			);

			expect(result).toEqual({
				status: "aborted",
				reason:
					"it would remove helpers, which is still in the source but would no longer be installed",
				stillInSource: true,
				replayed: {
					key: "owner/repo/foo",
					entry: expect.objectContaining({
						type: "skill",
						sourceSubpath: "skills/foo",
					}),
				},
			});
			expectNothingRemoved();
		});

		it("looks for a loose skill's dropped folder in its skill folder alone", async () => {
			await upstream("plugins/foo/SKILL.md", "docs/my-plugin/a.md");
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
			});

			const result = await executeNukeAndReinstall(
				skillOptions("owner/repo/my-plugin", "plugins/foo", [
					".claude/skills/my-plugin/",
				]),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "owner/repo/foo",
			});
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-plugin/",
			]);
		});

		it("never stops on a folder it writes again, whatever namesakes it holds", async () => {
			await upstream("tools/skills/api/SKILL.md", "tools/skills/api/api/a.md");

			const result = await executeNukeAndReinstall(
				packOptions([".claude/skills/api/"]),
			);

			expect(result.status).toBe("success");
		});
	});

	describe("legacy multi-agent entry", () => {
		const legacySkillFiles = [
			".claude/skills/my-skill/",
			".agents/skills/my-skill/",
			".cursor/skills/my-skill/",
		];

		it("nukes every recorded file, whatever its root, and reinstalls a skill into .claude only", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					existingEntry: makeEntry({ type: "skill", files: legacySkillFiles }),
				}),
			);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				legacySkillFiles,
			);
			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/tmp/source",
				source: { root: "/tmp/source", local: false },
				projectDir: "/fake/project",
				skillName: "repo",
			});
			expect(result.entry.files).toEqual([".claude/skills/repo/"]);
		});

		it("migrates a Codex-only v1 plugin entry into .claude as a pack", async () => {
			const codexFiles = [".agents/skills/a/", ".agents/skills/b/"];
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/a/", ".claude/skills/b/"],
				assetCounts: { skills: 2 },
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					existingEntry: makeEntry({ type: "pack", files: codexFiles }),
				}),
			);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				codexFiles,
			);
			expect(result.entry.files).toEqual([
				".claude/skills/a/",
				".claude/skills/b/",
			]);
		});

		it("writes the reinstalled entry without an agents field", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});
			const legacyEntry = {
				...makeEntry({ type: "skill", files: legacySkillFiles }),
				agents: ["claude", "codex", "cursor"],
			};

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: legacyEntry }),
			);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(result.entry).not.toHaveProperty("agents");
		});
	});

	describe("ref and commit overrides", () => {
		it("uses newRef and newCommit when provided", async () => {
			const options = makeOptions({
				newRef: "v2.0.0",
				newCommit: "b".repeat(40),
			});

			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(options);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;

			expect(result.entry.ref).toBe("v2.0.0");
			expect(result.entry.commit).toBe("b".repeat(40));
		});

		it("preserves existing entry ref/commit when overrides not provided", async () => {
			const options = makeOptions({
				existingEntry: makeEntry({
					type: "skill",
					ref: "v1.0",
					commit: "a".repeat(40),
				}),
			});

			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(options);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;

			expect(result.entry.ref).toBe("v1.0");
			expect(result.entry.commit).toBe("a".repeat(40));
		});
	});

	describe("copy failure after nuke", () => {
		it("returns copy-failed with recovery message when copyBareSkill throws", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockRejectedValue(
				new Error("ENOSPC: no space left on device"),
			);

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("copy-failed");
			if (result.status !== "copy-failed") return;

			expect(result.errorMessage).toBe("ENOSPC: no space left on device");
			expect(result.recoveryHint).toBe(
				"Update failed for owner/repo after removing old files. It is currently uninstalled. Run `npx agntc add owner/repo` to install it again.",
			);
		});

		it.each([
			{
				tracks: "a constraint",
				entry: { constraint: "^1.2.0", ref: "v1.2.3" },
				newRef: "v1.4.0",
				reAdd: "npx agntc add 'owner/repo@^1.2.0'",
			},
			{
				tracks: "a branch",
				entry: { ref: "main" },
				newRef: undefined,
				reAdd: "npx agntc add owner/repo@main",
			},
		])("keeps an entry tracking $tracks on it in the recovery's re-add", async ({
			entry,
			newRef,
			reAdd,
		}) => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeNukeAndReinstall(
				makeOptions({
					existingEntry: makeEntry({ type: "skill", ...entry }),
					...(newRef !== undefined ? { newRef } : {}),
				}),
			);

			expect(result).toMatchObject({
				status: "copy-failed",
				recoveryHint: expect.stringContaining(`Run \`${reAdd}\``),
			});
		});

		it("confirms nuke was called before copy failed", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await executeNukeAndReinstall(makeOptions());

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
		});
	});

	describe("a global entry", () => {
		const options = () => makeOptions({ scope: globalScope("/home/lee") });

		it("removes and copies below the home directory", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeNukeAndReinstall(options());

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/home/lee", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ projectDir: "/home/lee" }),
			);
		});

		it("carries -g in a copy failure's re-add command", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeNukeAndReinstall(options());

			expect(result).toMatchObject({
				status: "copy-failed",
				recoveryHint: expect.stringContaining(
					"Run `npx agntc add -g owner/repo` to install it again.",
				),
			});
		});
	});

	describe("a local entry's recorded root", () => {
		it("is kept on the reinstalled entry", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "/src/repo/my-skill",
					sourceDir: "/src/repo/my-skill",
					cloneRoot: "/src/repo",
					existingEntry: makeEntry({
						type: "skill",
						commit: null,
						localRoot: "/src/repo",
					}),
				}),
			);

			expect(result).toMatchObject({
				status: "success",
				key: "/src/repo/my-skill",
				entry: { localRoot: "/src/repo" },
			});
		});

		it("stays absent from an entry that never recorded one", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "/src/my-skill",
					sourceDir: "/src/my-skill",
					cloneRoot: "/src/my-skill",
					existingEntry: makeEntry({ type: "skill", commit: null }),
				}),
			);

			expect(result).toMatchObject({ status: "success", key: "/src/my-skill" });
			if (result.status !== "success") return;
			expect(result.entry).not.toHaveProperty("localRoot");
		});
	});

	describe("constraint preservation", () => {
		it("preserves constraint from existing entry", async () => {
			const options = makeOptions({
				existingEntry: makeEntry({ type: "skill", constraint: "^1.0" }),
			});

			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(options);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;

			expect(result.entry.constraint).toBe("^1.0");
		});

		it("omits constraint key entirely when existing entry has no constraint", async () => {
			const options = makeOptions({
				existingEntry: makeEntry({ type: "skill" }),
			});

			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(options);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;

			expect(result.entry.constraint).toBeUndefined();
			expect("constraint" in result.entry).toBe(false);
		});
	});

	describe("symlink-escape pre-flight guard", () => {
		it("scans sourceDir against cloneRoot before nuking (clone root differs from member subdir)", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/go",
					sourceDir: "/tmp/clone/go",
					cloneRoot: "/tmp/clone",
					existingEntry: makeEntry({ type: "skill" }),
				}),
			);

			expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
				"/tmp/clone/go",
				{ root: "/tmp/clone", local: false },
				expect.any(Function),
			);
		});

		it("runs the symlink scan BEFORE nukeManifestFiles and copy", async () => {
			mockPathExists.mockResolvedValue(true);

			const callOrder: string[] = [];
			mockScanForEscapingSymlinks.mockImplementation(async () => {
				callOrder.push("scan");
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-skill/"] };
			});

			await executeNukeAndReinstall(makeOptions());

			expect(callOrder.indexOf("scan")).toBeLessThan(callOrder.indexOf("nuke"));
			expect(callOrder.indexOf("nuke")).toBeLessThan(callOrder.indexOf("copy"));
		});

		it("blocks before any file removal when an escaping symlink is found (no nuke, no copy)", async () => {
			mockPathExists.mockResolvedValue(true);
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil", "../../../etc/passwd"),
			);

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("blocked");
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("surfaces the offending symlink in the blocked reason (a copy-safety violation, NOT a recorded-type abort)", async () => {
			mockPathExists.mockResolvedValue(true);
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
			);

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "pack" }) }),
			);

			expect(result.status).toBe("blocked");
			if (result.status !== "blocked") return;
			expect(result.reason).toContain("evil-link");
		});

		it("does NOT call assertSubpathWithinClone on the update path", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeNukeAndReinstall(makeOptions());

			expect(mockAssertSubpathWithinClone).not.toHaveBeenCalled();
		});

		it("does not abort for a within-clone cross-member symlink (scan resolves clean)", async () => {
			mockPathExists.mockResolvedValue(true);
			mockScanForEscapingSymlinks.mockResolvedValue(undefined);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/go",
					sourceDir: "/tmp/clone/go",
					cloneRoot: "/tmp/clone",
				}),
			);

			expect(result.status).toBe("success");
		});
	});
});

describe("sourceWalk", () => {
	it("walks a source once for every ask under one root name", async () => {
		mockDiscover.mockResolvedValue(looseSkills({ name: "go", path: "go" }));
		const walk = sourceWalk("/tmp/clone");

		const [first, second] = await Promise.all([walk("repo"), walk("repo")]);

		expect(mockDiscover).toHaveBeenCalledTimes(1);
		expect(mockDiscover).toHaveBeenCalledWith("/tmp/clone", {
			rootName: "repo",
		});
		expect(second).toBe(first);
	});

	it("walks again under another root name, which names a skill at the root", async () => {
		mockDiscover.mockImplementation(async (_root, { rootName }) =>
			looseSkills({ name: rootName, path: "" }),
		);
		const walk = sourceWalk("/tmp/clone");

		const repo = await walk("repo");
		const folder = await walk("folder");

		expect(mockDiscover).toHaveBeenCalledTimes(2);
		expect(repo.map((skill) => skill.name)).toEqual(["repo"]);
		expect(folder.map((skill) => skill.name)).toEqual(["folder"]);
	});

	it("walks again after a walk that failed, rather than failing every later ask", async () => {
		mockDiscover
			.mockRejectedValueOnce(new Error("EMFILE: too many open files"))
			.mockResolvedValueOnce(looseSkills({ name: "go", path: "go" }));
		const walk = sourceWalk("/tmp/clone");

		await expect(walk("repo")).rejects.toThrow("EMFILE");
		const skills = await walk("repo");

		expect(mockDiscover).toHaveBeenCalledTimes(2);
		expect(skills).toEqual([{ name: "go", path: "go" }]);
	});

	it("shares nothing between two walks of one source", async () => {
		mockDiscover.mockResolvedValue(looseSkills());

		await sourceWalk("/tmp/clone")("repo");
		await sourceWalk("/tmp/clone")("repo");

		expect(mockDiscover).toHaveBeenCalledTimes(2);
	});

	it("lists every skill, loose or in a pack, and none can be changed", async () => {
		mockDiscover.mockResolvedValue({
			packs: [foundPack()],
			skills: [{ name: "go", path: "go" }],
			strays: [],
		});

		const skills = await sourceWalk("/tmp/clone")("repo");

		expect(skills).toEqual([
			{ name: "go", path: "go" },
			{ name: "api", path: "laravel/skills/api" },
		]);
		expect(Object.isFrozen(skills)).toBe(true);
		expect(skills.every((skill) => Object.isFrozen(skill))).toBe(true);
	});

	it("never lists a pack's support folders, which aren't skills", async () => {
		mockDiscover.mockResolvedValue(
			onlyPack(
				foundPack({
					supportFolders: [{ name: "shared", path: "laravel/skills/shared" }],
				}),
			),
		);

		const skills = await sourceWalk("/tmp/clone")("repo");

		expect(skills).toEqual([{ name: "api", path: "laravel/skills/api" }]);
	});
});

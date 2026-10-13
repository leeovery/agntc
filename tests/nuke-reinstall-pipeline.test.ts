import {
	mkdir,
	mkdtemp,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

vi.mock("../src/copy-bare-skill.js", () => ({
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

		it("re-copies the bare skill under the manifest-key basename, not basename(sourceDir)", async () => {
			// Regression: on update/change-version the sourceDir is the random mkdtemp
			// clone dir, so the re-copy must take its name from the manifest KEY
			// (owner/repo → "repo"), not basename(tempDir) — otherwise the skill (and
			// the recorded files) land under a garbage temp-dir name.
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

		it("re-walks the pack from the clone root at its path, forcing a pack", async () => {
			await executeNukeAndReinstall(packOptions());

			expect(mockDiscover).toHaveBeenCalledWith("/tmp/clone", {
				startPath: "laravel",
				forcePack: true,
				rootName: "laravel",
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
				"/tmp/clone",
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
				projectDir: "/fake/project",
				skillName: "laravel",
			});
			expect(mockCopyPack).not.toHaveBeenCalled();
			expect(result).toMatchObject({
				status: "success",
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
				projectDir: "/fake/project",
				skillName: "go",
			});
			expect(result).toMatchObject({
				status: "success",
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

		it("drops the recorded path when the skill moved to where its key points", async () => {
			mockDiscover.mockResolvedValue(looseSkills({ name: "go", path: "go" }));

			const result = await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(result.entry).not.toHaveProperty("sourceSubpath");
		});

		it("follows a root skill that moved below the root, naming the old path after the repo", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "repo", path: "skills/repo" }),
			);

			const result = await executeNukeAndReinstall(
				makeOptions({ cloneRoot: "/tmp/clone", sourceDir: "/tmp/clone" }),
			);

			expect(result).toMatchObject({
				status: "success",
				entry: { sourceSubpath: "skills/repo" },
				notes: ["owner/repo moved from repo to skills/repo"],
			});
		});

		it("scans the folder it follows for escaping symlinks", async () => {
			mockDiscover.mockResolvedValue(
				looseSkills({ name: "go", path: "lang/go" }),
			);

			await executeNukeAndReinstall(makeOptions(MEMBER));

			expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
				"/tmp/clone/lang/go",
				"/tmp/clone",
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

		it("records a moved local skill's path from the folder its key sits in", async () => {
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
				entry: { sourceSubpath: "go/lang/go" },
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
					existingEntry: makeEntry({
						type: "skill",
						commit: null,
						localRoot: "/src/repo",
					}),
				}),
			);

			expect(result).toMatchObject({
				status: "success",
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
					existingEntry: makeEntry({ type: "skill", commit: null }),
				}),
			);

			expect(result.status).toBe("success");
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
				"/tmp/clone",
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

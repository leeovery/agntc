import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry } from "./helpers/factories.js";

vi.mock("../src/fs-utils.js", () => ({
	pathExists: vi.fn(),
}));

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/copy-pack.js", () => ({
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

import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPack } from "../src/copy-pack.js";
import {
	assertSubpathWithinClone,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import {
	type Discovery,
	discover,
	type FoundPack,
	PackConflictError,
	StartPathError,
} from "../src/discover.js";
import { pathExists } from "../src/fs-utils.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import {
	executeNukeAndReinstall,
	type NukeReinstallOptions,
} from "../src/nuke-reinstall-pipeline.js";

const mockPathExists = vi.mocked(pathExists);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPack = vi.mocked(copyPack);
const mockDiscover = vi.mocked(discover);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);
const mockAssertSubpathWithinClone = vi.mocked(assertSubpathWithinClone);

function makeOptions(
	overrides: Partial<NukeReinstallOptions> = {},
): NukeReinstallOptions {
	return {
		key: "owner/repo",
		sourceDir: "/tmp/source",
		cloneRoot: "/tmp/source",
		existingEntry: makeEntry({ type: "skill" }),
		projectDir: "/fake/project",
		...overrides,
	};
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
	mockDiscover.mockResolvedValue(onlyPack(foundPack()));
	mockCopyPack.mockResolvedValue({ copiedFiles: [], assetCounts: {} });
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
				makeOptions({ key: "owner/repo", sourceDir: "/tmp/agntc-Xy12ab" }),
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
			});
			expect(result).not.toHaveProperty("note");
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
				note: "owner/repo/laravel is a single skill — reinstalled as a skill",
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
				recordedType: "pack",
				reason: "its folder now contains packs",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("aborts, leaving the install intact, when the re-walk finds nothing", async () => {
			mockDiscover.mockResolvedValue(onlyPack(foundPack({ skills: [] })));

			const result = await executeNukeAndReinstall(packOptions());

			expect(result).toEqual({
				status: "aborted",
				recordedType: "pack",
				reason: "it no longer holds any skills, agents or hooks",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
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
				recordedType: "pack",
				reason:
					"laravel/skills/a/lint and laravel/tools/lint would both install to .claude/skills/lint",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("aborts, naming the path, when its path is missing", async () => {
			mockDiscover.mockRejectedValue(
				new StartPathError('path "laravel" not found in source'),
			);

			const result = await executeNukeAndReinstall(packOptions());

			expect(result).toEqual({
				status: "aborted",
				recordedType: "pack",
				reason: 'path "laravel" not found in source',
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("lets any other walk error through", async () => {
			mockDiscover.mockRejectedValue(new Error("EACCES"));

			await expect(executeNukeAndReinstall(packOptions())).rejects.toThrow(
				"EACCES",
			);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("derive-before-delete abort (recorded skill, SKILL.md gone)", () => {
		it("returns aborted and does NOT nuke or copy when SKILL.md is absent", async () => {
			mockPathExists.mockResolvedValue(false);

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("aborted");
			if (result.status !== "aborted") return;
			expect(result.recordedType).toBe("skill");
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPack).not.toHaveBeenCalled();
		});

		it("validation runs BEFORE nukeManifestFiles (abort -> nuke count 0)", async () => {
			const callOrder: string[] = [];
			mockPathExists.mockImplementation(async () => {
				callOrder.push("validate");
				return false;
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("aborted");
			expect(callOrder).toEqual(["validate"]);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
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

		it("aborts before the symlink scan, which can't read a vanished folder", async () => {
			mockPathExists.mockResolvedValue(false);

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("aborted");
			expect(mockScanForEscapingSymlinks).not.toHaveBeenCalled();
		});

		it("abort result names recorded-vs-current cause in reason", async () => {
			mockPathExists.mockResolvedValue(false);

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("aborted");
			if (result.status !== "aborted") return;
			expect(result.recordedType).toBe("skill");
			expect(typeof result.reason).toBe("string");
			expect(result.reason.length).toBeGreaterThan(0);
			expect(result.reason).toContain("SKILL.md");
		});
	});

	describe("member entry whose subdir vanished", () => {
		it("aborts identically when its own subdir lacks SKILL.md", async () => {
			mockPathExists.mockResolvedValue(false);

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/go",
					sourceDir: "/tmp/source/go",
					existingEntry: makeEntry({
						type: "skill",
						files: [".claude/skills/go/"],
					}),
				}),
			);

			expect(result.status).toBe("aborted");
			expect(mockPathExists).toHaveBeenCalledWith("/tmp/source/go/SKILL.md");
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
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
				"Update failed for owner/repo after removing old files. It is currently uninstalled. Run `npx agntc update owner/repo` to retry installation.",
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

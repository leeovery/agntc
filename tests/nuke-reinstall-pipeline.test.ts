import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry } from "./helpers/factories.js";

vi.mock("../src/fs-utils.js", () => ({
	pathExists: vi.fn(),
}));

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/copy-plugin-assets.js", () => ({
	copyPluginAssets: vi.fn(),
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
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import {
	assertSubpathWithinClone,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import { pathExists } from "../src/fs-utils.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import {
	executeNukeAndReinstall,
	type NukeReinstallOptions,
} from "../src/nuke-reinstall-pipeline.js";

const mockPathExists = vi.mocked(pathExists);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
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

beforeEach(() => {
	vi.clearAllMocks();
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockPathExists.mockResolvedValue(true);
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
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
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
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

		it("ignores benign added asset dir: replays as skill via copyBareSkill not copyPluginAssets", async () => {
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(makeOptions());

			expect(result.status).toBe("success");
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
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

	describe("recorded-plugin replay", () => {
		it("replays recorded plugin: scans present asset dirs, nukes, copies via copyPluginAssets", async () => {
			// SKILL.md absent; skills/ present, agents/ absent, hooks/ absent.
			mockPathExists.mockImplementation(async (p: string) => {
				if (p === "/tmp/source/skills") return true;
				return false;
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
				assetCounts: {},
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					existingEntry: makeEntry({
						type: "plugin",
						files: [".claude/skills/foo/"],
					}),
				}),
			);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/foo/",
			]);
			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: "/tmp/source",
					projectDir: "/fake/project",
					assetDirs: ["skills"],
				}),
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(result.entry.type).toBe("plugin");
		});

		it("picks up benign added asset dir: assetDirs includes newly-present agents/", async () => {
			mockPathExists.mockImplementation(async (p: string) => {
				if (p === "/tmp/source/skills") return true;
				if (p === "/tmp/source/agents") return true;
				return false;
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
				assetCounts: {},
			});

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
			);

			expect(result.status).toBe("success");
			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({ assetDirs: ["skills", "agents"] }),
			);
		});

		it("ignores added root SKILL.md while >=1 asset dir present: still plugin", async () => {
			mockPathExists.mockImplementation(async (p: string) => {
				if (p === "/tmp/source/skills") return true;
				if (p === "/tmp/source/SKILL.md") return true;
				return false;
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
				assetCounts: {},
			});

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
			);

			expect(result.status).toBe("success");
			expect(mockCopyPluginAssets).toHaveBeenCalledOnce();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("scans asset dirs BEFORE nukeManifestFiles (success ordering)", async () => {
			const callOrder: string[] = [];
			mockPathExists.mockImplementation(async (p: string) => {
				callOrder.push(`scan:${p}`);
				return p === "/tmp/source/skills";
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});
			mockCopyPluginAssets.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [], assetCounts: {} };
			});

			await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
			);

			const nukeIdx = callOrder.indexOf("nuke");
			const lastScanIdx = callOrder.lastIndexOf(
				callOrder.filter((c) => c.startsWith("scan:")).at(-1) as string,
			);
			expect(nukeIdx).toBeGreaterThan(lastScanIdx);
			expect(callOrder.indexOf("copy")).toBeGreaterThan(nukeIdx);
		});
	});

	describe("recorded-plugin abort (no asset dir remains)", () => {
		it("aborts when zero asset dirs present: no nuke, no copy", async () => {
			mockPathExists.mockResolvedValue(false);

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
			);

			expect(result.status).toBe("aborted");
			if (result.status !== "aborted") return;
			expect(result.recordedType).toBe("plugin");
			expect(result.reason.length).toBeGreaterThan(0);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("aborts when source became a bare skill (SKILL.md only, no asset dir)", async () => {
			mockPathExists.mockImplementation(async (p: string) => {
				return p === "/tmp/source/SKILL.md";
			});

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
			);

			expect(result.status).toBe("aborted");
			if (result.status !== "aborted") return;
			expect(result.recordedType).toBe("plugin");
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});

		it("asset-dir scan runs BEFORE nukeManifestFiles on abort (nuke count 0)", async () => {
			const callOrder: string[] = [];
			mockPathExists.mockImplementation(async () => {
				callOrder.push("scan");
				return false;
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
			);

			expect(result.status).toBe("aborted");
			expect(callOrder).not.toContain("nuke");
		});

		it("member plugin whose subdir vanished aborts (zero asset dirs in its sourceDir)", async () => {
			mockPathExists.mockResolvedValue(false);

			const result = await executeNukeAndReinstall(
				makeOptions({
					key: "owner/repo/go",
					sourceDir: "/tmp/source/go",
					existingEntry: makeEntry({
						type: "plugin",
						files: [".claude/skills/go/", ".claude/agents/go.md"],
					}),
				}),
			);

			expect(result.status).toBe("aborted");
			if (result.status !== "aborted") return;
			expect(result.recordedType).toBe("plugin");
			expect(mockPathExists).toHaveBeenCalledWith("/tmp/source/go/skills");
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
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
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

		it("migrates a Codex-only plugin entry into .claude", async () => {
			const codexFiles = [".agents/skills/a/", ".agents/skills/b/"];
			mockPathExists.mockImplementation(
				async (p: string) => p === "/tmp/source/skills",
			);
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/a/", ".claude/skills/b/"],
				assetCounts: { skills: 2 },
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					existingEntry: makeEntry({ type: "plugin", files: codexFiles }),
				}),
			);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				codexFiles,
			);
			expect(mockCopyPluginAssets).toHaveBeenCalledWith({
				sourceDir: "/tmp/source",
				assetDirs: ["skills"],
				projectDir: "/fake/project",
			});
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
				"Update failed for owner/repo after removing old files. The plugin is currently uninstalled. Run `npx agntc update owner/repo` to retry installation.",
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
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});

		it("surfaces the offending symlink in the blocked reason (a copy-safety violation, NOT a recorded-type abort)", async () => {
			mockPathExists.mockResolvedValue(true);
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "../../../etc/passwd"),
			);

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeEntry, makeFakeDriver } from "./helpers/factories.js";

vi.mock("../src/config.js", () => ({
	readConfig: vi.fn(),
}));

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

vi.mock("../src/drivers/registry.js", () => ({
	getDriver: vi.fn(),
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

import { readConfig } from "../src/config.js";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import { copyPluginAssets } from "../src/copy-plugin-assets.js";
import {
	assertSubpathWithinClone,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../src/copy-safety.js";
import { getDriver } from "../src/drivers/registry.js";
import { pathExists } from "../src/fs-utils.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import {
	executeNukeAndReinstall,
	type NukeReinstallOptions,
} from "../src/nuke-reinstall-pipeline.js";

const mockReadConfig = vi.mocked(readConfig);
const mockPathExists = vi.mocked(pathExists);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockGetDriver = vi.mocked(getDriver);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);
const mockAssertSubpathWithinClone = vi.mocked(assertSubpathWithinClone);

const fakeDriver = makeFakeDriver();

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
	mockGetDriver.mockReturnValue(fakeDriver);
	mockPathExists.mockResolvedValue(true);
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
});

describe("executeNukeAndReinstall", () => {
	describe("recorded-skill replay", () => {
		it("replays recorded skill: checks SKILL.md, nukes, copies via copyBareSkill, returns entry", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			expect(result.entry.agents).toEqual(["claude"]);
			expect(result.entry.files).toEqual([".claude/skills/my-skill/"]);
			expect(result.copiedFiles).toEqual([".claude/skills/my-skill/"]);
		});

		it("ignores benign added asset dir: replays as skill via copyBareSkill not copyPluginAssets", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			// SKILL.md absent; skills/ present, agents/ absent, hooks/ absent.
			mockPathExists.mockImplementation(async (p: string) => {
				if (p === "/tmp/source/skills") return true;
				return false;
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
				assetCountsByAgent: {},
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockImplementation(async (p: string) => {
				if (p === "/tmp/source/skills") return true;
				if (p === "/tmp/source/agents") return true;
				return false;
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
				assetCountsByAgent: {},
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockImplementation(async (p: string) => {
				if (p === "/tmp/source/skills") return true;
				if (p === "/tmp/source/SKILL.md") return true;
				return false;
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
				assetCountsByAgent: {},
			});

			const result = await executeNukeAndReinstall(
				makeOptions({ existingEntry: makeEntry({ type: "plugin" }) }),
			);

			expect(result.status).toBe("success");
			expect(mockCopyPluginAssets).toHaveBeenCalledOnce();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("scans asset dirs BEFORE nukeManifestFiles (success ordering)", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

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
				return { copiedFiles: [], assetCountsByAgent: {} };
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

		it("configless recorded-plugin update proceeds (null config, no abort)", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockPathExists.mockImplementation(async (p: string) => {
				return p === "/tmp/source/skills";
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/foo/"],
				assetCountsByAgent: {},
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					existingEntry: makeEntry({ type: "plugin", agents: ["claude"] }),
				}),
			);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(mockCopyPluginAssets).toHaveBeenCalledOnce();
			expect(result.entry.agents).toEqual(["claude"]);
		});
	});

	describe("recorded-plugin abort (no asset dir remains)", () => {
		it("aborts when zero asset dirs present: no nuke, no copy", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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

	describe("configless recorded-skill update (null config)", () => {
		it("proceeds: null config means no agent restriction, not abort", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(
				makeOptions({
					existingEntry: makeEntry({ type: "skill", agents: ["claude"] }),
				}),
			);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
			expect(result.entry.agents).toEqual(["claude"]);
		});

		it("does not call onAgentsDropped when config is null", async () => {
			const onAgentsDropped = vi.fn();
			mockReadConfig.mockResolvedValue(null);
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeNukeAndReinstall(makeOptions({ onAgentsDropped }));

			expect(onAgentsDropped).not.toHaveBeenCalled();
		});
	});

	describe("dropped-agents callback", () => {
		it("invokes onAgentsDropped when new config removes agents", async () => {
			const onAgentsDropped = vi.fn();
			const options = makeOptions({
				existingEntry: makeEntry({
					type: "skill",
					agents: ["claude", "codex"],
				}),
				onAgentsDropped,
			});

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(options);

			expect(result.status).toBe("success");
			if (result.status !== "success") return;

			expect(onAgentsDropped).toHaveBeenCalledWith(["codex"], ["claude"]);
			expect(result.droppedAgents).toEqual(["codex"]);
			expect(result.entry.agents).toEqual(["claude"]);
		});
	});

	describe("all agents dropped", () => {
		it("returns no-agents failure when all agents are dropped", async () => {
			const options = makeOptions({
				existingEntry: makeEntry({ type: "skill", agents: ["codex"] }),
			});

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(true);

			const result = await executeNukeAndReinstall(options);

			expect(result.status).toBe("no-agents");
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});
	});

	describe("ref and commit overrides", () => {
		it("uses newRef and newCommit when provided", async () => {
			const options = makeOptions({
				newRef: "v2.0.0",
				newCommit: "b".repeat(40),
			});

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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

			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await executeNukeAndReinstall(makeOptions());

			expect(mockAssertSubpathWithinClone).not.toHaveBeenCalled();
		});

		it("does not abort for a within-clone cross-member symlink (scan resolves clean)", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
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

	describe("agent+driver pair construction", () => {
		it("builds agents with drivers from effective agents", async () => {
			const options = makeOptions({
				existingEntry: makeEntry({
					type: "skill",
					agents: ["claude", "codex"],
				}),
			});

			mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
			mockPathExists.mockResolvedValue(true);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/", ".agents/skills/my-skill/"],
			});

			const result = await executeNukeAndReinstall(options);

			expect(result.status).toBe("success");
			expect(mockGetDriver).toHaveBeenCalledWith("claude");
			expect(mockGetDriver).toHaveBeenCalledWith("codex");
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					agents: [
						expect.objectContaining({ id: "claude" }),
						expect.objectContaining({ id: "codex" }),
					],
				}),
			);
		});
	});
});

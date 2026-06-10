import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CollisionResolution } from "../../src/collision-resolve.js";
import type { AgntcConfig } from "../../src/config.js";
import type { CopyBareSkillResult } from "../../src/copy-bare-skill.js";
import type { CopyPluginAssetsResult } from "../../src/copy-plugin-assets.js";
import type { AgentId } from "../../src/drivers/types.js";
import { ExitSignal } from "../../src/exit-signal.js";
import type { CloneResult } from "../../src/git-clone.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { ParsedSource } from "../../src/source-parser.js";
import type { DetectedType } from "../../src/type-detection.js";
import type { UnmanagedResolution } from "../../src/unmanaged-resolve.js";

// Mock all dependencies before importing the module under test
vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack();
});

vi.mock("../../src/source-parser.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/source-parser.js")>();
	return {
		...actual,
		parseSource: vi.fn(),
	};
});

vi.mock("../../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../../src/git-utils.js", () => ({
	fetchRemoteTags: vi.fn(),
}));

vi.mock("../../src/version-resolve.js", () => ({
	resolveLatestVersion: vi.fn(),
	resolveVersion: vi.fn(),
}));

vi.mock("../../src/config.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/config.js")>()),
	readConfig: vi.fn(),
}));

vi.mock("../../src/type-detection.js", () => ({
	detectType: vi.fn(),
	// Per-member membership probe used by the collection pipeline to resolve a
	// skills-only member (≥1 asset dir at its own root) as a plugin member.
	// Defaults to [] so existing mocked-detectType tests are unaffected (their
	// detectType mock ignores the forwarded forcePlugin); REAL-path tests
	// override it to delegate to the actual implementation.
	findPresentAssetDirs: vi.fn(async () => []),
	// Real throwable class so `instanceof` in the add command's catch works.
	TypeConflictError: class TypeConflictError extends Error {
		constructor(message: string) {
			super(message);
			this.name = "TypeConflictError";
		}
	},
}));

vi.mock("../../src/drivers/registry.js", () => ({
	getDriver: vi.fn(),
}));

vi.mock("../../src/agent-select.js", () => ({
	selectAgents: vi.fn(),
}));

vi.mock("../../src/collection-select.js", () => ({
	selectCollectionPlugins: vi.fn(),
}));

vi.mock("../../src/copy-bare-skill.js", () => ({
	copyBareSkill: vi.fn(),
}));

vi.mock("../../src/copy-plugin-assets.js", () => ({
	copyPluginAssets: vi.fn(),
}));

vi.mock("../../src/manifest.js", async (importOriginal) => ({
	// Keep real pure helpers (manifestTypeFromDetected, buildManifestEntry) so the
	// write point records the correct resolved type and a byte-identical entry
	// shape; override only the impure persistence/query functions.
	...(await importOriginal<typeof import("../../src/manifest.js")>()),
	readManifest: vi.fn(),
	writeManifest: vi.fn(),
	addEntry: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../../src/detect-agents.js", () => ({
	detectAgents: vi.fn(),
}));

vi.mock("../../src/compute-incoming-files.js", () => ({
	computeIncomingFiles: vi.fn(),
}));

vi.mock("../../src/collision-check.js", () => ({
	checkFileCollisions: vi.fn(),
}));

vi.mock("../../src/collision-resolve.js", () => ({
	resolveCollisions: vi.fn(),
}));

vi.mock("../../src/unmanaged-check.js", () => ({
	checkUnmanagedConflicts: vi.fn(),
}));

vi.mock("../../src/unmanaged-resolve.js", () => ({
	resolveUnmanagedConflicts: vi.fn(),
}));

vi.mock("../../src/copy-safety.js", async () => {
	const { mockCopySafety } = await import("../helpers/copy-safety-mock.js");
	// Real throwable classes so `instanceof` narrowing works. This site fully
	// replaces the module (no ...actual spread), so the classes are declared
	// locally and the same SymlinkEscapeError is handed to the shared helper to
	// keep the wrapper's narrowing semantics identical.
	class PathTraversalError extends Error {
		constructor(subpath: string) {
			super(`subpath "${subpath}" resolves outside the clone root`);
			this.name = "PathTraversalError";
		}
	}
	class SymlinkEscapeError extends Error {
		constructor(relPath: string, target: string) {
			super(
				`symlink "${relPath}" points outside the clone (target: ${target})`,
			);
			this.name = "SymlinkEscapeError";
		}
	}
	return {
		assertSubpathWithinClone: vi.fn(),
		PathTraversalError,
		SymlinkEscapeError,
		...mockCopySafety(SymlinkEscapeError),
	};
});

import * as p from "@clack/prompts";
import { selectAgents } from "../../src/agent-select.js";
import { selectCollectionPlugins } from "../../src/collection-select.js";
import { checkFileCollisions } from "../../src/collision-check.js";
import { resolveCollisions } from "../../src/collision-resolve.js";
import { addCommand, runAdd } from "../../src/commands/add.js";
import { computeIncomingFiles } from "../../src/compute-incoming-files.js";
import { readConfig } from "../../src/config.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import {
	assertSubpathWithinClone,
	PathTraversalError,
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../../src/copy-safety.js";
import { detectAgents } from "../../src/detect-agents.js";
import { getDriver } from "../../src/drivers/registry.js";
import { cleanupTempDir, cloneSource } from "../../src/git-clone.js";
import { fetchRemoteTags } from "../../src/git-utils.js";
import { addEntry, readManifest, writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { parseSource } from "../../src/source-parser.js";
import {
	detectType,
	findPresentAssetDirs,
	TypeConflictError,
} from "../../src/type-detection.js";
import { checkUnmanagedConflicts } from "../../src/unmanaged-check.js";
import { resolveUnmanagedConflicts } from "../../src/unmanaged-resolve.js";
import {
	resolveLatestVersion,
	resolveVersion,
} from "../../src/version-resolve.js";

const mockParseSource = vi.mocked(parseSource);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockFetchRemoteTags = vi.mocked(fetchRemoteTags);
const mockResolveLatestVersion = vi.mocked(resolveLatestVersion);
const mockResolveVersion = vi.mocked(resolveVersion);
const mockReadConfig = vi.mocked(readConfig);
const mockDetectType = vi.mocked(detectType);
const mockFindPresentAssetDirs = vi.mocked(findPresentAssetDirs);
const mockGetDriver = vi.mocked(getDriver);
const mockDetectAgents = vi.mocked(detectAgents);
const mockSelectAgents = vi.mocked(selectAgents);
// selectAgents now returns a discriminated result distinguishing a deliberate
// (possibly empty) selection from cancellation. These helpers keep the mock
// setups expressing intent in terms of the resolved agents / cancel outcome.
const selected = (
	agents: AgentId[],
): Awaited<ReturnType<typeof selectAgents>> =>
	({ kind: "selected", agents }) as const;
const cancelledSelection: Awaited<ReturnType<typeof selectAgents>> = {
	kind: "cancelled",
} as const;
const mockSelectCollectionPlugins = vi.mocked(selectCollectionPlugins);
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockCopyPluginAssets = vi.mocked(copyPluginAssets);
const mockReadManifest = vi.mocked(readManifest);
const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockComputeIncomingFiles = vi.mocked(computeIncomingFiles);
const mockCheckFileCollisions = vi.mocked(checkFileCollisions);
const mockResolveCollisions = vi.mocked(resolveCollisions);
const mockCheckUnmanagedConflicts = vi.mocked(checkUnmanagedConflicts);
const mockResolveUnmanagedConflicts = vi.mocked(resolveUnmanagedConflicts);
const mockAssertSubpathWithinClone = vi.mocked(assertSubpathWithinClone);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);
const mockIntro = vi.mocked(p.intro);
const mockOutro = vi.mocked(p.outro);
const mockSpinner = vi.mocked(p.spinner);
const mockCancel = vi.mocked(p.cancel);
const mockLog = vi.mocked(p.log);

// The install summary is split: the headline goes to p.outro, the per-agent /
// per-member detail to p.log.success (one connected ◇ node per line). Recombine
// both for assertions that previously read the single crammed outro string.
function summaryText(): string {
	const headline = (mockOutro.mock.calls.at(-1)?.[0] as string) ?? "";
	const detail = mockLog.success.mock.calls
		.map((c) => c[0] as string)
		.join("\n");
	return `${headline}\n${detail}`;
}

const PARSED: ParsedSource = {
	type: "github-shorthand",
	owner: "owner",
	repo: "my-skill",
	ref: "main",
	manifestKey: "owner/my-skill",
	cloneUrl: "https://github.com/owner/my-skill.git",
};

const CLONE_RESULT: CloneResult = {
	tempDir: "/tmp/agntc-abc123",
	commit: "abc123def456",
};

const CONFIG: AgntcConfig = { agents: ["claude"] };

const BARE_SKILL: DetectedType = { type: "bare-skill" };

const FAKE_DRIVER = {
	detect: vi.fn().mockResolvedValue(true),
	getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
};

const COPY_RESULT: CopyBareSkillResult = {
	copiedFiles: [".claude/skills/my-skill/"],
};

const EMPTY_MANIFEST: Manifest = {};

const MANIFEST_ENTRY: ManifestEntry = {
	ref: "main",
	commit: "abc123def456",
	installedAt: expect.any(String),
	agents: ["claude"],
	files: [".claude/skills/my-skill/"],
	cloneUrl: "https://github.com/owner/my-skill.git",
};

const UPDATED_MANIFEST: Manifest = {
	"owner/my-skill": MANIFEST_ENTRY,
};

function setupHappyPath(): void {
	mockParseSource.mockReturnValue(PARSED);
	mockCloneSource.mockResolvedValue(CLONE_RESULT);
	mockFetchRemoteTags.mockResolvedValue([]);
	mockResolveLatestVersion.mockReturnValue(null);
	mockReadConfig.mockResolvedValue(CONFIG);
	mockDetectType.mockResolvedValue(BARE_SKILL);
	mockDetectAgents.mockResolvedValue(["claude"]);
	mockGetDriver.mockReturnValue(FAKE_DRIVER);
	mockSelectAgents.mockResolvedValue(selected(["claude"]));
	mockCopyBareSkill.mockResolvedValue(COPY_RESULT);
	mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
	mockAddEntry.mockReturnValue(UPDATED_MANIFEST);
	mockWriteManifest.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockComputeIncomingFiles.mockReturnValue([".claude/skills/my-skill/"]);
	mockCheckFileCollisions.mockReturnValue(new Map());
	mockResolveCollisions.mockResolvedValue({
		resolved: true,
		updatedManifest: EMPTY_MANIFEST,
	});
	mockCheckUnmanagedConflicts.mockResolvedValue([]);
	mockResolveUnmanagedConflicts.mockResolvedValue({
		approved: [],
		cancelled: [],
	});
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockAssertSubpathWithinClone.mockReturnValue(undefined);
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
}

let mockCwd: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	vi.clearAllMocks();
	mockCwd = vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
	setupHappyPath();
});

describe("add command", () => {
	describe("happy path", () => {
		it("runs full pipeline: parse, clone, config, detect, select, copy, manifest, summary, cleanup", async () => {
			await runAdd("owner/my-skill");

			expect(mockParseSource).toHaveBeenCalledWith("owner/my-skill");
			expect(mockCloneSource).toHaveBeenCalledWith(PARSED);
			expect(mockReadConfig).toHaveBeenCalledWith(
				CLONE_RESULT.tempDir,
				expect.objectContaining({ onWarn: expect.any(Function) }),
			);
			expect(mockDetectType).toHaveBeenCalledWith(
				CLONE_RESULT.tempDir,
				expect.objectContaining({
					onWarn: expect.any(Function),
				}),
			);
			expect(mockDetectAgents).toHaveBeenCalledWith("/fake/project");
			expect(mockSelectAgents).toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockReadManifest).toHaveBeenCalledWith("/fake/project");
			expect(mockWriteManifest).toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("shows intro and outro", async () => {
			await runAdd("owner/my-skill");

			expect(mockIntro).toHaveBeenCalledWith("agntc add");
			expect(mockOutro).toHaveBeenCalled();
		});

		it("uses spinners during clone and copy", async () => {
			const spinnerInstance = {
				start: vi.fn(),
				stop: vi.fn(),
				message: vi.fn(),
			};
			mockSpinner.mockReturnValue(spinnerInstance);

			await runAdd("owner/my-skill");

			expect(mockSpinner).toHaveBeenCalled();
			expect(spinnerInstance.start).toHaveBeenCalledTimes(2);
			const startCalls = spinnerInstance.start.mock.calls.map(
				(c) => c[0] as string,
			);
			expect(startCalls.some((msg) => msg.includes("Clon"))).toBe(true);
			expect(startCalls.some((msg) => msg.includes("Copy"))).toBe(true);
			expect(spinnerInstance.stop).toHaveBeenCalled();
		});

		it("uses process.cwd() as project dir", async () => {
			await runAdd("owner/my-skill");

			expect(mockCwd).toHaveBeenCalled();
			expect(mockReadManifest).toHaveBeenCalledWith("/fake/project");
		});

		it("uses skillName from parsed.repo", async () => {
			await runAdd("owner/my-skill");

			// copyBareSkill should use the repo name, not the tempDir basename
			const copyCall = mockCopyBareSkill.mock.calls[0]![0];
			// The sourceDir should be the tempDir (which contains the repo)
			expect(copyCall.sourceDir).toBe(CLONE_RESULT.tempDir);
		});
	});

	describe("detect agents", () => {
		it("calls detectAgents with project dir", async () => {
			await runAdd("owner/my-skill");

			expect(mockDetectAgents).toHaveBeenCalledWith("/fake/project");
		});

		it("passes correct declaredAgents and detectedAgents to selectAgents", async () => {
			mockDetectAgents.mockResolvedValue(["claude"]);
			mockReadConfig.mockResolvedValue({ agents: ["claude", "codex"] });
			mockSelectAgents.mockResolvedValue(selected(["claude"]));

			await runAdd("owner/my-skill");

			expect(mockSelectAgents).toHaveBeenCalledWith(
				expect.objectContaining({
					declaredAgents: ["claude", "codex"],
					detectedAgents: ["claude"],
				}),
			);
		});
	});

	describe("copy bare skill", () => {
		it("passes correct args to copyBareSkill", async () => {
			await runAdd("owner/my-skill");

			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: CLONE_RESULT.tempDir,
				projectDir: "/fake/project",
				agents: [{ id: "claude", driver: FAKE_DRIVER }],
				// Install name = manifest-key basename, NOT basename(tempDir).
				skillName: "my-skill",
			});
		});
	});

	describe("manifest", () => {
		it("reads existing manifest before adding", async () => {
			const existingManifest: Manifest = {
				"other/repo": {
					ref: "v1",
					commit: "old123",
					installedAt: "2026-01-01T00:00:00.000Z",
					agents: ["claude"],
					files: [".claude/skills/repo/"],
				},
			};
			mockReadManifest.mockResolvedValue(existingManifest);

			await runAdd("owner/my-skill");

			expect(mockAddEntry).toHaveBeenCalledWith(
				existingManifest,
				"owner/my-skill",
				expect.objectContaining({
					ref: "main",
					commit: "abc123def456",
					agents: ["claude"],
					files: [".claude/skills/my-skill/"],
				}),
			);
		});

		it("creates correct manifest entry fields", async () => {
			await runAdd("owner/my-skill");

			expect(mockAddEntry).toHaveBeenCalledWith(
				EMPTY_MANIFEST,
				"owner/my-skill",
				expect.objectContaining({
					ref: "main",
					commit: "abc123def456",
					installedAt: expect.any(String),
					agents: ["claude"],
					files: [".claude/skills/my-skill/"],
				}),
			);

			// Verify installedAt is a valid ISO string
			const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
			expect(new Date(entry.installedAt).toISOString()).toBe(entry.installedAt);
		});

		it("stores cloneUrl from github-shorthand source", async () => {
			await runAdd("owner/my-skill");

			const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
			expect(entry.cloneUrl).toBe("https://github.com/owner/my-skill.git");
		});

		it("stores cloneUrl from https-url source", async () => {
			mockParseSource.mockReturnValue({
				type: "https-url",
				owner: "owner",
				repo: "my-skill",
				ref: null,
				manifestKey: "owner/my-skill",
				cloneUrl: "https://gitlab.com/owner/my-skill.git",
			});

			await runAdd("https://gitlab.com/owner/my-skill");

			const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
			expect(entry.cloneUrl).toBe("https://gitlab.com/owner/my-skill.git");
		});

		it("stores cloneUrl from ssh-url source", async () => {
			mockParseSource.mockReturnValue({
				type: "ssh-url",
				owner: "owner",
				repo: "my-skill",
				ref: null,
				manifestKey: "owner/my-skill",
				cloneUrl: "git@github.com:owner/my-skill.git",
			});

			await runAdd("git@github.com:owner/my-skill.git");

			const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
			expect(entry.cloneUrl).toBe("git@github.com:owner/my-skill.git");
		});

		it("stores null cloneUrl for local-path source", async () => {
			mockParseSource.mockReturnValue({
				type: "local-path",
				resolvedPath: "/Users/lee/Code/my-skill",
				ref: null,
				manifestKey: "/Users/lee/Code/my-skill",
			});

			await runAdd("/Users/lee/Code/my-skill");

			const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
			expect(entry.cloneUrl).toBeNull();
		});

		it("writes updated manifest", async () => {
			await runAdd("owner/my-skill");

			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				UPDATED_MANIFEST,
			);
		});
	});

	describe("summary", () => {
		it("shows key, ref, and per-agent skill count", async () => {
			await runAdd("owner/my-skill");

			const outroCall = summaryText();
			expect(outroCall).toContain("owner/my-skill");
			expect(outroCall).toContain("main");
			expect(outroCall).toContain("Claude");
			expect(outroCall).toContain("1 skill");
		});
	});

	describe("warnings", () => {
		it("forwards config warnings to clack log.warn", async () => {
			mockReadConfig.mockImplementation(async (_dir, options) => {
				options?.onWarn?.("unknown agent warning");
				return CONFIG;
			});

			await runAdd("owner/my-skill");

			expect(mockLog.warn).toHaveBeenCalledWith("unknown agent warning");
		});

		it("forwards type-detection warnings to clack log.warn", async () => {
			mockDetectType.mockImplementation(async (_dir, options) => {
				options.onWarn?.("not-agntc warning");
				return BARE_SKILL;
			});

			await runAdd("owner/my-skill");

			expect(mockLog.warn).toHaveBeenCalledWith("not-agntc warning");
		});
	});

	describe("error: invalid source", () => {
		it("shows error and exits 1 with no clone attempted", async () => {
			mockParseSource.mockImplementation(() => {
				throw new Error('source must be in owner/repo format, got "bad"');
			});

			const err = await runAdd("bad").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("error: clone failure", () => {
		it("shows error, cleans up, and exits 1", async () => {
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const err = await runAdd("owner/my-skill").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalled();
		});
	});

	describe("configless standalone install", () => {
		it("installs configless bare skill standalone (copyBareSkill, manifest keyed owner/repo)", async () => {
			// refero_skill shape: no agntc.json, root SKILL.md
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue(BARE_SKILL);

			await runAdd("owner/my-skill");

			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				EMPTY_MANIFEST,
				"owner/my-skill",
				expect.objectContaining({ files: [".claude/skills/my-skill/"] }),
			);
			// No "no agntc.json" cancel
			expect(mockCancel).not.toHaveBeenCalled();
		});

		it("sources agents from KNOWN_AGENTS default — selectAgents called with declaredAgents:[]", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue(BARE_SKILL);

			await runAdd("owner/my-skill");

			expect(mockSelectAgents).toHaveBeenCalledWith({
				declaredAgents: [],
				detectedAgents: ["claude"],
				unitLabel: "the my-skill skill",
			});
		});

		it("installs configless multi-asset plugin via copyPluginAssets", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue({
				type: "plugin",
				assetDirs: ["skills", "agents"],
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("owner/my-skill");

			expect(mockCopyPluginAssets).toHaveBeenCalledWith({
				sourceDir: CLONE_RESULT.tempDir,
				assetDirs: ["skills", "agents"],
				agents: [{ id: "claude", driver: FAKE_DRIVER }],
				projectDir: "/fake/project",
			});
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockSelectAgents).toHaveBeenCalledWith({
				declaredAgents: [],
				detectedAgents: ["claude"],
				unitLabel: "the my-skill plugin",
			});
		});

		it("config-bearing standalone passes declared agents as ceiling", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue(BARE_SKILL);

			await runAdd("owner/my-skill");

			expect(mockSelectAgents).toHaveBeenCalledWith({
				declaredAgents: ["claude"],
				detectedAgents: ["claude"],
				unitLabel: "the my-skill skill",
			});
		});

		it("calls detectType exactly once with configType forwarded and no hasConfig", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"], type: "plugin" });
			mockDetectType.mockResolvedValue({
				type: "plugin",
				assetDirs: ["skills"],
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("owner/my-skill");

			expect(mockDetectType).toHaveBeenCalledTimes(1);
			expect(mockDetectType).toHaveBeenCalledWith(CLONE_RESULT.tempDir, {
				onWarn: expect.any(Function),
				configType: "plugin",
			});
			const firstCall = mockDetectType.mock.calls[0];
			const opts = firstCall?.[1] as Record<string, unknown>;
			expect(opts).not.toHaveProperty("hasConfig");
		});

		it("configless collection still dispatches to pipeline and returns", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue({
				type: "collection",
				plugins: ["pluginA"],
			});
			mockSelectCollectionPlugins.mockResolvedValue([]);

			const err = await runAdd("owner/my-skill").catch((e) => e);

			// reached the collection pipeline (plugin selection)
			expect(mockSelectCollectionPlugins).toHaveBeenCalled();
			expect(err).toBeInstanceOf(ExitSignal);
		});

		it("configless not-agntc fails pre-flight: source-named cancel, non-zero exit, no manifest/copy", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue({ type: "not-agntc" });

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("owner/my-skill"),
			);
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("Not an agntc source"),
			);
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});

		it("config-bearing not-agntc fails pre-flight non-zero", async () => {
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "not-agntc" });

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("owner/my-skill"),
			);
			expect(mockAddEntry).not.toHaveBeenCalled();
		});

		describe("recorded type", () => {
			it("standalone bare skill records type skill", async () => {
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);

				await runAdd("owner/my-skill");

				const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
				expect(entry.type).toBe("skill");
			});

			it("standalone plugin records type plugin", async () => {
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue({
					type: "plugin",
					assetDirs: ["skills", "agents"],
				});
				mockCopyPluginAssets.mockResolvedValue({
					copiedFiles: [".claude/skills/planning/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				});

				await runAdd("owner/my-skill");

				const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
				expect(entry.type).toBe("plugin");
			});

			it("--plugin-bundled skills-only records type plugin", async () => {
				mockReadConfig.mockResolvedValue(null);
				// detectType resolves skills-only ambiguity to plugin under --plugin
				mockDetectType.mockResolvedValue({
					type: "plugin",
					assetDirs: ["skills"],
				});
				mockCopyPluginAssets.mockResolvedValue({
					copiedFiles: [".claude/skills/planning/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				});

				await runAdd("owner/my-skill", { forcePlugin: true });

				const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
				expect(entry.type).toBe("plugin");
			});

			it("config type plugin records type plugin", async () => {
				mockReadConfig.mockResolvedValue({
					agents: ["claude"],
					type: "plugin",
				});
				mockDetectType.mockResolvedValue({
					type: "plugin",
					assetDirs: ["skills"],
				});
				mockCopyPluginAssets.mockResolvedValue({
					copiedFiles: [".claude/skills/planning/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				});

				await runAdd("owner/my-skill");

				const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
				expect(entry.type).toBe("plugin");
			});

			it("bare-skill is mapped to skill, never persisted verbatim", async () => {
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);

				await runAdd("owner/my-skill");

				const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
				expect(entry.type).not.toBe("bare-skill");
			});

			it("does not alter other entry fields", async () => {
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);

				await runAdd("owner/my-skill");

				expect(mockAddEntry).toHaveBeenCalledWith(
					EMPTY_MANIFEST,
					"owner/my-skill",
					expect.objectContaining({
						ref: "main",
						commit: "abc123def456",
						agents: ["claude"],
						files: [".claude/skills/my-skill/"],
						cloneUrl: "https://github.com/owner/my-skill.git",
						type: "skill",
					}),
				);
			});
		});
	});

	describe("collection type", () => {
		const COLLECTION_PARSED: ParsedSource = {
			type: "github-shorthand",
			owner: "owner",
			repo: "my-collection",
			ref: "main",
			manifestKey: "owner/my-collection",
		};

		const COLLECTION_CLONE_RESULT: CloneResult = {
			tempDir: "/tmp/agntc-coll123",
			commit: "coll123def456",
		};

		const COLLECTION_DETECTED: DetectedType = {
			type: "collection",
			plugins: ["pluginA", "pluginB"],
		};

		const PLUGIN_A_CONFIG: AgntcConfig = { agents: ["claude"] };
		const PLUGIN_B_CONFIG: AgntcConfig = { agents: ["claude"] };

		const PLUGIN_A_BARE: DetectedType = { type: "bare-skill" };
		const PLUGIN_B_BARE: DetectedType = { type: "bare-skill" };

		function setupCollectionBase(): void {
			mockParseSource.mockReturnValue(COLLECTION_PARSED);
			mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
			// Root readConfig returns null (no root agntc.json)
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue(COLLECTION_DETECTED);
			mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
			mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
			mockDetectAgents.mockResolvedValue(["claude"]);
			mockGetDriver.mockReturnValue(FAKE_DRIVER);
			mockSelectAgents.mockResolvedValue(selected(["claude"]));
			mockWriteManifest.mockResolvedValue(undefined);
			mockCleanupTempDir.mockResolvedValue(undefined);
			mockAddEntry.mockImplementation((manifest, key, entry) => ({
				...manifest,
				[key]: entry,
			}));
		}

		function setupCollectionBareSkills(): void {
			setupCollectionBase();
			// Per-plugin readConfig
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				if (dir.endsWith("/pluginA")) return PLUGIN_A_CONFIG;
				if (dir.endsWith("/pluginB")) return PLUGIN_B_CONFIG;
				return null;
			});
			// Per-plugin detectType
			mockDetectType.mockImplementation(async (dir, options) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) {
					return COLLECTION_DETECTED;
				}
				if (dir.endsWith("/pluginA")) return PLUGIN_A_BARE;
				if (dir.endsWith("/pluginB")) return PLUGIN_B_BARE;
				return { type: "not-agntc" };
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
			});
		}

		it("collection with bare-skill plugins runs full pipeline", async () => {
			setupCollectionBareSkills();
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			expect(mockSelectCollectionPlugins).toHaveBeenCalledWith({
				plugins: ["pluginA", "pluginB"],
				manifest: EMPTY_MANIFEST,
				manifestKeyPrefix: "owner/my-collection",
			});
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			expect(mockCleanupTempDir).toHaveBeenCalledWith(
				COLLECTION_CLONE_RESULT.tempDir,
			);
		});

		it("collection with multi-asset plugins uses copyPluginAssets", async () => {
			setupCollectionBase();
			const pluginDetected: DetectedType = {
				type: "plugin",
				assetDirs: ["skills", "agents"],
			};
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return pluginDetected;
			});
			mockCopyPluginAssets
				.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/planning/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				})
				.mockResolvedValueOnce({
					copiedFiles: [".claude/agents/reviewer/"],
					assetCountsByAgent: { claude: { agents: 1 } },
				});

			await runAdd("owner/my-collection");

			expect(mockCopyPluginAssets).toHaveBeenCalledTimes(2);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("mixed types install each by type", async () => {
			setupCollectionBase();
			const pluginDetected: DetectedType = {
				type: "plugin",
				assetDirs: ["skills"],
			};
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				if (dir.endsWith("/pluginA"))
					return { type: "bare-skill" } as DetectedType;
				return pluginDetected;
			});
			mockCopyBareSkill.mockResolvedValueOnce({
				copiedFiles: [".claude/skills/pluginA/"],
			});
			mockCopyPluginAssets.mockResolvedValueOnce({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("owner/my-collection");

			expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
			expect(mockCopyPluginAssets).toHaveBeenCalledTimes(1);
		});

		it("manifest keys use owner/repo/plugin-name format", async () => {
			setupCollectionBareSkills();
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			const addEntryCalls = mockAddEntry.mock.calls;
			const keys = addEntryCalls.map((call) => call[1]);
			expect(keys).toContain("owner/my-collection/pluginA");
			expect(keys).toContain("owner/my-collection/pluginB");
		});

		it("agent multiselect called once for the whole collection", async () => {
			setupCollectionBareSkills();
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			// One collection-wide prompt, not one per member.
			expect(mockSelectAgents).toHaveBeenCalledTimes(1);
		});

		it("prompts once over the UNION of member ceilings", async () => {
			setupCollectionBase();
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				if (dir.endsWith("/pluginA")) return { agents: ["claude"] };
				if (dir.endsWith("/pluginB")) return { agents: ["claude", "codex"] };
				return null;
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			mockDetectAgents.mockResolvedValue(["claude", "codex"]);
			const claudeDriver = {
				getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
			};
			const codexDriver = {
				getTargetDir: vi.fn().mockReturnValue(".codex/skills"),
			};
			mockGetDriver.mockImplementation((id: AgentId) => {
				if (id === "claude") return claudeDriver as any;
				return codexDriver as any;
			});
			mockSelectAgents.mockImplementation(async ({ declaredAgents }) =>
				selected([...declaredAgents]),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
			});

			await runAdd("owner/my-collection");

			// One prompt. Candidates = union of pluginA (claude) + pluginB
			// (claude, codex) = [claude, codex], in canonical order, collection label.
			expect(mockSelectAgents).toHaveBeenCalledTimes(1);
			expect(mockSelectAgents).toHaveBeenCalledWith({
				declaredAgents: ["claude", "codex"],
				detectedAgents: ["claude", "codex"],
				unitLabel: "these 2 skills",
			});
		});

		it("a configless member widens the union to all KNOWN_AGENTS", async () => {
			setupCollectionBase();
			// pluginA configless (any agent), pluginB declares codex only
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				if (dir.endsWith("/pluginA")) return null;
				if (dir.endsWith("/pluginB")) return { agents: ["codex"] };
				return null;
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			mockDetectAgents.mockResolvedValue(["claude"]);
			mockGetDriver.mockReturnValue(FAKE_DRIVER);
			mockSelectAgents.mockResolvedValue(selected(["claude"]));
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
			});
			mockComputeIncomingFiles.mockReturnValue([]);
			mockCheckFileCollisions.mockReturnValue(new Map());
			mockCheckUnmanagedConflicts.mockResolvedValue([]);

			await runAdd("owner/my-collection");

			// pluginA (configless) contributes all three; pluginB adds codex (already
			// in). Union = all KNOWN_AGENTS, offered once.
			expect(mockSelectAgents).toHaveBeenCalledTimes(1);
			expect(mockSelectAgents).toHaveBeenCalledWith({
				declaredAgents: ["claude", "codex", "cursor"],
				detectedAgents: ["claude"],
				unitLabel: "these 2 skills",
			});
		});

		it("detectAgents called once for the whole collection (member-independent)", async () => {
			setupCollectionBareSkills();
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			expect(mockDetectAgents).toHaveBeenCalledTimes(1);
		});

		it("invalid agntc.json no longer skips a member — it installs configless", async () => {
			// Under lenient readConfig an unusable member config returns null (it
			// never throws for config problems), so the member installs via the
			// configless default rather than being skipped.
			setupCollectionBase();
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				if (dir.endsWith("/pluginA")) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			mockComputeIncomingFiles.mockReturnValue([]);
			mockCheckFileCollisions.mockReturnValue(new Map());
			mockCheckUnmanagedConflicts.mockResolvedValue([]);
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			// pluginA (null config) is not skipped — both members install.
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			expect(warnCalls.some((m) => m.includes("skipping"))).toBe(false);
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
		});

		it("missing agntc.json no longer skips a member — it installs configless", async () => {
			setupCollectionBase();
			// pluginA is configless (null), pluginB has config — both install
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				if (dir.endsWith("/pluginA")) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			mockComputeIncomingFiles.mockReturnValue([]);
			mockCheckFileCollisions.mockReturnValue(new Map());
			mockCheckUnmanagedConflicts.mockResolvedValue([]);
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			// pluginA (configless) is no longer skipped
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			expect(warnCalls.some((m) => m.includes("no agntc.json found"))).toBe(
				false,
			);
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
		});

		it("not-agntc detected type skips plugin with warning", async () => {
			setupCollectionBase();
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				if (dir.endsWith("/pluginA"))
					return { type: "not-agntc" } as DetectedType;
				return { type: "bare-skill" } as DetectedType;
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginB/"],
			});

			await runAdd("owner/my-collection");

			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("pluginA"),
			);
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
		});

		it("all members skipped (not-agntc) completes without error, no manifest entries", async () => {
			setupCollectionBase();
			mockReadConfig.mockResolvedValue(null);
			// Every member detects as not-agntc => skipped (the only remaining
			// per-member skip reason; config problems are lenient, never a skip).
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "not-agntc" } as DetectedType;
			});

			// Gate removed: all-skipped flows to summary like all-zero-match (no exit)
			await expect(runAdd("owner/my-collection")).resolves.toBeUndefined();
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(
				COLLECTION_CLONE_RESULT.tempDir,
			);
			const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
			expect(
				warnCalls.some((m) => m.includes("No valid plugins to install")),
			).toBe(false);
		});

		it("empty plugin selection cancels cleanly", async () => {
			setupCollectionBase();
			mockSelectCollectionPlugins.mockResolvedValue([]);

			const err = await runAdd("owner/my-collection").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockCancel).toHaveBeenCalledWith(expect.stringMatching(/cancel/i));
			expect(mockCleanupTempDir).toHaveBeenCalledWith(
				COLLECTION_CLONE_RESULT.tempDir,
			);
		});

		it("an empty agent selection cancels the whole collection", async () => {
			// One collection-wide prompt now: picking nothing aborts the whole
			// install cleanly (nothing to install for), rather than per-member skips.
			setupCollectionBase();
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			mockComputeIncomingFiles.mockReturnValue([]);
			mockCheckFileCollisions.mockReturnValue(new Map());
			mockCheckUnmanagedConflicts.mockResolvedValue([]);
			// User deselects everything in the single collection-wide prompt.
			mockSelectAgents.mockResolvedValue(selected([]));

			await expect(runAdd("owner/my-collection")).rejects.toBeInstanceOf(
				ExitSignal,
			);

			expect(mockCancel).toHaveBeenCalledWith("Cancelled — no agents selected");
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(
				COLLECTION_CLONE_RESULT.tempDir,
			);
		});

		it("cancelling the agent prompt cancels the whole collection", async () => {
			// The single prompt is the one decision point — cancelling it (Esc) aborts
			// the whole install, not just one member.
			setupCollectionBareSkills();
			mockSelectAgents.mockReset().mockResolvedValue(cancelledSelection);

			await expect(runAdd("owner/my-collection")).rejects.toBeInstanceOf(
				ExitSignal,
			);

			expect(mockCancel).toHaveBeenCalledWith("Cancelled — no agents selected");
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
		});

		it("single manifest write after all plugins", async () => {
			setupCollectionBareSkills();
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			// addEntry called twice (once per plugin)
			expect(mockAddEntry).toHaveBeenCalledTimes(2);
		});

		it("shows per-plugin summary with counts", async () => {
			setupCollectionBareSkills();
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

			await runAdd("owner/my-collection");

			const outroCall = summaryText();
			expect(outroCall).toContain("pluginA");
			expect(outroCall).toContain("pluginB");
		});

		it("notes skipped plugins in summary", async () => {
			setupCollectionBase();
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				// pluginA detects as not-agntc => skipped; pluginB installs.
				if (dir.endsWith("/pluginA"))
					return { type: "not-agntc" } as DetectedType;
				return { type: "bare-skill" } as DetectedType;
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginB/"],
			});

			await runAdd("owner/my-collection");

			const outroCall = summaryText();
			expect(outroCall).toContain("pluginB");
			expect(outroCall).toMatch(/1.*skipped/i);
		});

		describe("recorded type (per member)", () => {
			function entryForKey(key: string): ManifestEntry | undefined {
				const call = mockAddEntry.mock.calls.find((c) => c[1] === key);
				return call?.[2] as ManifestEntry | undefined;
			}

			it("each member records its resolved type (bare-skill -> skill, plugin -> plugin)", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "bare-skill" } as DetectedType;
					return { type: "plugin", assetDirs: ["skills"] } as DetectedType;
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});
				mockCopyPluginAssets.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/planning/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				});

				await runAdd("owner/my-collection");

				expect(entryForKey("owner/my-collection/pluginA")?.type).toBe("skill");
				expect(entryForKey("owner/my-collection/pluginB")?.type).toBe("plugin");
			});

			it("configless member and config-bearing member both record structural type", async () => {
				setupCollectionBase();
				// pluginA: configless (null) bare skill; pluginB: config-bearing plugin.
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA")) return null;
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "bare-skill" } as DetectedType;
					return { type: "plugin", assetDirs: ["skills"] } as DetectedType;
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});
				mockCopyPluginAssets.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/planning/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				});

				await runAdd("owner/my-collection");

				expect(entryForKey("owner/my-collection/pluginA")?.type).toBe("skill");
				expect(entryForKey("owner/my-collection/pluginB")?.type).toBe("plugin");
			});

			it("does not write a collection-container entry (owner/my-collection)", async () => {
				setupCollectionBareSkills();
				mockCopyBareSkill
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

				await runAdd("owner/my-collection");

				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).not.toContain("owner/my-collection");
			});

			it("skipped member produces no entry and no type", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					// pluginA skipped (not-agntc); pluginB installs as bare skill.
					if (dir.endsWith("/pluginA"))
						return { type: "not-agntc" } as DetectedType;
					return { type: "bare-skill" } as DetectedType;
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginB/"],
				});

				await runAdd("owner/my-collection");

				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).not.toContain("owner/my-collection/pluginA");
				expect(entryForKey("owner/my-collection/pluginB")?.type).toBe("skill");
			});

			it("direct-path single member records its resolved type under owner/repo/<unit>", async () => {
				// Tree URL whose subpath re-detects as a collection; the targeted member
				// installs via the pipeline's direct-path branch, keyed parsed.manifestKey.
				const TREE_PARSED: ParsedSource = {
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "pluginA",
					manifestKey: "owner/my-collection/pluginA",
					cloneUrl: "https://github.com/owner/my-collection.git",
				};
				const unitDir = `${COLLECTION_CLONE_RESULT.tempDir}/pluginA`;
				mockParseSource.mockReturnValue(TREE_PARSED);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === unitDir) {
						return { type: "collection", plugins: ["pluginA"] } as DetectedType;
					}
					return { type: "bare-skill" } as DetectedType;
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd(
					"https://github.com/owner/my-collection/tree/main/pluginA",
				);

				expect(entryForKey("owner/my-collection/pluginA")?.type).toBe("skill");
			});
		});

		describe("nested-collection member backstop (one level only)", () => {
			it("skips a member re-detecting collection with pipeline warning and installs siblings", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return null;
				});
				// pluginA installs (bare-skill); pluginB re-detects as a nested
				// collection => skipped with the pipeline warning.
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "bare-skill" } as DetectedType;
					return { type: "collection", plugins: ["nested"] } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				// Pipeline-emitted warning names the member and the nested reason.
				expect(mockLog.warn).toHaveBeenCalledWith(
					"pluginB: nested collections not supported — skipping",
				);
				// Sibling still installs (skip does not abort the run).
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual(["owner/my-collection/pluginA"]);
				// One level only: the pipeline never re-enters member selection for the
				// nested member (no recursive dispatch / second selection pass).
				expect(mockSelectCollectionPlugins).toHaveBeenCalledTimes(1);
			});

			it("skips a member re-detecting not-agntc with pipeline warning and installs siblings", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "not-agntc" } as DetectedType;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginB/"],
				});

				await runAdd("owner/my-collection");

				expect(mockLog.warn).toHaveBeenCalledWith(
					"pluginA: not a valid agntc plugin — skipping",
				);
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual(["owner/my-collection/pluginB"]);
			});

			it("nested-collection warning is emitted by the pipeline, not the detector", async () => {
				setupCollectionBase();
				mockReadConfig.mockResolvedValue(null);
				// detectType (the detector) stays SILENT for the nested member — it
				// never calls its onWarn with the nested message. The pipeline must
				// still surface the warning.
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "collection", plugins: ["nested"] } as DetectedType;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginB/"],
				});

				await runAdd("owner/my-collection");

				// The detector mock was never asked to emit the nested message via its
				// onWarn callback; the warning came solely from the pipeline.
				const nestedWarns = mockLog.warn.mock.calls
					.map((c) => c[0] as string)
					.filter((m) => m.includes("nested collections not supported"));
				expect(nestedWarns).toEqual([
					"pluginA: nested collections not supported — skipping",
				]);
			});

			it("recurses one level only — no second selection pass for the nested member", async () => {
				setupCollectionBase();
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "collection", plugins: ["nested"] } as DetectedType;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginB/"],
				});

				await runAdd("owner/my-collection");

				// One pipeline pass: selection happens exactly once and detectType is
				// never called on the nested member's grandchildren.
				expect(mockSelectCollectionPlugins).toHaveBeenCalledTimes(1);
				const detectedDirs = mockDetectType.mock.calls.map(([dir]) => dir);
				expect(detectedDirs.some((d) => d.endsWith("/nested"))).toBe(false);
			});

			it("summary counts a skipped nested-collection member as skipped", async () => {
				setupCollectionBase();
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "bare-skill" } as DetectedType;
					return { type: "collection", plugins: ["nested"] } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				const outroCall = summaryText();
				expect(outroCall).toContain("pluginA");
				expect(outroCall).toMatch(/1.*skipped/i);
			});

			it("all members nested/not-agntc are all skipped with no install and no error", async () => {
				setupCollectionBase();
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "collection", plugins: ["nested"] } as DetectedType;
					return { type: "not-agntc" } as DetectedType;
				});

				await expect(runAdd("owner/my-collection")).resolves.toBeUndefined();

				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockCopyPluginAssets).not.toHaveBeenCalled();
				expect(mockAddEntry).not.toHaveBeenCalled();
				const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
				expect(warnCalls).toContain(
					"pluginA: nested collections not supported — skipping",
				);
				expect(warnCalls).toContain(
					"pluginB: not a valid agntc plugin — skipping",
				);
			});

			it("tree-path selector pointing at a member that is itself a collection skips with the nested warning", async () => {
				const treeParsed: ParsedSource = {
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "pluginB",
					manifestKey: "owner/my-collection/pluginB",
				};
				mockParseSource.mockReturnValue(treeParsed);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				// Root unitDir resolves to the selected member dir (direct-path); it is
				// detected as a collection, so the pipeline runs with the member as the
				// single selected plugin, which then re-detects as a collection.
				mockDetectType.mockImplementation(async (dir) => {
					if (dir.endsWith("/pluginB/pluginB"))
						return { type: "collection", plugins: ["nested"] } as DetectedType;
					return {
						type: "collection",
						plugins: ["pluginB"],
					} as DetectedType;
				});

				await runAdd("owner/my-collection");

				expect(mockLog.warn).toHaveBeenCalledWith(
					"pluginB: nested collections not supported — skipping",
				);
				expect(mockAddEntry).not.toHaveBeenCalled();
			});
		});

		it("cleanup on collection success", async () => {
			setupCollectionBareSkills();
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
			});

			await runAdd("owner/my-collection");

			expect(mockCleanupTempDir).toHaveBeenCalledWith(
				COLLECTION_CLONE_RESULT.tempDir,
			);
		});

		it("cleanup on collection error", async () => {
			setupCollectionBase();
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			// Simulate unexpected error during copy
			mockCopyBareSkill.mockRejectedValue(new Error("unexpected"));

			await runAdd("owner/my-collection").catch(() => {});

			expect(mockCleanupTempDir).toHaveBeenCalledWith(
				COLLECTION_CLONE_RESULT.tempDir,
			);
		});

		it("passes pluginDir as sourceDir to copyBareSkill so skillName derives from pluginName", async () => {
			setupCollectionBase();
			mockSelectCollectionPlugins.mockResolvedValue(["pluginA"]);
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
			});

			await runAdd("owner/my-collection");

			const copyCall = mockCopyBareSkill.mock.calls[0]![0];
			expect(copyCall.sourceDir).toBe(
				COLLECTION_CLONE_RESULT.tempDir + "/pluginA",
			);
		});

		describe("independent failure handling", () => {
			function setupCollectionForFailure(): void {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA")) return PLUGIN_A_CONFIG;
					if (dir.endsWith("/pluginB")) return PLUGIN_B_CONFIG;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA")) return PLUGIN_A_BARE;
					if (dir.endsWith("/pluginB")) return PLUGIN_B_BARE;
					return { type: "not-agntc" };
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockResolveUnmanagedConflicts.mockResolvedValue({
					approved: [],
					cancelled: [],
				});
			}

			it("first plugin copy fails, second succeeds — only second gets manifest entry", async () => {
				setupCollectionForFailure();
				mockCopyBareSkill
					.mockRejectedValueOnce(new Error("disk full"))
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});

				// A failed member now exits non-zero AFTER committing siblings (spec:
				// Partial outcomes — multi-member install exit-status contract).
				const err = await runAdd("owner/my-collection").catch((e) => e);
				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);

				// addEntry should only be called for pluginB
				expect(mockAddEntry).toHaveBeenCalledTimes(1);
				expect(mockAddEntry).toHaveBeenCalledWith(
					expect.anything(),
					"owner/my-collection/pluginB",
					expect.objectContaining({
						files: [".claude/skills/pluginB/"],
					}),
				);
			});

			it("all plugin copies fail — no manifest entries, exits non-zero after summary", async () => {
				setupCollectionForFailure();
				mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

				// A failed member exits non-zero, but only after the write + summary.
				const err = await runAdd("owner/my-collection").catch((e) => e);
				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);

				// No addEntry calls for failed plugins
				expect(mockAddEntry).not.toHaveBeenCalled();
				// Manifest still written once (with no additions)
				expect(mockWriteManifest).toHaveBeenCalledTimes(1);
				// Summary mentions failures
				const outroCall = summaryText();
				expect(outroCall).toMatch(/pluginA: failed —/);
				expect(outroCall).toMatch(/pluginB: failed —/);
			});

			it("failed plugin allows subsequent plugins to install", async () => {
				setupCollectionForFailure();
				mockCopyBareSkill
					.mockRejectedValueOnce(new Error("permission denied"))
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});

				await runAdd("owner/my-collection").catch(() => {});

				// pluginB was still copied despite pluginA failing
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
				const secondCall = mockCopyBareSkill.mock.calls[1]![0];
				expect(secondCall.sourceDir).toBe(
					COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
				);
			});

			it("single manifest write even with mixed success and failure", async () => {
				setupCollectionForFailure();
				mockCopyBareSkill
					.mockRejectedValueOnce(new Error("copy error"))
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});

				await runAdd("owner/my-collection").catch(() => {});

				expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			});

			it("error message from copy failure appears in summary", async () => {
				setupCollectionForFailure();
				mockCopyBareSkill
					.mockRejectedValueOnce(new Error("ENOSPC: no space left"))
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});

				await runAdd("owner/my-collection").catch(() => {});

				const outroCall = summaryText();
				expect(outroCall).toMatch(/pluginA: failed — ENOSPC: no space left/);
			});

			// Rollback on copy failure is delegated to the copy functions themselves
			// (copyBareSkill / copyPluginAssets). Those rollback behaviors are tested
			// in cs-5-8's copy function test suites.

			it("both plugins succeed — both get manifest entries, no failures in summary", async () => {
				setupCollectionForFailure();
				mockCopyBareSkill
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginA/"],
					})
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});

				await runAdd("owner/my-collection");

				// Both plugins should get manifest entries
				expect(mockAddEntry).toHaveBeenCalledTimes(2);
				expect(mockAddEntry).toHaveBeenCalledWith(
					expect.anything(),
					"owner/my-collection/pluginA",
					expect.objectContaining({
						files: [".claude/skills/pluginA/"],
					}),
				);
				expect(mockAddEntry).toHaveBeenCalledWith(
					expect.anything(),
					"owner/my-collection/pluginB",
					expect.objectContaining({
						files: [".claude/skills/pluginB/"],
					}),
				);
				// Summary should mention both plugins but not "failed"
				const outroCall = summaryText();
				expect(outroCall).toContain("pluginA");
				expect(outroCall).toContain("pluginB");
				expect(outroCall).not.toMatch(/failed/);
				expect(outroCall).not.toMatch(/skipped/);
			});

			it("one plugin skipped (not-agntc) and another fails during copy — both tracked in summary", async () => {
				setupCollectionBase();
				// pluginA: detects as not-agntc => skipped
				// pluginB: succeeds readConfig but fails during copy
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginB")) return PLUGIN_B_CONFIG;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginB")) return PLUGIN_B_BARE;
					return { type: "not-agntc" };
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockRejectedValueOnce(new Error("permission denied"));

				// A failed member (pluginB) exits non-zero; a skipped member alone
				// would not. Side effects (summary, no entries) still hold.
				const err = await runAdd("owner/my-collection").catch((e) => e);
				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);

				// No manifest entries — one skipped, one failed
				expect(mockAddEntry).not.toHaveBeenCalled();
				// Summary should show 1 skipped and pluginB failed
				const outroCall = summaryText();
				expect(outroCall).toMatch(/1 skipped/);
				expect(outroCall).toMatch(/pluginB: failed — permission denied/);
			});

			it("three plugins: one installed, one copy fails, one skipped — manifest entry only for installed", async () => {
				// Setup with 3 plugins
				const THREE_PLUGIN_DETECTED: DetectedType = {
					type: "collection",
					plugins: ["pluginA", "pluginB", "pluginC"],
				};
				setupCollectionBase();
				mockSelectCollectionPlugins.mockResolvedValue([
					"pluginA",
					"pluginB",
					"pluginC",
				]);
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return THREE_PLUGIN_DETECTED;
					// pluginC detects as not-agntc => skipped.
					if (dir.endsWith("/pluginC"))
						return { type: "not-agntc" } as DetectedType;
					return { type: "bare-skill" } as DetectedType;
				});
				// pluginA: valid config, will be installed
				// pluginB: valid config, copy will fail
				// pluginC: not-agntc => skipped
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude"] };
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginA/"],
					})
					.mockRejectedValueOnce(new Error("disk full"));

				// pluginB failed -> non-zero exit after committing pluginA + summary.
				const err = await runAdd("owner/my-collection").catch((e) => e);
				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);

				// Only pluginA should get a manifest entry
				expect(mockAddEntry).toHaveBeenCalledTimes(1);
				expect(mockAddEntry).toHaveBeenCalledWith(
					expect.anything(),
					"owner/my-collection/pluginA",
					expect.objectContaining({
						files: [".claude/skills/pluginA/"],
					}),
				);
				// Summary: pluginA installed, pluginB failed, pluginC skipped
				const outroCall = summaryText();
				expect(outroCall).toContain("pluginA");
				expect(outroCall).toMatch(/pluginB: failed — disk full/);
				expect(outroCall).toMatch(/1 skipped/);
			});

			it("a child IO error still propagates (not swallowed by config leniency)", async () => {
				setupCollectionBase();
				// A genuine non-ENOENT IO error (EACCES) from a member's readConfig is
				// NOT a config-leniency case — it must abort the whole pipeline via the
				// outer catch (exit 1), never be swallowed as a per-member skip.
				const ioError = Object.assign(new Error("permission denied"), {
					code: "EACCES",
				});
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA")) throw ioError;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});

				const err = await runAdd("owner/my-collection").catch((e) => e);
				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				expect(mockAddEntry).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});
		});

		describe("per-plugin agent filtering", () => {
			function setupCollectionWithDifferentAgents(): void {
				setupCollectionBase();
				// pluginA declares claude only, pluginB declares codex only
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA"))
						return { agents: ["claude"] as AgentId[] };
					if (dir.endsWith("/pluginB"))
						return { agents: ["codex"] as AgentId[] };
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockDetectAgents.mockResolvedValue(["claude", "codex"]);
				// Per-member selectAgents returns that member's declared ceiling.
				mockSelectAgents.mockImplementation(async ({ declaredAgents }) =>
					selected([...declaredAgents]),
				);
				const claudeDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
				};
				const codexDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".agents/skills"),
				};
				mockGetDriver.mockImplementation((id: AgentId) => {
					if (id === "claude") return claudeDriver as any;
					return codexDriver as any;
				});
				mockCopyBareSkill
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginA/"],
					})
					.mockResolvedValueOnce({
						copiedFiles: [".agents/skills/pluginB/"],
					});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
			}

			it("filters selectedAgents to plugin's declared agents before copy -- pluginA (claude-only) receives only claude driver", async () => {
				setupCollectionWithDifferentAgents();

				await runAdd("owner/my-collection");

				const copyCalls = mockCopyBareSkill.mock.calls;
				expect(copyCalls).toHaveLength(2);
				// pluginA copy call (first) should only have claude
				const pluginAAgents = copyCalls[0]![0].agents.map(
					(a: { id: AgentId }) => a.id,
				);
				expect(pluginAAgents).toEqual(["claude"]);
			});

			it("filters selectedAgents to plugin's declared agents before copy -- pluginB (codex-only) receives only codex driver", async () => {
				setupCollectionWithDifferentAgents();

				await runAdd("owner/my-collection");

				const copyCalls = mockCopyBareSkill.mock.calls;
				expect(copyCalls).toHaveLength(2);
				// pluginB copy call (second) should only have codex
				const pluginBAgents = copyCalls[1]![0].agents.map(
					(a: { id: AgentId }) => a.id,
				);
				expect(pluginBAgents).toEqual(["codex"]);
			});

			it("manifest entry for each plugin records only its applicable agents", async () => {
				setupCollectionWithDifferentAgents();

				await runAdd("owner/my-collection");

				const addEntryCalls = mockAddEntry.mock.calls;
				expect(addEntryCalls).toHaveLength(2);
				// pluginA manifest entry should only have claude
				const pluginAEntry = addEntryCalls.find(
					(c) => (c[1] as string) === "owner/my-collection/pluginA",
				);
				expect(pluginAEntry).toBeDefined();
				expect(pluginAEntry![2].agents).toEqual(["claude"]);
				// pluginB manifest entry should only have codex
				const pluginBEntry = addEntryCalls.find(
					(c) => (c[1] as string) === "owner/my-collection/pluginB",
				);
				expect(pluginBEntry).toBeDefined();
				expect(pluginBEntry![2].agents).toEqual(["codex"]);
			});

			it("no 'does not declare support' warnings are logged", async () => {
				setupCollectionWithDifferentAgents();

				await runAdd("owner/my-collection");

				const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
				const compatWarnings = warnCalls.filter((msg) =>
					msg.includes("does not declare support for"),
				);
				expect(compatWarnings).toHaveLength(0);
			});

			it("plugin declaring exact same agents as selected receives all agents (no-op filter)", async () => {
				setupCollectionBase();
				// Both plugins declare claude and codex
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude", "codex"] as AgentId[] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockDetectAgents.mockResolvedValue(["claude", "codex"]);
				mockSelectAgents.mockImplementation(async ({ declaredAgents }) =>
					selected([...declaredAgents]),
				);
				const claudeDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
				};
				const codexDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".agents/skills"),
				};
				mockGetDriver.mockImplementation((id: AgentId) => {
					if (id === "claude") return claudeDriver as any;
					return codexDriver as any;
				});
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/", ".agents/skills/pluginA/"],
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);

				await runAdd("owner/my-collection");

				const copyCalls = mockCopyBareSkill.mock.calls;
				for (const call of copyCalls) {
					const agentIds = call[0].agents.map((a: { id: AgentId }) => a.id);
					expect(agentIds).toEqual(["claude", "codex"]);
				}
			});

			it("all plugins declaring identical agents behaves like unfiltered code", async () => {
				setupCollectionBase();
				// Both plugins declare only claude, selectedAgents is also only claude
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude"] as AgentId[] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockSelectAgents.mockImplementation(async ({ declaredAgents }) =>
					selected([...declaredAgents]),
				);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/"],
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);

				await runAdd("owner/my-collection");

				const copyCalls = mockCopyBareSkill.mock.calls;
				expect(copyCalls).toHaveLength(2);
				for (const call of copyCalls) {
					const agentIds = call[0].agents.map((a: { id: AgentId }) => a.id);
					expect(agentIds).toEqual(["claude"]);
				}
				// Manifest entries also have only claude
				const addEntryCalls = mockAddEntry.mock.calls;
				for (const call of addEntryCalls) {
					expect(call[2].agents).toEqual(["claude"]);
				}
			});

			it("computeIncomingFiles receives per-plugin filtered agents", async () => {
				setupCollectionWithDifferentAgents();

				await runAdd("owner/my-collection");

				const computeCalls = mockComputeIncomingFiles.mock.calls;
				expect(computeCalls).toHaveLength(2);
				// pluginA: only claude agent
				const pluginAInput = computeCalls[0]![0];
				const pluginAAgentIds = pluginAInput.agents.map(
					(a: { id: AgentId }) => a.id,
				);
				expect(pluginAAgentIds).toEqual(["claude"]);
				// pluginB: only codex agent
				const pluginBInput = computeCalls[1]![0];
				const pluginBAgentIds = pluginBInput.agents.map(
					(a: { id: AgentId }) => a.id,
				);
				expect(pluginBAgentIds).toEqual(["codex"]);
			});

			it("prompts once over the union of differing member ceilings", async () => {
				setupCollectionWithDifferentAgents();

				await runAdd("owner/my-collection");

				// One prompt; candidates = union of pluginA (claude) + pluginB (codex).
				expect(mockSelectAgents).toHaveBeenCalledTimes(1);
				expect(mockSelectAgents).toHaveBeenCalledWith({
					declaredAgents: ["claude", "codex"],
					detectedAgents: ["claude", "codex"],
					unitLabel: "these 2 skills",
				});
			});

			it("config-bearing single-declared-detected member auto-selects (no prompt) via Phase 1 contract", async () => {
				setupCollectionBase();
				// Single-plugin collection: declares claude only, claude detected.
				const singlePluginCollection: DetectedType = {
					type: "collection",
					plugins: ["pluginA"],
				};
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA"]);
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA"))
						return { agents: ["claude"] as AgentId[] };
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return singlePluginCollection;
					return { type: "bare-skill" } as DetectedType;
				});
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				// selectAgents auto-selects: returns the single declared agent.
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/"],
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);

				await runAdd("owner/my-collection");

				// Union is a single detected agent → auto-select, no prompt content to
				// pick. The collection-wide call still carries the collection label.
				expect(mockSelectAgents).toHaveBeenCalledTimes(1);
				expect(mockSelectAgents).toHaveBeenCalledWith({
					declaredAgents: ["claude"],
					detectedAgents: ["claude"],
					unitLabel: "this skill",
				});
				const addEntryCalls = mockAddEntry.mock.calls;
				const pluginAEntry = addEntryCalls.find(
					(c) => (c[1] as string) === "owner/my-collection/pluginA",
				);
				expect(pluginAEntry![2].agents).toEqual(["claude"]);
			});

			it("mixed ceilings resolve against one collection-wide pick", async () => {
				setupCollectionBase();
				// pluginA: claude-only ceiling. pluginB: configless (any agent).
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA"))
						return { agents: ["claude"] as AgentId[] };
					if (dir.endsWith("/pluginB")) return null;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockDetectAgents.mockResolvedValue(["claude"]);
				const claudeDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
				};
				const codexDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".agents/skills"),
				};
				mockGetDriver.mockImplementation((id: AgentId) => {
					if (id === "claude") return claudeDriver as any;
					return codexDriver as any;
				});
				// Union = [claude, codex, cursor] (pluginB configless widens it). The
				// installer picks claude + codex from the single prompt.
				mockSelectAgents.mockResolvedValue(selected(["claude", "codex"]));
				mockCopyBareSkill
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
					.mockResolvedValueOnce({ copiedFiles: [".agents/skills/pluginB/"] });
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);

				await runAdd("owner/my-collection");

				// One prompt; pluginA intersects pick to its claude ceiling, pluginB
				// (configless) takes the full pick.
				expect(mockSelectAgents).toHaveBeenCalledTimes(1);
				const addEntryCalls = mockAddEntry.mock.calls;
				const pluginAEntry = addEntryCalls.find(
					(c) => (c[1] as string) === "owner/my-collection/pluginA",
				);
				const pluginBEntry = addEntryCalls.find(
					(c) => (c[1] as string) === "owner/my-collection/pluginB",
				);
				expect(pluginAEntry![2].agents).toEqual(["claude"]);
				expect(pluginBEntry![2].agents).toEqual(["claude", "codex"]);
			});
		});

		describe("zero-overlap members (ceiling excludes the collection-wide pick)", () => {
			function setupZeroMatchCollection(opts: {
				pluginAAgents: AgentId[];
				pluginBAgents: AgentId[];
				selectedAgents: AgentId[];
			}): void {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA")) return { agents: opts.pluginAAgents };
					if (dir.endsWith("/pluginB")) return { agents: opts.pluginBAgents };
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockDetectAgents.mockResolvedValue(["claude", "codex"]);
				// One collection-wide prompt: selectAgents is called once with the union
				// of member ceilings. The installer's effective pick is that union
				// intersected with what they want (opts.selectedAgents). Production then
				// intersects this pick with EACH member's own ceiling; a member with no
				// overlap is skipped (noted), and an empty pick cancels the collection.
				const selectedSet = new Set(opts.selectedAgents);
				mockSelectAgents.mockImplementation(async ({ declaredAgents }) =>
					selected(declaredAgents.filter((id) => selectedSet.has(id))),
				);
				const claudeDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".claude/skills"),
				};
				const codexDriver = {
					detect: vi.fn().mockResolvedValue(true),
					getTargetDir: vi.fn().mockReturnValue(".agents/skills"),
				};
				mockGetDriver.mockImplementation((id: AgentId) => {
					if (id === "claude") return claudeDriver as any;
					return codexDriver as any;
				});
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/"],
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
			}

			it("plugin with zero applicable agents is silently skipped -- no copy, no manifest entry", async () => {
				// pluginA declares claude, pluginB declares codex; user selects only claude
				// => pluginB has zero applicable agents and should be skipped entirely
				setupZeroMatchCollection({
					pluginAAgents: ["claude"],
					pluginBAgents: ["codex"],
					selectedAgents: ["claude"],
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				// Only one copy call (pluginA), pluginB is skipped
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				// Only one manifest entry (pluginA)
				expect(mockAddEntry).toHaveBeenCalledTimes(1);
				expect(mockAddEntry).toHaveBeenCalledWith(
					expect.anything(),
					"owner/my-collection/pluginA",
					expect.objectContaining({ agents: ["claude"] }),
				);
			});

			it("zero-match plugin does not appear in summary output", async () => {
				setupZeroMatchCollection({
					pluginAAgents: ["claude"],
					pluginBAgents: ["codex"],
					selectedAgents: ["claude"],
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				const outroCall = summaryText();
				// pluginA should appear in summary
				expect(outroCall).toContain("pluginA");
				// pluginB should NOT appear anywhere in summary
				expect(outroCall).not.toContain("pluginB");
			});

			it("an all-excluded selection (empty effective pick) cancels the collection", async () => {
				// pluginA + pluginB both codex-only → union = [codex]; the installer
				// picks nothing matching → empty pick → whole-collection cancel.
				setupZeroMatchCollection({
					pluginAAgents: ["codex"],
					pluginBAgents: ["codex"],
					selectedAgents: ["claude"],
				});

				await expect(runAdd("owner/my-collection")).rejects.toBeInstanceOf(
					ExitSignal,
				);
				expect(mockCancel).toHaveBeenCalledWith(
					"Cancelled — no agents selected",
				);
				expect(mockAddEntry).not.toHaveBeenCalled();
			});

			it("a zero-overlap member is tallied as skipped in the summary", async () => {
				// pluginA claude-only, pluginB codex-only; pick claude → pluginB has no
				// overlap and is skipped (noted), pluginA installs.
				setupZeroMatchCollection({
					pluginAAgents: ["claude"],
					pluginBAgents: ["codex"],
					selectedAgents: ["claude"],
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				const outroCall = summaryText();
				expect(outroCall).toContain("pluginA");
				expect(outroCall).toMatch(/1 skipped/);
			});

			it("single-member collection: an empty pick cancels", async () => {
				setupCollectionBase();
				const singlePluginCollection: DetectedType = {
					type: "collection",
					plugins: ["pluginA"],
				};
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA"))
						return { agents: ["codex"] as AgentId[] };
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return singlePluginCollection;
					return { type: "bare-skill" } as DetectedType;
				});
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				// The single prompt is deselected entirely.
				mockSelectAgents.mockResolvedValue(selected([]));
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);

				await expect(runAdd("owner/my-collection")).rejects.toBeInstanceOf(
					ExitSignal,
				);
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockCopyPluginAssets).not.toHaveBeenCalled();
				expect(mockAddEntry).not.toHaveBeenCalled();
			});

			it("mix of installable and zero-match plugins -- only installable plugins get manifest entries and summary lines", async () => {
				setupZeroMatchCollection({
					pluginAAgents: ["claude"],
					pluginBAgents: ["codex"],
					selectedAgents: ["claude"],
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				// Only pluginA gets copied and manifest entry
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				expect(mockAddEntry).toHaveBeenCalledTimes(1);

				const outroCall = summaryText();
				expect(outroCall).toContain("pluginA");
				expect(outroCall).not.toContain("pluginB");
				// pluginB is a zero-overlap member → tallied as skipped (noted now).
				expect(outroCall).toMatch(/1 skipped/);
			});

			it("a zero-overlap member is noted with a clear skip warning", async () => {
				setupZeroMatchCollection({
					pluginAAgents: ["claude"],
					pluginBAgents: ["codex"],
					selectedAgents: ["claude"],
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				// pluginB (codex-only, codex not picked) is skipped WITH a clear reason
				// naming the member and its author restriction.
				const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
				expect(
					warnCalls.some(
						(msg) => msg.includes("pluginB") && msg.includes("skipped"),
					),
				).toBe(true);
			});
		});

		describe("structural membership without config dependency", () => {
			it("installs a configless member (null per-child config no longer skipped)", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					// Both members configless
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

				await runAdd("owner/my-collection");

				// Both configless members install
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
				expect(mockAddEntry).toHaveBeenCalledTimes(2);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toContain("owner/my-collection/pluginA");
				expect(keys).toContain("owner/my-collection/pluginB");
			});

			it("does not warn 'no agntc.json found — skipping' for a null-config member", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/plugin/"],
				});

				await runAdd("owner/my-collection");

				const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
				expect(warnCalls.some((m) => m.includes("no agntc.json found"))).toBe(
					false,
				);
			});

			it("all-configless collection does not exit with 'No valid plugins to install'", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/plugin/"],
				});

				await expect(runAdd("owner/my-collection")).resolves.toBeUndefined();

				const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
				expect(
					warnCalls.some((m) => m.includes("No valid plugins to install")),
				).toBe(false);
			});

			it("config-bearing and configless members coexist (both install)", async () => {
				setupCollectionBase();
				// pluginA has config, pluginB is configless
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					if (dir.endsWith("/pluginA")) return { agents: ["claude"] };
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

				await runAdd("owner/my-collection");

				expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toContain("owner/my-collection/pluginA");
				expect(keys).toContain("owner/my-collection/pluginB");
			});

			it("member excluded only by structural re-detect (not by null config)", async () => {
				setupCollectionBase();
				// Both configless; pluginA re-detects as not-agntc, pluginB as bare-skill
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "not-agntc" } as DetectedType;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginB/"],
				});

				await runAdd("owner/my-collection");

				// Only pluginB installs; pluginA dropped by structural re-detect
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual(["owner/my-collection/pluginB"]);
			});

			it("per-child detectType is called with Phase 1 options (no hasConfig)", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/plugin/"],
				});

				await runAdd("owner/my-collection");

				const childCalls = mockDetectType.mock.calls.filter(
					([dir]) => dir !== COLLECTION_CLONE_RESULT.tempDir,
				);
				expect(childCalls.length).toBeGreaterThan(0);
				for (const call of childCalls) {
					const opts = call[1] as Record<string, unknown>;
					expect(opts).not.toHaveProperty("hasConfig");
					expect(opts).toHaveProperty("onWarn");
				}
			});

			it("all-configless collection installs members keyed owner/repo/<unit>", async () => {
				setupCollectionBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

				await runAdd("owner/my-collection");

				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual([
					"owner/my-collection/pluginA",
					"owner/my-collection/pluginB",
				]);
			});
		});

		// Phase 3 task 3-6: pipeline selection targets the STRUCTURAL member set
		// (detected.plugins via Phase 1 qualifiesAsMember). After the Phase 2 task
		// 2-3 reroute a tree URL detects against unitDir = sourceDir/targetPlugin,
		// so the pipeline's direct-path branch is reached ONLY when that SUBPATH
		// itself re-detects as a collection. In that branch membership is checked
		// against the structural list; a selector naming a non-member errors
		// clearly with no install, and a member selector installs the single unit
		// without prompting, keyed parsed.manifestKey (owner/repo/<subpath>).
		describe("pipeline selection over the structural member set", () => {
			// A direct-path source whose subpath re-detects as a collection: the
			// pipeline runs with sourceDir = unitDir (root/<targetPlugin>) and its
			// members live one level below that.
			const TREE_PARSED: ParsedSource = {
				type: "direct-path",
				owner: "owner",
				repo: "my-collection",
				ref: "main",
				targetPlugin: "pluginA",
				manifestKey: "owner/my-collection/pluginA",
				cloneUrl: "https://github.com/owner/my-collection.git",
			};
			const UNIT_DIR = `${COLLECTION_CLONE_RESULT.tempDir}/pluginA`;

			function setupTreeCollection(plugins: string[]): void {
				mockParseSource.mockReturnValue(TREE_PARSED);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				// unitDir re-detects as a collection of `plugins`; the targeted member
				// itself is a bare skill one level below unitDir.
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === UNIT_DIR) {
						return { type: "collection", plugins } as DetectedType;
					}
					return { type: "bare-skill" } as DetectedType;
				});
			}

			it("tree-path selector targeting a non-member errors clearly with no install", async () => {
				// targetPlugin "pluginA" is NOT in the subpath collection's structural
				// member list [alpha, beta] -> the direct-path branch throws naming the
				// missing target and listing the structural members; outer catch maps
				// to exit 1 with no copy and no manifest write.
				setupTreeCollection(["alpha", "beta"]);

				const err = await runAdd(
					"https://github.com/owner/my-collection/tree/main/pluginA",
				).catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				const cancelMsgs = mockCancel.mock.calls.map((c) => c[0] as string);
				expect(cancelMsgs.some((m) => m.includes("pluginA"))).toBe(true);
				expect(cancelMsgs.some((m) => m.includes("alpha"))).toBe(true);
				expect(cancelMsgs.some((m) => m.includes("beta"))).toBe(true);
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
				expect(mockAddEntry).not.toHaveBeenCalled();
			});

			it("tree-path selector installs the single targeted member without prompting, keyed parsed.manifestKey", async () => {
				// targetPlugin "pluginA" IS a structural member of the subpath
				// collection -> the direct-path branch selects exactly that member, no
				// prompt, and keys it parsed.manifestKey (owner/repo/<subpath>).
				setupTreeCollection(["pluginA", "other"]);
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd(
					"https://github.com/owner/my-collection/tree/main/pluginA",
				);

				expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				expect(mockAddEntry).toHaveBeenCalledTimes(1);
				expect(mockAddEntry.mock.calls[0]![1]).toBe(
					"owner/my-collection/pluginA",
				);
			});

			it("select-all (non-direct-path) presents the structural list and installs every member", async () => {
				// detected.plugins IS the structural member set; select-all returns all
				// members and the per-member loop installs each, keyed owner/repo/<unit>.
				setupCollectionBase();
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });

				await runAdd("owner/my-collection");

				expect(mockSelectCollectionPlugins).toHaveBeenCalledWith({
					plugins: COLLECTION_DETECTED.plugins,
					manifest: EMPTY_MANIFEST,
					manifestKeyPrefix: "owner/my-collection",
				});
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual([
					"owner/my-collection/pluginA",
					"owner/my-collection/pluginB",
				]);
			});
		});

		// Phase 3 task 3-5: a stray root agntc.json must never reclassify a
		// member-dirs collection. Structure decides; the root config is never read
		// as an installable unit config. A root type:plugin contradicts the
		// member-dirs structure and is a hard error pre-flight (Phase 1 task 1-4
		// conflict + Phase 2 task 2-2 identity-prefixing).
		describe("stray root agntc.json on a member-dirs collection", () => {
			const COLLECTION_PARSED: ParsedSource = {
				type: "github-shorthand",
				owner: "owner",
				repo: "my-collection",
				ref: "main",
				manifestKey: "owner/my-collection",
			};

			const COLLECTION_CLONE_RESULT: CloneResult = {
				tempDir: "/tmp/agntc-coll-stray",
				commit: "stray123def456",
			};

			const COLLECTION_DETECTED: DetectedType = {
				type: "collection",
				plugins: ["pluginA", "pluginB"],
			};

			function setupMemberDirsBase(): void {
				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/"],
				});
			}

			it("stray root agntc.json with no type does not reclassify — collection runs, root config not passed to pipeline as a unit config", async () => {
				setupMemberDirsBase();
				// Root agntc.json present but carries NO type (only agents). Members
				// resolve via their own configs.
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return { agents: ["claude"] };
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" };
				});

				await runAdd("owner/my-collection");

				// Structure decided: collection pipeline entered.
				expect(mockSelectCollectionPlugins).toHaveBeenCalledWith({
					plugins: ["pluginA", "pluginB"],
					manifest: EMPTY_MANIFEST,
					manifestKeyPrefix: "owner/my-collection",
				});
				// Members installed under collection-prefixed keys — root config did
				// not collapse the collection into a single bundled unit.
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual([
					"owner/my-collection/pluginA",
					"owner/my-collection/pluginB",
				]);
				// Standalone single-unit path never taken.
				expect(mockCancel).not.toHaveBeenCalled();
			});

			it("root detectType receives the root config type as configType (undefined when no type)", async () => {
				setupMemberDirsBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return { agents: ["claude"] };
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" };
				});

				await runAdd("owner/my-collection");

				// First detectType call is the single root detection. A typeless root
				// config forwards configType: undefined → structure stands.
				const rootCall = mockDetectType.mock.calls.find(
					(c) => c[0] === COLLECTION_CLONE_RESULT.tempDir,
				);
				expect(rootCall).toBeDefined();
				const opts = rootCall?.[1] as Record<string, unknown>;
				expect(opts.configType).toBeUndefined();
			});

			it("root agntc.json type:plugin on member-dirs is a hard error pre-flight — forwards configType:plugin, surfaces identity-prefixed cancel + ExitSignal(1)", async () => {
				setupMemberDirsBase();
				// Root config declares type:plugin.
				mockReadConfig.mockResolvedValue({
					agents: ["claude"],
					type: "plugin",
				});
				// Phase 1 task 1-4: member-dirs + configType:plugin → TypeConflictError.
				mockDetectType.mockRejectedValue(
					new TypeConflictError(
						"its structure is a collection of 2 members — cannot bundle",
					),
				);

				const err = await runAdd("owner/my-collection").catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				// Identity-prefixed cancel names the source and the structural half.
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("owner/my-collection"),
				);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("cannot bundle"),
				);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("collection of 2 members"),
				);
			});

			it("root agntc.json type:plugin forwards configType:plugin into the single root detectType call", async () => {
				setupMemberDirsBase();
				mockReadConfig.mockResolvedValue({
					agents: ["claude"],
					type: "plugin",
				});
				mockDetectType.mockRejectedValue(
					new TypeConflictError(
						"its structure is a collection of 2 members — cannot bundle",
					),
				);

				await runAdd("owner/my-collection").catch(() => {});

				expect(mockDetectType).toHaveBeenCalledWith(
					COLLECTION_CLONE_RESULT.tempDir,
					expect.objectContaining({ configType: "plugin" }),
				);
			});

			it("root type:plugin error is pre-flight: pipeline never entered, no copy, no manifest write", async () => {
				setupMemberDirsBase();
				mockReadConfig.mockResolvedValue({
					agents: ["claude"],
					type: "plugin",
				});
				mockDetectType.mockRejectedValue(
					new TypeConflictError(
						"its structure is a collection of 2 members — cannot bundle",
					),
				);

				await runAdd("owner/my-collection").catch(() => {});

				// Collection pipeline never entered.
				expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
				// No writes of any kind.
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockCopyPluginAssets).not.toHaveBeenCalled();
				expect(mockAddEntry).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
				// Temp dir still cleaned up.
				expect(mockCleanupTempDir).toHaveBeenCalledWith(
					COLLECTION_CLONE_RESULT.tempDir,
				);
			});

			it("root config is never read by the pipeline as an installable unit config — only child configs source agents", async () => {
				setupMemberDirsBase();
				// Root config declares agents: ["codex"] (typeless). If the pipeline
				// wrongly threaded the root config as a unit config, selectAgents would
				// see declaredAgents:["codex"]. Members declare ["claude"]; every
				// selectAgents call must carry the per-member ceiling, never the root's.
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return { agents: ["codex"] };
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" };
				});

				await runAdd("owner/my-collection");

				// One collection-wide prompt over the UNION of MEMBER ceilings
				// (["claude"]) — never the root config's ["codex"].
				expect(mockSelectAgents).toHaveBeenCalledTimes(1);
				const call = mockSelectAgents.mock.calls[0]![0];
				expect(call.declaredAgents).toEqual(["claude"]);
				expect(call.unitLabel).toBe("these 2 skills");
			});

			it("configless-root collection (no root agntc.json) unchanged — collection detected, pipeline runs", async () => {
				setupMemberDirsBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" };
				});

				await runAdd("owner/my-collection");

				expect(mockSelectCollectionPlugins).toHaveBeenCalled();
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual([
					"owner/my-collection/pluginA",
					"owner/my-collection/pluginB",
				]);
				expect(mockCancel).not.toHaveBeenCalled();
			});

			it("root type:collection on member-dirs is ignored (Phase 1 leniency) — collection installs", async () => {
				setupMemberDirsBase();
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return { agents: ["claude"], type: "collection" };
					return { agents: ["claude"] };
				});
				// configType:"collection" is not "plugin" → detectType lets structure
				// stand (no conflict). Root call returns the collection.
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" };
				});

				await runAdd("owner/my-collection");

				expect(mockSelectCollectionPlugins).toHaveBeenCalled();
				expect(mockCancel).not.toHaveBeenCalled();
			});
		});

		// Analysis cycle 2 task 2-1: a skills-only collection member (child with
		// only skills/, no SKILL.md) is a PLUGIN member per the membership rule
		// (≥1 asset-kind dir → plugin member). It must INSTALL as a plugin, not be
		// silently dropped as a nested collection. These tests exercise the REAL
		// detectType + findPresentAssetDirs against a real on-disk member tree so
		// the skills-only → plugin resolution is genuinely driven, not mocked.
		describe("skills-only member resolves to a plugin member (REAL detection)", () => {
			let realRoot: string;

			async function delegateDetectionToReal(): Promise<void> {
				const actual = await vi.importActual<
					typeof import("../../src/type-detection.js")
				>("../../src/type-detection.js");
				mockDetectType.mockImplementation(actual.detectType);
				mockFindPresentAssetDirs.mockImplementation(
					actual.findPresentAssetDirs,
				);
			}

			beforeEach(async () => {
				realRoot = await mkdtemp(join(tmpdir(), "agntc-coll-real-"));
			});

			afterEach(async () => {
				await rm(realRoot, { recursive: true, force: true });
			});

			it("installs a real skills-only member as a plugin (assets copied, manifest type plugin)", async () => {
				// On-disk collection: one member "skillsonly" with only skills/, no
				// SKILL.md → skills-only structure. The root holds that member dir, so
				// the root structurally resolves to a members-collection.
				const memberDir = join(realRoot, "skillsonly");
				await mkdir(join(memberDir, "skills", "foo"), { recursive: true });
				await writeFile(
					join(memberDir, "skills", "foo", "SKILL.md"),
					"# foo\n",
				);

				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue({
					tempDir: realRoot,
					commit: "real123",
				});
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockSelectCollectionPlugins.mockResolvedValue(["skillsonly"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyPluginAssets.mockResolvedValue({
					copiedFiles: [".claude/skills/foo/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				});
				await delegateDetectionToReal();

				await runAdd("owner/my-collection");

				// Member installs as a PLUGIN (copyPluginAssets, not bare-skill, not skip).
				expect(mockCopyPluginAssets).toHaveBeenCalledTimes(1);
				const copyCall = mockCopyPluginAssets.mock.calls[0]![0];
				expect(copyCall.sourceDir).toBe(memberDir);
				expect(copyCall.assetDirs).toEqual(["skills"]);
				expect(mockCopyBareSkill).not.toHaveBeenCalled();

				// Manifest records the member keyed owner/repo/<unit> with type plugin.
				const entryCalls = mockAddEntry.mock.calls;
				expect(entryCalls).toHaveLength(1);
				expect(entryCalls[0]![1]).toBe("owner/my-collection/skillsonly");
				expect(entryCalls[0]![2]).toMatchObject({ type: "plugin" });

				// Not skipped as a nested collection.
				const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
				expect(
					warnCalls.some((m) => m.includes("nested collections not supported")),
				).toBe(false);
			});

			it("honours a member-level type:plugin config during per-member detection", async () => {
				// Member with a config carrying type:plugin (read at the member dir).
				const memberDir = join(realRoot, "configured");
				await mkdir(join(memberDir, "skills", "bar"), { recursive: true });
				await writeFile(
					join(memberDir, "skills", "bar", "SKILL.md"),
					"# bar\n",
				);

				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue({
					tempDir: realRoot,
					commit: "real123",
				});
				// Root configless; member declares type:plugin.
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === realRoot) return null;
					if (dir.endsWith("/configured"))
						return { agents: ["claude"], type: "plugin" };
					return null;
				});
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockSelectCollectionPlugins.mockResolvedValue(["configured"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyPluginAssets.mockResolvedValue({
					copiedFiles: [".claude/skills/bar/"],
					assetCountsByAgent: { claude: { skills: 1 } },
				});
				await delegateDetectionToReal();

				await runAdd("owner/my-collection");

				// The member's own config was read at its dir.
				expect(mockReadConfig).toHaveBeenCalledWith(
					memberDir,
					expect.anything(),
				);
				// The member's configType was forwarded into its per-member detection.
				const memberDetectCall = mockDetectType.mock.calls.find(
					([dir]) => dir === memberDir,
				);
				expect(memberDetectCall).toBeDefined();
				expect(memberDetectCall![1]).toMatchObject({ configType: "plugin" });
				// And it installs as a plugin member.
				expect(mockCopyPluginAssets).toHaveBeenCalledTimes(1);
				expect(mockAddEntry.mock.calls[0]![2]).toMatchObject({
					type: "plugin",
				});
			});

			it("still skips a genuine nested members-collection child (no asset dir at its own root)", async () => {
				// "nestedcoll" has NO SKILL.md and NO asset dir at its own root, only a
				// qualifying grandchild (skills-only) → real detectType resolves it to a
				// members-collection → must be skipped as a nested collection.
				const nestedDir = join(realRoot, "nestedcoll");
				await mkdir(join(nestedDir, "grandchild", "skills", "g"), {
					recursive: true,
				});
				await writeFile(
					join(nestedDir, "grandchild", "skills", "g", "SKILL.md"),
					"# g\n",
				);
				// A qualifying sibling so the ROOT itself resolves to a members-
				// collection (nestedcoll alone does not qualify as a member — no
				// SKILL.md / asset dir at its own root). Not selected for install.
				await mkdir(join(realRoot, "sibling", "skills", "s"), {
					recursive: true,
				});
				await writeFile(
					join(realRoot, "sibling", "skills", "s", "SKILL.md"),
					"# s\n",
				);

				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue({
					tempDir: realRoot,
					commit: "real123",
				});
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockSelectCollectionPlugins.mockResolvedValue(["nestedcoll"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				await delegateDetectionToReal();

				await runAdd("owner/my-collection");

				// Skipped with the nested-collection warning; nothing installed.
				expect(mockLog.warn).toHaveBeenCalledWith(
					"nestedcoll: nested collections not supported — skipping",
				);
				expect(mockCopyPluginAssets).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockAddEntry).not.toHaveBeenCalled();
			});
		});

		describe("skills-only ROOT default enumerates inner skills (REAL detection)", () => {
			let realRoot: string;

			async function delegateDetectionToReal(): Promise<void> {
				const actual = await vi.importActual<
					typeof import("../../src/type-detection.js")
				>("../../src/type-detection.js");
				mockDetectType.mockImplementation(actual.detectType);
				mockFindPresentAssetDirs.mockImplementation(actual.findPresentAssetDirs);
			}

			beforeEach(async () => {
				realRoot = await mkdtemp(join(tmpdir(), "agntc-skillsonly-real-"));
			});

			afterEach(async () => {
				await rm(realRoot, { recursive: true, force: true });
			});

			async function setupSkillsOnlyRoot(): Promise<void> {
				// Root holds ONLY skills/, with two populated inner skill units.
				await mkdir(join(realRoot, "skills", "a"), { recursive: true });
				await writeFile(join(realRoot, "skills", "a", "SKILL.md"), "# a\n");
				await mkdir(join(realRoot, "skills", "b"), { recursive: true });
				await writeFile(join(realRoot, "skills", "b", "SKILL.md"), "# b\n");

				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue({
					tempDir: realRoot,
					commit: "real123",
				});
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				await delegateDetectionToReal();
			}

			it("offers the inner skills as the selectable menu (dir-relative segments)", async () => {
				await setupSkillsOnlyRoot();
				// Select nothing: a deliberate empty selection is a clean abort, but the
				// menu must already have been offered with the enumerated inner skills.
				mockSelectCollectionPlugins.mockResolvedValue([]);

				const err = await runAdd("owner/my-collection").catch((e) => e);
				expect(err).toBeInstanceOf(ExitSignal);

				// The menu is driven by the enumerated inner-skill members.
				expect(mockSelectCollectionPlugins).toHaveBeenCalledWith({
					plugins: ["skills/a", "skills/b"],
					manifest: EMPTY_MANIFEST,
					manifestKeyPrefix: "owner/my-collection",
				});
			});

			it("installs each selected inner skill as a bare skill keyed owner/repo/<name>", async () => {
				await setupSkillsOnlyRoot();
				mockSelectCollectionPlugins.mockResolvedValue(["skills/a", "skills/b"]);
				mockCopyBareSkill
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/a/"] })
					.mockResolvedValueOnce({ copiedFiles: [".claude/skills/b/"] });

				await runAdd("owner/my-collection");

				// Each member installs via the bare-skill path (not plugin, not skip).
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
				expect(mockCopyPluginAssets).not.toHaveBeenCalled();

				// copyBareSkill sees the member dir one level into skills/, so the skill
				// name derives from the basename.
				const copiedDirs = mockCopyBareSkill.mock.calls.map(
					(c) => c[0].sourceDir,
				);
				expect(copiedDirs).toEqual([
					join(realRoot, "skills", "a"),
					join(realRoot, "skills", "b"),
				]);

				// Manifest keys are the BASENAME, not the skills/<name> segment.
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual([
					"owner/my-collection/a",
					"owner/my-collection/b",
				]);
				for (const call of mockAddEntry.mock.calls) {
					expect(call[2]).toMatchObject({ type: "skill" });
				}

				// No nested-collection misfire on a skills-only inner member.
				const warnCalls = mockLog.warn.mock.calls.map((c) => c[0] as string);
				expect(
					warnCalls.some((m) => m.includes("nested collections not supported")),
				).toBe(false);
			});

			it("installs a subset when only some inner skills are selected", async () => {
				await setupSkillsOnlyRoot();
				mockSelectCollectionPlugins.mockResolvedValue(["skills/b"]);
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/b/"],
				});

				await runAdd("owner/my-collection");

				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				expect(mockCopyBareSkill.mock.calls[0]![0].sourceDir).toBe(
					join(realRoot, "skills", "b"),
				);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toEqual(["owner/my-collection/b"]);
			});
		});
	});

	describe("plugin type", () => {
		const PLUGIN_DETECTED: DetectedType = {
			type: "plugin",
			assetDirs: ["skills", "agents"],
		};

		const PLUGIN_COPY_RESULT: CopyPluginAssetsResult = {
			copiedFiles: [
				".claude/skills/planning/",
				".claude/skills/planning/SKILL.md",
				".claude/agents/reviewer/",
				".claude/agents/reviewer/agent.md",
			],
			assetCountsByAgent: {
				claude: { skills: 1, agents: 1 },
			},
		};

		const PLUGIN_MANIFEST_ENTRY: ManifestEntry = {
			ref: "main",
			commit: "abc123def456",
			installedAt: expect.any(String),
			agents: ["claude"],
			files: PLUGIN_COPY_RESULT.copiedFiles,
		};

		const PLUGIN_UPDATED_MANIFEST: Manifest = {
			"owner/my-skill": PLUGIN_MANIFEST_ENTRY,
		};

		function setupPluginPath(): void {
			mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
			mockCopyPluginAssets.mockResolvedValue(PLUGIN_COPY_RESULT);
			mockAddEntry.mockReturnValue(PLUGIN_UPDATED_MANIFEST);
		}

		it("triggers copyPluginAssets with correct args", async () => {
			setupPluginPath();

			await runAdd("owner/my-skill");

			expect(mockCopyPluginAssets).toHaveBeenCalledWith({
				sourceDir: CLONE_RESULT.tempDir,
				assetDirs: ["skills", "agents"],
				agents: [{ id: "claude", driver: FAKE_DRIVER }],
				projectDir: "/fake/project",
			});
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("writes manifest entry with copiedFiles", async () => {
			setupPluginPath();

			await runAdd("owner/my-skill");

			expect(mockAddEntry).toHaveBeenCalledWith(
				EMPTY_MANIFEST,
				"owner/my-skill",
				expect.objectContaining({
					ref: "main",
					commit: "abc123def456",
					installedAt: expect.any(String),
					agents: ["claude"],
					files: PLUGIN_COPY_RESULT.copiedFiles,
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				PLUGIN_UPDATED_MANIFEST,
			);
		});

		it("shows per-agent counts in summary, omitting zero-count types", async () => {
			setupPluginPath();
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: {
					claude: { skills: 2, agents: 0, hooks: 1 },
				},
			});

			await runAdd("owner/my-skill");

			const outroCall = summaryText();
			expect(outroCall).toContain("owner/my-skill");
			expect(outroCall).toContain("main");
			expect(outroCall).toContain("Claude");
			expect(outroCall).toContain("2 skills");
			expect(outroCall).toContain("1 hook");
			expect(outroCall).not.toContain("0 agent");
		});

		it("lists a selected agent that received nothing rather than dropping it", async () => {
			setupPluginPath();
			mockSelectAgents.mockResolvedValue(selected(["claude", "codex"]));
			const codexDriver = {
				detect: vi.fn().mockResolvedValue(true),
				getTargetDir: vi.fn().mockReturnValue(null),
			};
			mockGetDriver.mockImplementation((id: AgentId) => {
				if (id === "codex") return codexDriver;
				return FAKE_DRIVER;
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: {
					claude: { skills: 2 },
					codex: { skills: 0 },
				},
			});

			await runAdd("owner/my-skill");

			// A selected agent that got no compatible files is still shown (with a
			// note) so the user knows their selection took effect but was a no-op —
			// not silently dropped.
			const outroCall = summaryText();
			expect(outroCall).toContain("Claude");
			expect(outroCall).toContain("Codex");
			expect(outroCall).toContain("nothing to install (no compatible files)");
		});

		it("shows key without ref when ref is null", async () => {
			setupPluginPath();
			mockParseSource.mockReturnValue({ ...PARSED, ref: null });

			await runAdd("owner/my-skill");

			const outroCall = summaryText();
			expect(outroCall).toContain("owner/my-skill");
			expect(outroCall).toContain("HEAD");
		});

		it("shows key with ref when ref is present", async () => {
			setupPluginPath();

			await runAdd("owner/my-skill");

			const outroCall = summaryText();
			expect(outroCall).toContain("owner/my-skill");
			expect(outroCall).toContain("main");
		});

		it("warns and exits 0 without manifest write when copiedFiles is empty", async () => {
			mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [],
				assetCountsByAgent: {
					claude: { skills: 0, agents: 0 },
				},
			});

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringMatching(/no files to install/i),
			);
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("surfaces root SKILL.md ignored warning via onWarn", async () => {
			setupPluginPath();
			mockDetectType.mockImplementation(async (_dir, options) => {
				options.onWarn?.(
					"SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored",
				);
				return PLUGIN_DETECTED;
			});

			await runAdd("owner/my-skill");

			expect(mockLog.warn).toHaveBeenCalledWith(
				"SKILL.md found alongside asset dirs — treating as plugin, SKILL.md will be ignored",
			);
		});

		it("uses spinner during copyPluginAssets", async () => {
			const spinnerInstance = {
				start: vi.fn(),
				stop: vi.fn(),
				message: vi.fn(),
			};
			mockSpinner.mockReturnValue(spinnerInstance);
			setupPluginPath();

			await runAdd("owner/my-skill");

			const startCalls = spinnerInstance.start.mock.calls.map(
				(c) => c[0] as string,
			);
			expect(startCalls.some((msg) => msg.includes("Copy"))).toBe(true);
		});

		it("cleans up on success", async () => {
			setupPluginPath();

			await runAdd("owner/my-skill");

			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("cleans up on empty plugin", async () => {
			mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [],
				assetCountsByAgent: { claude: { skills: 0 } },
			});

			await runAdd("owner/my-skill").catch(() => {});

			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("shows error and exits 1 on copy error", async () => {
			mockDetectType.mockResolvedValue(PLUGIN_DETECTED);
			mockCopyPluginAssets.mockRejectedValue(new Error("copy plugin failed"));

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("cleans up and exits 1 on manifest write error", async () => {
			setupPluginPath();
			mockWriteManifest.mockRejectedValue(new Error("write failed"));

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("passes detected assetDirs, not hardcoded values", async () => {
			mockDetectType.mockResolvedValue({
				type: "plugin",
				assetDirs: ["hooks"],
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/hooks/pre-commit.sh"],
				assetCountsByAgent: { claude: { hooks: 1 } },
			});

			await runAdd("owner/my-skill");

			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({ assetDirs: ["hooks"] }),
			);
		});
	});

	describe("not-agntc with config", () => {
		it("fails pre-flight with source-named cancel, cleans up, exits non-zero", async () => {
			mockDetectType.mockImplementation(async (_dir, options) => {
				options.onWarn?.(
					"agntc.json present but no SKILL.md or asset dirs found",
				);
				return { type: "not-agntc" };
			});

			const err = await runAdd("owner/my-skill").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("owner/my-skill"),
			);
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});
	});

	describe("cancel: empty agent selection", () => {
		it("shows cancelled, cleans up, and exits 0", async () => {
			mockSelectAgents.mockResolvedValue(selected([]));

			const err = await runAdd("owner/my-skill").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(
				mockOutro.mock.calls[0]?.[0] ?? mockCancel.mock.calls[0]?.[0] ?? "",
			).toMatch(/cancel/i);
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("deliberate empty selection emits ONE coherent cancel message — no skipping-then-cancel pair", async () => {
			mockSelectAgents.mockResolvedValue(selected([]));

			const err = await runAdd("owner/my-skill").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			// Exactly one accurate abort message via p.cancel...
			expect(mockCancel).toHaveBeenCalledTimes(1);
			expect(mockCancel).toHaveBeenCalledWith("Cancelled — no agents selected");
			// ...and NOT the contradictory "No agents selected — skipping" info log.
			expect(mockLog.info).not.toHaveBeenCalledWith(
				"No agents selected — skipping",
			);
		});

		it("cancelled prompt (Esc) exits 0 with a single cancel message", async () => {
			mockSelectAgents.mockResolvedValue(cancelledSelection);

			const err = await runAdd("owner/my-skill").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockCancel).toHaveBeenCalledTimes(1);
			expect(mockCancel).toHaveBeenCalledWith("Cancelled — no agents selected");
			expect(mockLog.info).not.toHaveBeenCalledWith(
				"No agents selected — skipping",
			);
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});
	});

	describe("error: copy failure", () => {
		it("shows error, cleans up, and exits 1", async () => {
			mockCopyBareSkill.mockRejectedValue(new Error("copy failed"));

			const err = await runAdd("owner/my-skill").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});
	});

	describe("error: manifest write failure", () => {
		it("shows error, cleans up, and exits 1", async () => {
			mockWriteManifest.mockRejectedValue(new Error("write failed"));

			const err = await runAdd("owner/my-skill").catch((e) => e);
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalled();
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});
	});

	describe("cleanup", () => {
		it("cleans up on success", async () => {
			await runAdd("owner/my-skill");

			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("cleans up on error", async () => {
			mockCopyBareSkill.mockRejectedValue(new Error("copy failed"));

			await runAdd("owner/my-skill").catch(() => {});

			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("cleans up on cancel", async () => {
			mockSelectAgents.mockResolvedValue(selected([]));

			await runAdd("owner/my-skill").catch(() => {});

			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});

		it("swallows cleanup errors", async () => {
			mockCleanupTempDir.mockRejectedValue(new Error("cleanup failed"));

			// Should not throw due to cleanup error; the overall runAdd should still complete
			await runAdd("owner/my-skill");

			expect(mockCleanupTempDir).toHaveBeenCalled();
		});
	});

	describe("direct-path source (tree URL)", () => {
		// Tree-path subpath acts as a standalone unit selector (task 2-3):
		// detection + install run against join(sourceDir, parsed.targetPlugin),
		// not the repo root, and the resolved unit installs via the STANDALONE
		// route (tasks 2-1/2-2) keyed owner/repo/<subpath>.
		// NOTE: within-clone path-traversal/containment guard for targetPlugin is
		// EXPLICITLY DEFERRED TO PHASE 5 — no such check is asserted here.
		const DIRECT_PATH_PARSED: ParsedSource = {
			type: "direct-path",
			owner: "owner",
			repo: "my-collection",
			ref: "main",
			targetPlugin: "pluginA",
			manifestKey: "owner/my-collection/pluginA",
			cloneUrl: "https://github.com/owner/my-collection.git",
		};

		const DIRECT_PATH_CLONE_RESULT: CloneResult = {
			tempDir: "/tmp/agntc-dp123",
			commit: "dp123def456",
		};

		const UNIT_DIR = `${DIRECT_PATH_CLONE_RESULT.tempDir}/pluginA`;

		const PLUGIN_A_CONFIG: AgntcConfig = { agents: ["claude"] };

		// Base setup: subpath unit resolves to a configless bare skill. Individual
		// tests override readConfig/detectType for their scenario.
		function setupDirectPath(): void {
			mockParseSource.mockReturnValue(DIRECT_PATH_PARSED);
			mockCloneSource.mockResolvedValue(DIRECT_PATH_CLONE_RESULT);
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue({ type: "bare-skill" });
			mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
			mockDetectAgents.mockResolvedValue(["claude"]);
			mockGetDriver.mockReturnValue(FAKE_DRIVER);
			mockSelectAgents.mockResolvedValue(selected(["claude"]));
			mockWriteManifest.mockResolvedValue(undefined);
			mockCleanupTempDir.mockResolvedValue(undefined);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
			mockComputeIncomingFiles.mockReturnValue([".claude/skills/pluginA/"]);
			mockCheckFileCollisions.mockReturnValue(new Map());
			mockResolveCollisions.mockResolvedValue({
				resolved: true,
				updatedManifest: EMPTY_MANIFEST,
			});
			mockCheckUnmanagedConflicts.mockResolvedValue([]);
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [],
				cancelled: [],
			});
			mockAddEntry.mockImplementation((manifest, key, entry) => ({
				...manifest,
				[key]: entry,
			}));
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
			});
		}

		it("runs readConfig and detectType against the subpath (unitDir), not the repo root", async () => {
			setupDirectPath();

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			expect(mockReadConfig).toHaveBeenCalledWith(
				UNIT_DIR,
				expect.objectContaining({ onWarn: expect.any(Function) }),
			);
			expect(mockReadConfig).not.toHaveBeenCalledWith(
				DIRECT_PATH_CLONE_RESULT.tempDir,
				expect.anything(),
			);
			expect(mockDetectType).toHaveBeenCalledTimes(1);
			expect(mockDetectType).toHaveBeenCalledWith(
				UNIT_DIR,
				expect.objectContaining({ onWarn: expect.any(Function) }),
			);
		});

		it("installs the subpath unit standalone (copyBareSkill sourceDir = unitDir, no collection multiselect)", async () => {
			setupDirectPath();

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: UNIT_DIR }),
			);
		});

		it("writes manifest keyed owner/repo/<subpath>, folder named after subpath basename", async () => {
			setupDirectPath();

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			expect(mockAddEntry).toHaveBeenCalledWith(
				EMPTY_MANIFEST,
				"owner/my-collection/pluginA",
				expect.objectContaining({
					ref: "main",
					commit: "dp123def456",
					agents: ["claude"],
					files: [".claude/skills/pluginA/"],
				}),
			);
		});

		it("sources subpath agents from subpath own config (declared ceiling)", async () => {
			setupDirectPath();
			mockReadConfig.mockResolvedValue(PLUGIN_A_CONFIG);

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			expect(mockSelectAgents).toHaveBeenCalledWith(
				expect.objectContaining({
					declaredAgents: ["claude"],
					detectedAgents: ["claude"],
				}),
			);
		});

		it("configless subpath sources agents from KNOWN_AGENTS default (declaredAgents:[])", async () => {
			setupDirectPath();

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			expect(mockSelectAgents).toHaveBeenCalledWith(
				expect.objectContaining({
					declaredAgents: [],
					detectedAgents: ["claude"],
				}),
			);
		});

		it("--plugin bundles a skills-only subpath via copyPluginAssets", async () => {
			setupDirectPath();
			// detectType resolves the skills-only ambiguity to plugin under --plugin
			mockDetectType.mockResolvedValue({
				type: "plugin",
				assetDirs: ["skills"],
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA", {
				forcePlugin: true,
			});

			expect(mockDetectType).toHaveBeenCalledWith(
				UNIT_DIR,
				expect.objectContaining({ forcePlugin: true }),
			);
			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: UNIT_DIR,
					assetDirs: ["skills"],
				}),
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCancel).not.toHaveBeenCalled();
		});

		it("--plugin on a non-bundleable subpath hard-errors (reuses task 2-2 handling)", async () => {
			setupDirectPath();
			mockDetectType.mockRejectedValue(
				new TypeConflictError("the source is a bare skill — cannot bundle"),
			);

			const err = await runAdd(
				"https://github.com/owner/my-collection/tree/main/pluginA",
				{ forcePlugin: true },
			).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			const message = mockCancel.mock.calls[0]![0] as string;
			expect(message).toContain("owner/my-collection/pluginA");
			// Conflict triggered by the --plugin flag → flag-attributed message.
			expect(message).toContain("--plugin flag");
			expect(message).not.toContain("declares type plugin");
			expect(message).toContain("cannot bundle");
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});

		it("subpath resolving to not-agntc fails pre-flight: source-named cancel, non-zero exit, no write", async () => {
			setupDirectPath();
			mockDetectType.mockResolvedValue({ type: "not-agntc" });

			const err = await runAdd(
				"https://github.com/owner/my-collection/tree/main/pluginA",
			).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("owner/my-collection/pluginA"),
			);
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("Not an agntc source"),
			);
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});

		it("tree URL with @ref suffix is rejected by parseDirectPath (parse error, exit 1, no install)", async () => {
			mockParseSource.mockRejectedValue(
				new Error("tree URLs cannot have @ref suffix"),
			);

			const err = await runAdd(
				"https://github.com/owner/my-collection/tree/main/pluginA@v1.0.0",
			).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockCancel).toHaveBeenCalledWith(
				expect.stringContaining("tree URLs cannot have @ref suffix"),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
		});

		it("multi-segment subpath: targetPlugin is full subpath, copy sourceDir is the joined unitDir", async () => {
			const nestedParsed: ParsedSource = {
				...DIRECT_PATH_PARSED,
				targetPlugin: "path/to/unit",
				manifestKey: "owner/my-collection/path/to/unit",
			};
			setupDirectPath();
			mockParseSource.mockReturnValue(nestedParsed);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/unit/"],
			});

			await runAdd(
				"https://github.com/owner/my-collection/tree/main/path/to/unit",
			);

			const nestedUnitDir = `${DIRECT_PATH_CLONE_RESULT.tempDir}/path/to/unit`;
			expect(mockDetectType).toHaveBeenCalledWith(
				nestedUnitDir,
				expect.objectContaining({ onWarn: expect.any(Function) }),
			);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: nestedUnitDir }),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				EMPTY_MANIFEST,
				"owner/my-collection/path/to/unit",
				expect.objectContaining({ files: [".claude/skills/unit/"] }),
			);
		});

		it("cleans up temp dir on success", async () => {
			setupDirectPath();

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			expect(mockCleanupTempDir).toHaveBeenCalledWith(
				DIRECT_PATH_CLONE_RESULT.tempDir,
			);
		});

		it("records its own resolved type (bare-skill subpath -> skill)", async () => {
			setupDirectPath();

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
			expect(entry.type).toBe("skill");
		});

		it("records its own resolved type (plugin subpath -> plugin)", async () => {
			setupDirectPath();
			mockDetectType.mockResolvedValue({
				type: "plugin",
				assetDirs: ["skills"],
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/pluginA/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA", {
				forcePlugin: true,
			});

			const entry = mockAddEntry.mock.calls[0]![2] as ManifestEntry;
			expect(entry.type).toBe("plugin");
		});
	});

	describe("reinstall (nuke before copy)", () => {
		const EXISTING_MANIFEST: Manifest = {
			"owner/my-skill": {
				ref: "main",
				commit: "old123",
				installedAt: "2026-01-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
			},
		};

		it("standalone reinstall nukes old files before copy", async () => {
			mockReadManifest.mockResolvedValue(EXISTING_MANIFEST);

			const callOrder: string[] = [];
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [".claude/skills/my-skill/"], skipped: [] };
			});
			mockCopyBareSkill.mockImplementation(async (args) => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-skill/"] };
			});

			await runAdd("owner/my-skill");

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(callOrder).toEqual(["nuke", "copy"]);
		});

		it("does not nuke when manifest key is not present", async () => {
			mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);

			await runAdd("owner/my-skill");

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("manifest entry replaced not duplicated on reinstall", async () => {
			mockReadManifest.mockResolvedValue(EXISTING_MANIFEST);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [],
			});
			mockAddEntry.mockImplementation((manifest, key, entry) => ({
				...manifest,
				[key]: entry,
			}));

			await runAdd("owner/my-skill");

			expect(mockAddEntry).toHaveBeenCalledWith(
				EXISTING_MANIFEST,
				"owner/my-skill",
				expect.objectContaining({
					ref: "main",
					commit: "abc123def456",
					files: [".claude/skills/my-skill/"],
				}),
			);
		});

		it("different agent selection on reinstall: old files nuked, new files created", async () => {
			const oldManifest: Manifest = {
				"owner/my-skill": {
					ref: "main",
					commit: "old123",
					installedAt: "2026-01-01T00:00:00.000Z",
					agents: ["codex"],
					files: [".codex/skills/my-skill/"],
				},
			};
			mockReadManifest.mockResolvedValue(oldManifest);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".codex/skills/my-skill/"],
				skipped: [],
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runAdd("owner/my-skill");

			// Should nuke the OLD files (codex)
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".codex/skills/my-skill/",
			]);
			// Should copy to NEW agent (claude)
			expect(mockCopyBareSkill).toHaveBeenCalled();
		});

		describe("collection reinstall", () => {
			const COLLECTION_PARSED: ParsedSource = {
				type: "github-shorthand",
				owner: "owner",
				repo: "my-collection",
				ref: "main",
				manifestKey: "owner/my-collection",
			};

			const COLLECTION_CLONE_RESULT: CloneResult = {
				tempDir: "/tmp/agntc-coll123",
				commit: "coll123def456",
			};

			const COLLECTION_DETECTED: DetectedType = {
				type: "collection",
				plugins: ["pluginA", "pluginB"],
			};

			function setupCollectionReinstall(): void {
				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) {
						return COLLECTION_DETECTED;
					}
					return { type: "bare-skill" } as DetectedType;
				});
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockNukeManifestFiles.mockResolvedValue({
					removed: [],
					skipped: [],
				});
			}

			it("collection reinstall nukes per-plugin before copy", async () => {
				setupCollectionReinstall();
				const existingCollectionManifest: Manifest = {
					"owner/my-collection/pluginA": {
						ref: "main",
						commit: "old123",
						installedAt: "2026-01-01T00:00:00.000Z",
						agents: ["claude"],
						files: [".claude/skills/pluginA/"],
					},
				};
				mockReadManifest.mockResolvedValue(existingCollectionManifest);
				mockNukeManifestFiles.mockResolvedValue({
					removed: [".claude/skills/pluginA/"],
					skipped: [],
				});
				mockCopyBareSkill
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginA/"],
					})
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});

				await runAdd("owner/my-collection");

				// Only pluginA is in manifest, so only pluginA should be nuked
				expect(mockNukeManifestFiles).toHaveBeenCalledTimes(1);
				expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
					".claude/skills/pluginA/",
				]);
			});

			it("only installed plugins nuked in collection", async () => {
				setupCollectionReinstall();
				const existingCollectionManifest: Manifest = {
					"owner/my-collection/pluginA": {
						ref: "main",
						commit: "old123",
						installedAt: "2026-01-01T00:00:00.000Z",
						agents: ["claude"],
						files: [".claude/skills/pluginA/"],
					},
				};
				mockReadManifest.mockResolvedValue(existingCollectionManifest);
				mockNukeManifestFiles.mockResolvedValue({
					removed: [".claude/skills/pluginA/"],
					skipped: [],
				});
				mockCopyBareSkill
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginA/"],
					})
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});

				await runAdd("owner/my-collection");

				// pluginB was not in manifest, so nuke should NOT be called for it
				const nukeCalls = mockNukeManifestFiles.mock.calls;
				expect(nukeCalls).toHaveLength(1);
				expect(nukeCalls[0]![1]).toEqual([".claude/skills/pluginA/"]);
			});

			it("nuke failure on one collection plugin does not block others", async () => {
				setupCollectionReinstall();
				const existingCollectionManifest: Manifest = {
					"owner/my-collection/pluginA": {
						ref: "main",
						commit: "old123",
						installedAt: "2026-01-01T00:00:00.000Z",
						agents: ["claude"],
						files: [".claude/skills/pluginA/"],
					},
					"owner/my-collection/pluginB": {
						ref: "main",
						commit: "old123",
						installedAt: "2026-01-01T00:00:00.000Z",
						agents: ["claude"],
						files: [".claude/skills/pluginB/"],
					},
				};
				mockReadManifest.mockResolvedValue(existingCollectionManifest);

				// pluginA nuke fails, pluginB nuke succeeds
				mockNukeManifestFiles
					.mockRejectedValueOnce(
						Object.assign(new Error("EACCES"), { code: "EACCES" }),
					)
					.mockResolvedValueOnce({
						removed: [".claude/skills/pluginB/"],
						skipped: [],
					});

				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginB/"],
				});

				await runAdd("owner/my-collection");

				// pluginB should still be installed
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
			});
		});
	});

	describe("local-path source", () => {
		const LOCAL_PARSED: ParsedSource = {
			type: "local-path",
			resolvedPath: "/Users/dev/my-plugin",
			ref: null,
			manifestKey: "/Users/dev/my-plugin",
		};

		const LOCAL_CONFIG: AgntcConfig = { agents: ["claude"] };
		const LOCAL_BARE_SKILL: DetectedType = { type: "bare-skill" };

		function setupLocalBareSkill(): void {
			mockParseSource.mockReturnValue(LOCAL_PARSED);
			mockReadConfig.mockResolvedValue(LOCAL_CONFIG);
			mockDetectType.mockResolvedValue(LOCAL_BARE_SKILL);
			mockDetectAgents.mockResolvedValue(["claude"]);
			mockGetDriver.mockReturnValue(FAKE_DRIVER);
			mockSelectAgents.mockResolvedValue(selected(["claude"]));
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});
			mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
			mockAddEntry.mockReturnValue({
				"/Users/dev/my-plugin": {
					ref: null,
					commit: null,
					installedAt: expect.any(String),
					agents: ["claude"],
					files: [".claude/skills/my-plugin/"],
				},
			} as unknown as Manifest);
			mockWriteManifest.mockResolvedValue(undefined);
			mockCleanupTempDir.mockResolvedValue(undefined);
		}

		it("skips clone for local-path source", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("uses resolvedPath as sourceDir for readConfig", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			expect(mockReadConfig).toHaveBeenCalledWith(
				"/Users/dev/my-plugin",
				expect.objectContaining({ onWarn: expect.any(Function) }),
			);
		});

		it("uses resolvedPath as sourceDir for detectType", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			expect(mockDetectType).toHaveBeenCalledWith(
				"/Users/dev/my-plugin",
				expect.objectContaining({
					onWarn: expect.any(Function),
				}),
			);
		});

		it("does not clean up temp dir for local-path source", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});

		it("writes manifest entry with null ref and null commit", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			expect(mockAddEntry).toHaveBeenCalledWith(
				EMPTY_MANIFEST,
				"/Users/dev/my-plugin",
				expect.objectContaining({
					ref: null,
					commit: null,
					installedAt: expect.any(String),
					agents: ["claude"],
					files: [".claude/skills/my-plugin/"],
				}),
			);
		});

		it("uses absolute path as manifest key", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			expect(addEntryCall[1]).toBe("/Users/dev/my-plugin");
		});

		it("passes resolvedPath as sourceDir to copyBareSkill", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/Users/dev/my-plugin",
				projectDir: "/fake/project",
				agents: [{ id: "claude", driver: FAKE_DRIVER }],
				skillName: "my-plugin",
			});
		});

		it("shows 'local' instead of ref in summary", async () => {
			setupLocalBareSkill();

			await runAdd("./my-plugin");

			const outroCall = summaryText();
			expect(outroCall).toContain("local");
			expect(outroCall).not.toContain("HEAD");
		});

		it("handles plugin type from local path", async () => {
			const pluginDetected: DetectedType = {
				type: "plugin",
				assetDirs: ["skills", "agents"],
			};
			setupLocalBareSkill();
			mockDetectType.mockResolvedValue(pluginDetected);
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/", ".claude/agents/executor/"],
				assetCountsByAgent: { claude: { skills: 1, agents: 1 } },
			});

			await runAdd("./my-plugin");

			expect(mockCopyPluginAssets).toHaveBeenCalledWith({
				sourceDir: "/Users/dev/my-plugin",
				assetDirs: ["skills", "agents"],
				agents: [{ id: "claude", driver: FAKE_DRIVER }],
				projectDir: "/fake/project",
			});
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		describe("local-path collection", () => {
			const LOCAL_COLLECTION_PARSED: ParsedSource = {
				type: "local-path",
				resolvedPath: "/Users/dev/my-collection",
				ref: null,
				manifestKey: "/Users/dev/my-collection",
			};

			const COLLECTION_DETECTED: DetectedType = {
				type: "collection",
				plugins: ["pluginA", "pluginB"],
			};

			function setupLocalCollection(): void {
				mockParseSource.mockReturnValue(LOCAL_COLLECTION_PARSED);
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === "/Users/dev/my-collection") return null;
					if (dir.endsWith("/pluginA")) return { agents: ["claude"] };
					if (dir.endsWith("/pluginB")) return { agents: ["claude"] };
					return null;
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === "/Users/dev/my-collection") return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockCopyBareSkill
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginA/"],
					})
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});
			}

			it("skips clone for local-path collection", async () => {
				setupLocalCollection();

				await runAdd("./my-collection");

				expect(mockCloneSource).not.toHaveBeenCalled();
			});

			it("does not clean up temp dir for local-path collection", async () => {
				setupLocalCollection();

				await runAdd("./my-collection");

				expect(mockCleanupTempDir).not.toHaveBeenCalled();
			});

			it("uses resolvedPath/pluginName as collection manifest keys", async () => {
				setupLocalCollection();

				await runAdd("./my-collection");

				const addEntryCalls = mockAddEntry.mock.calls;
				const keys = addEntryCalls.map((call) => call[1]);
				expect(keys).toContain("/Users/dev/my-collection/pluginA");
				expect(keys).toContain("/Users/dev/my-collection/pluginB");
			});

			it("writes null ref and null commit for collection plugin entries", async () => {
				setupLocalCollection();

				await runAdd("./my-collection");

				for (const call of mockAddEntry.mock.calls) {
					const entry = call[2] as ManifestEntry;
					expect(entry.ref).toBeNull();
					expect(entry.commit).toBeNull();
				}
			});

			it("uses resolvedPath as manifestKeyPrefix for collection select", async () => {
				setupLocalCollection();

				await runAdd("./my-collection");

				expect(mockSelectCollectionPlugins).toHaveBeenCalledWith({
					plugins: ["pluginA", "pluginB"],
					manifest: EMPTY_MANIFEST,
					manifestKeyPrefix: "/Users/dev/my-collection",
				});
			});

			it("shows 'local' in collection summary", async () => {
				setupLocalCollection();

				await runAdd("./my-collection");

				const outroCall = summaryText();
				expect(outroCall).toContain("local");
				expect(outroCall).not.toContain("HEAD");
			});
		});

		describe("local-path error: no agntc.json and not a collection", () => {
			it("surfaces clear error when local path has no agntc.json and no collection subdirs", async () => {
				mockParseSource.mockReturnValue(LOCAL_PARSED);
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue({ type: "not-agntc" });

				const err = await runAdd("./my-plugin").catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("Not an agntc source"),
				);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("/Users/dev/my-plugin"),
				);
				expect(mockCloneSource).not.toHaveBeenCalled();
				expect(mockCleanupTempDir).not.toHaveBeenCalled();
			});
		});

		describe("local-path error: unreadable path", () => {
			it("surfaces clear error when parseSource throws for unreadable path", async () => {
				mockParseSource.mockImplementation(() => {
					throw new Error(
						"Path /bad/path does not exist or is not a directory",
					);
				});

				const err = await runAdd("./bad-path").catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				expect(mockCancel).toHaveBeenCalled();
				expect(mockCloneSource).not.toHaveBeenCalled();
				expect(mockCleanupTempDir).not.toHaveBeenCalled();
			});
		});

		describe("no regression: git-based sources still work", () => {
			it("git-based source still clones and cleans up", async () => {
				// Reset to default happy path (git-based)
				setupHappyPath();

				await runAdd("owner/my-skill");

				expect(mockCloneSource).toHaveBeenCalled();
				expect(mockCleanupTempDir).toHaveBeenCalled();
			});
		});
	});

	describe("conflict flow — standalone", () => {
		it("calls computeIncomingFiles with correct args for bare-skill", async () => {
			await runAdd("owner/my-skill");

			expect(mockComputeIncomingFiles).toHaveBeenCalledWith({
				type: "bare-skill",
				sourceDir: CLONE_RESULT.tempDir,
				agents: [{ id: "claude", driver: FAKE_DRIVER }],
				skillName: "my-skill",
			});
		});

		it("calls computeIncomingFiles with correct args for plugin", async () => {
			const pluginDetected: DetectedType = {
				type: "plugin",
				assetDirs: ["skills", "agents"],
			};
			mockDetectType.mockResolvedValue(pluginDetected);
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("owner/my-skill");

			expect(mockComputeIncomingFiles).toHaveBeenCalledWith({
				type: "plugin",
				sourceDir: CLONE_RESULT.tempDir,
				assetDirs: ["skills", "agents"],
				agents: [{ id: "claude", driver: FAKE_DRIVER }],
			});
		});

		it("calls collision check before copy with excludeKey", async () => {
			const callOrder: string[] = [];
			mockCheckFileCollisions.mockImplementation((...args) => {
				callOrder.push("collision-check");
				return new Map();
			});
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-skill/"] };
			});

			await runAdd("owner/my-skill");

			expect(callOrder.indexOf("collision-check")).toBeLessThan(
				callOrder.indexOf("copy"),
			);
			expect(mockCheckFileCollisions).toHaveBeenCalledWith(
				[".claude/skills/my-skill/"],
				EMPTY_MANIFEST,
				"owner/my-skill",
			);
		});

		it("calls unmanaged check after collision check, before copy", async () => {
			const callOrder: string[] = [];
			mockCheckFileCollisions.mockImplementation(() => {
				callOrder.push("collision-check");
				return new Map();
			});
			mockCheckUnmanagedConflicts.mockImplementation(async () => {
				callOrder.push("unmanaged-check");
				return [];
			});
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-skill/"] };
			});

			await runAdd("owner/my-skill");

			expect(callOrder).toEqual(["collision-check", "unmanaged-check", "copy"]);
		});

		it("passes updated manifest from collision resolution to unmanaged check", async () => {
			const collidingManifest: Manifest = {
				"other/repo": {
					ref: "main",
					commit: "old123",
					installedAt: "2026-01-01T00:00:00.000Z",
					agents: ["claude"],
					files: [".claude/skills/my-skill/"],
				},
			};
			const resolvedManifest: Manifest = {};
			mockReadManifest.mockResolvedValue(collidingManifest);
			mockCheckFileCollisions.mockReturnValue(
				new Map([["other/repo", [".claude/skills/my-skill/"]]]),
			);
			mockResolveCollisions.mockResolvedValue({
				resolved: true,
				updatedManifest: resolvedManifest,
			});

			await runAdd("owner/my-skill");

			// Unmanaged check should get the updated (resolved) manifest
			expect(mockCheckUnmanagedConflicts).toHaveBeenCalledWith(
				[".claude/skills/my-skill/"],
				resolvedManifest,
				"/fake/project",
			);
		});

		it("cancel at collision stage exits cleanly with ExitSignal(0)", async () => {
			mockCheckFileCollisions.mockReturnValue(
				new Map([["other/repo", [".claude/skills/my-skill/"]]]),
			);
			mockResolveCollisions.mockResolvedValue({
				resolved: false,
				updatedManifest: EMPTY_MANIFEST,
			});

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCheckUnmanagedConflicts).not.toHaveBeenCalled();
		});

		it("cancel at unmanaged stage exits cleanly with ExitSignal(0)", async () => {
			mockCheckUnmanagedConflicts.mockResolvedValue([
				".claude/skills/my-skill/",
			]);
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [],
				cancelled: [".claude/skills/my-skill/"],
			});

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("resolve collision then install succeeds", async () => {
			mockCheckFileCollisions.mockReturnValue(
				new Map([["other/repo", [".claude/skills/my-skill/"]]]),
			);
			mockResolveCollisions.mockResolvedValue({
				resolved: true,
				updatedManifest: EMPTY_MANIFEST,
			});

			await runAdd("owner/my-skill");

			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("no conflict path — checks called but no issues, copy proceeds", async () => {
			// Default setup: no collisions, no unmanaged
			await runAdd("owner/my-skill");

			expect(mockComputeIncomingFiles).toHaveBeenCalled();
			expect(mockCheckFileCollisions).toHaveBeenCalled();
			expect(mockCheckUnmanagedConflicts).toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalled();
			// resolveCollisions should NOT be called when no collisions
			expect(mockResolveCollisions).not.toHaveBeenCalled();
			// resolveUnmanagedConflicts should NOT be called when no conflicts
			expect(mockResolveUnmanagedConflicts).not.toHaveBeenCalled();
		});

		it("manifest write uses updated manifest from collision resolution", async () => {
			const collidingManifest: Manifest = {
				"other/repo": {
					ref: "main",
					commit: "old123",
					installedAt: "2026-01-01T00:00:00.000Z",
					agents: ["claude"],
					files: [".claude/skills/other-skill/"],
				},
			};
			const resolvedManifest: Manifest = {};

			mockReadManifest.mockResolvedValue(collidingManifest);
			mockCheckFileCollisions.mockReturnValue(
				new Map([["other/repo", [".claude/skills/my-skill/"]]]),
			);
			mockResolveCollisions.mockResolvedValue({
				resolved: true,
				updatedManifest: resolvedManifest,
			});
			mockAddEntry.mockReturnValue({
				"owner/my-skill": MANIFEST_ENTRY,
			});

			await runAdd("owner/my-skill");

			// addEntry should use the resolved manifest, not the original
			expect(mockAddEntry).toHaveBeenCalledWith(
				resolvedManifest,
				"owner/my-skill",
				expect.any(Object),
			);
		});

		it("unmanaged check receives pluginKey for standalone", async () => {
			mockCheckUnmanagedConflicts.mockResolvedValue([
				".claude/skills/my-skill/",
			]);
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [".claude/skills/my-skill/"],
				cancelled: [],
			});

			await runAdd("owner/my-skill");

			expect(mockResolveUnmanagedConflicts).toHaveBeenCalledWith([
				{
					pluginKey: "owner/my-skill",
					files: [".claude/skills/my-skill/"],
				},
			]);
		});

		it("collision check uses manifest from after nuke (reinstall)", async () => {
			const existingManifest: Manifest = {
				"owner/my-skill": {
					ref: "main",
					commit: "old123",
					installedAt: "2026-01-01T00:00:00.000Z",
					agents: ["claude"],
					files: [".claude/skills/my-skill/"],
				},
			};
			mockReadManifest.mockResolvedValue(existingManifest);

			await runAdd("owner/my-skill");

			// Collision check should pass the manifest AND the excludeKey
			expect(mockCheckFileCollisions).toHaveBeenCalledWith(
				[".claude/skills/my-skill/"],
				existingManifest,
				"owner/my-skill",
			);
		});
	});

	describe("conflict flow — collection", () => {
		const COLLECTION_PARSED: ParsedSource = {
			type: "github-shorthand",
			owner: "owner",
			repo: "my-collection",
			ref: "main",
			manifestKey: "owner/my-collection",
		};

		const COLLECTION_CLONE_RESULT: CloneResult = {
			tempDir: "/tmp/agntc-coll-conflict",
			commit: "collconf123",
		};

		const COLLECTION_DETECTED: DetectedType = {
			type: "collection",
			plugins: ["pluginA", "pluginB"],
		};

		function setupCollectionConflictBase(): void {
			mockParseSource.mockReturnValue(COLLECTION_PARSED);
			mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return { agents: ["claude"] };
			});
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return { type: "bare-skill" } as DetectedType;
			});
			mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
			mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
			mockDetectAgents.mockResolvedValue(["claude"]);
			mockGetDriver.mockReturnValue(FAKE_DRIVER);
			mockSelectAgents.mockResolvedValue(selected(["claude"]));
			mockWriteManifest.mockResolvedValue(undefined);
			mockCleanupTempDir.mockResolvedValue(undefined);
			mockAddEntry.mockImplementation((manifest, key, entry) => ({
				...manifest,
				[key]: entry,
			}));
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			// Per-plugin computeIncomingFiles
			mockComputeIncomingFiles.mockImplementation((input: any) => {
				if (input.sourceDir?.endsWith("/pluginA")) {
					return [".claude/skills/pluginA/"];
				}
				if (input.sourceDir?.endsWith("/pluginB")) {
					return [".claude/skills/pluginB/"];
				}
				return [];
			});
			mockCheckFileCollisions.mockReturnValue(new Map());
			mockResolveCollisions.mockResolvedValue({
				resolved: true,
				updatedManifest: EMPTY_MANIFEST,
			});
			mockCheckUnmanagedConflicts.mockResolvedValue([]);
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [],
				cancelled: [],
			});
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });
		}

		it("per-plugin collision and unmanaged checks called for each plugin", async () => {
			setupCollectionConflictBase();

			await runAdd("owner/my-collection");

			expect(mockComputeIncomingFiles).toHaveBeenCalledTimes(2);
			expect(mockCheckFileCollisions).toHaveBeenCalledTimes(2);
			expect(mockCheckUnmanagedConflicts).toHaveBeenCalledTimes(2);
		});

		it("cancelled plugin at unmanaged stage excluded from copy", async () => {
			setupCollectionConflictBase();
			// pluginA has unmanaged conflict, user cancels
			mockCheckUnmanagedConflicts.mockImplementation(async (files) => {
				if (files.includes(".claude/skills/pluginA/")) {
					return [".claude/skills/pluginA/"];
				}
				return [];
			});
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [],
				cancelled: [".claude/skills/pluginA/"],
			});

			await runAdd("owner/my-collection");

			// Only pluginB should be copied
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
				}),
			);
		});

		it("cancelled plugin at collision stage excluded from copy", async () => {
			setupCollectionConflictBase();
			// pluginA has collision, user cancels
			mockCheckFileCollisions.mockImplementation((files) => {
				if (files.includes(".claude/skills/pluginA/")) {
					return new Map([["other/repo", [".claude/skills/pluginA/"]]]);
				}
				return new Map();
			});
			mockResolveCollisions.mockResolvedValue({
				resolved: false,
				updatedManifest: EMPTY_MANIFEST,
			});

			await runAdd("owner/my-collection");

			// Only pluginB should be copied
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
				}),
			);
		});

		it("all plugins cancelled exits gracefully", async () => {
			setupCollectionConflictBase();
			mockCheckFileCollisions.mockReturnValue(
				new Map([["other/repo", [".claude/skills/pluginA/"]]]),
			);
			mockResolveCollisions.mockResolvedValue({
				resolved: false,
				updatedManifest: EMPTY_MANIFEST,
			});

			const err = await runAdd("owner/my-collection").catch((e) => e);

			// Should still succeed even with all cancelled (just nothing installed)
			// The behavior depends on implementation - might show "no plugins installed"
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("collision removal persists even if plugin later cancelled at unmanaged", async () => {
			const manifestWithOther: Manifest = {
				"other/repo": {
					ref: "main",
					commit: "old123",
					installedAt: "2026-01-01T00:00:00.000Z",
					agents: ["claude"],
					files: [".claude/skills/pluginA/"],
				},
			};
			const manifestAfterRemoval: Manifest = {};
			setupCollectionConflictBase();
			mockReadManifest.mockResolvedValue(manifestWithOther);

			// pluginA: collision found, user resolves (removes other/repo)
			mockCheckFileCollisions.mockImplementation((files) => {
				if (files.includes(".claude/skills/pluginA/")) {
					return new Map([["other/repo", [".claude/skills/pluginA/"]]]);
				}
				return new Map();
			});
			mockResolveCollisions.mockResolvedValue({
				resolved: true,
				updatedManifest: manifestAfterRemoval,
			});
			// Then pluginA has unmanaged conflict, user cancels
			mockCheckUnmanagedConflicts.mockImplementation(async (files) => {
				if (files.includes(".claude/skills/pluginA/")) {
					return [".claude/skills/pluginA/"];
				}
				return [];
			});
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [],
				cancelled: [".claude/skills/pluginA/"],
			});

			await runAdd("owner/my-collection");

			// The manifest write should use the updated manifest (collision removal persisted)
			// pluginB should still be installed using the updated manifest
			expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
			// The final manifest write should reflect the removal from collision resolution
			const writeCall = mockWriteManifest.mock.calls[0];
			expect(writeCall).toBeDefined();
		});

		it("summary notes skipped plugins with reason", async () => {
			setupCollectionConflictBase();
			// pluginA has unmanaged conflict, user cancels
			mockCheckUnmanagedConflicts.mockImplementation(async (files) => {
				if (files.includes(".claude/skills/pluginA/")) {
					return [".claude/skills/pluginA/"];
				}
				return [];
			});
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [],
				cancelled: [".claude/skills/pluginA/"],
			});

			await runAdd("owner/my-collection");

			const outroCall = summaryText();
			expect(outroCall).toContain("pluginB");
			// Should note the skipped plugin
			expect(outroCall).toMatch(/1.*skip|cancel/i);
		});

		it("uses per-plugin manifest key as excludeKey for collision check", async () => {
			setupCollectionConflictBase();

			await runAdd("owner/my-collection");

			// Each plugin's collision check should use its own manifest key as excludeKey
			const collisionCalls = mockCheckFileCollisions.mock.calls;
			expect(collisionCalls).toHaveLength(2);
			expect(collisionCalls[0]![2]).toBe("owner/my-collection/pluginA");
			expect(collisionCalls[1]![2]).toBe("owner/my-collection/pluginB");
		});
	});

	describe("shared conflict-check pipeline", () => {
		describe("standalone path uses shared pipeline", () => {
			it("skips resolveCollisions when no collisions exist", async () => {
				mockCheckFileCollisions.mockReturnValue(new Map());

				await runAdd("owner/my-skill");

				expect(mockResolveCollisions).not.toHaveBeenCalled();
				expect(mockCheckUnmanagedConflicts).toHaveBeenCalled();
				expect(mockCopyBareSkill).toHaveBeenCalled();
			});

			it("skips resolveUnmanagedConflicts when no unmanaged conflicts exist", async () => {
				mockCheckUnmanagedConflicts.mockResolvedValue([]);

				await runAdd("owner/my-skill");

				expect(mockResolveUnmanagedConflicts).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).toHaveBeenCalled();
			});

			it("cancel at collision stage throws ExitSignal(0) and does not copy", async () => {
				mockCheckFileCollisions.mockReturnValue(
					new Map([["other/repo", [".claude/skills/my-skill/"]]]),
				);
				mockResolveCollisions.mockResolvedValue({
					resolved: false,
					updatedManifest: EMPTY_MANIFEST,
				});

				const err = await runAdd("owner/my-skill").catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(mockCheckUnmanagedConflicts).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
			});

			it("cancel at unmanaged stage throws ExitSignal(0) and does not copy", async () => {
				mockCheckUnmanagedConflicts.mockResolvedValue([
					".claude/skills/my-skill/",
				]);
				mockResolveUnmanagedConflicts.mockResolvedValue({
					approved: [],
					cancelled: [".claude/skills/my-skill/"],
				});

				const err = await runAdd("owner/my-skill").catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
			});

			it("full pipeline order: collision-check, resolve, unmanaged-check, resolve", async () => {
				const callOrder: string[] = [];
				mockCheckFileCollisions.mockImplementation(() => {
					callOrder.push("checkFileCollisions");
					return new Map([["other/repo", [".claude/skills/my-skill/"]]]);
				});
				mockResolveCollisions.mockImplementation(async () => {
					callOrder.push("resolveCollisions");
					return { resolved: true, updatedManifest: EMPTY_MANIFEST };
				});
				mockCheckUnmanagedConflicts.mockImplementation(async () => {
					callOrder.push("checkUnmanagedConflicts");
					return [".claude/skills/my-skill/"];
				});
				mockResolveUnmanagedConflicts.mockImplementation(async () => {
					callOrder.push("resolveUnmanagedConflicts");
					return { approved: [".claude/skills/my-skill/"], cancelled: [] };
				});

				await runAdd("owner/my-skill");

				expect(callOrder).toEqual([
					"checkFileCollisions",
					"resolveCollisions",
					"checkUnmanagedConflicts",
					"resolveUnmanagedConflicts",
				]);
			});
		});

		describe("collection path uses shared pipeline", () => {
			const COLLECTION_PARSED: ParsedSource = {
				type: "github-shorthand",
				owner: "owner",
				repo: "my-collection",
				ref: "main",
				manifestKey: "owner/my-collection",
			};

			const COLLECTION_CLONE_RESULT: CloneResult = {
				tempDir: "/tmp/agntc-shared-test",
				commit: "shared123",
			};

			const COLLECTION_DETECTED: DetectedType = {
				type: "collection",
				plugins: ["pluginA", "pluginB"],
			};

			function setupSharedCollectionTest(): void {
				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadConfig.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
					return { agents: ["claude"] };
				});
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockNukeManifestFiles.mockResolvedValue({
					removed: [],
					skipped: [],
				});
				mockComputeIncomingFiles.mockImplementation((input: any) => {
					if (input.sourceDir?.endsWith("/pluginA"))
						return [".claude/skills/pluginA/"];
					if (input.sourceDir?.endsWith("/pluginB"))
						return [".claude/skills/pluginB/"];
					return [];
				});
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockCopyBareSkill
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginA/"],
					})
					.mockResolvedValueOnce({
						copiedFiles: [".claude/skills/pluginB/"],
					});
			}

			it("skips resolveCollisions per-plugin when no collisions exist", async () => {
				setupSharedCollectionTest();

				await runAdd("owner/my-collection");

				expect(mockResolveCollisions).not.toHaveBeenCalled();
				expect(mockCheckUnmanagedConflicts).toHaveBeenCalledTimes(2);
			});

			it("skips resolveUnmanagedConflicts per-plugin when no unmanaged conflicts exist", async () => {
				setupSharedCollectionTest();

				await runAdd("owner/my-collection");

				expect(mockResolveUnmanagedConflicts).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(2);
			});

			it("collision cancel on pluginA skips it but pluginB still installs", async () => {
				setupSharedCollectionTest();
				mockCheckFileCollisions.mockImplementation((files) => {
					if (files.includes(".claude/skills/pluginA/")) {
						return new Map([["other/repo", [".claude/skills/pluginA/"]]]);
					}
					return new Map();
				});
				mockResolveCollisions.mockResolvedValue({
					resolved: false,
					updatedManifest: EMPTY_MANIFEST,
				});

				await runAdd("owner/my-collection");

				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				expect(mockCopyBareSkill).toHaveBeenCalledWith(
					expect.objectContaining({
						sourceDir: COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
					}),
				);
			});

			it("unmanaged cancel on pluginA skips it but pluginB still installs", async () => {
				setupSharedCollectionTest();
				mockCheckUnmanagedConflicts.mockImplementation(async (files) => {
					if (files.includes(".claude/skills/pluginA/")) {
						return [".claude/skills/pluginA/"];
					}
					return [];
				});
				mockResolveUnmanagedConflicts.mockResolvedValue({
					approved: [],
					cancelled: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				expect(mockCopyBareSkill).toHaveBeenCalledWith(
					expect.objectContaining({
						sourceDir: COLLECTION_CLONE_RESULT.tempDir + "/pluginB",
					}),
				);
			});

			it("full pipeline order per-plugin: collision-check, resolve, unmanaged-check, resolve", async () => {
				setupSharedCollectionTest();
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA"]);
				const callOrder: string[] = [];
				mockCheckFileCollisions.mockImplementation(() => {
					callOrder.push("checkFileCollisions");
					return new Map([["other/repo", [".claude/skills/pluginA/"]]]);
				});
				mockResolveCollisions.mockImplementation(async () => {
					callOrder.push("resolveCollisions");
					return { resolved: true, updatedManifest: EMPTY_MANIFEST };
				});
				mockCheckUnmanagedConflicts.mockImplementation(async () => {
					callOrder.push("checkUnmanagedConflicts");
					return [".claude/skills/pluginA/"];
				});
				mockResolveUnmanagedConflicts.mockImplementation(async () => {
					callOrder.push("resolveUnmanagedConflicts");
					return {
						approved: [".claude/skills/pluginA/"],
						cancelled: [],
					};
				});
				mockCopyBareSkill.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd("owner/my-collection");

				expect(callOrder).toEqual([
					"checkFileCollisions",
					"resolveCollisions",
					"checkUnmanagedConflicts",
					"resolveUnmanagedConflicts",
				]);
			});
		});
	});

	describe("bare add — tag resolution", () => {
		const BARE_PARSED: ParsedSource = {
			type: "github-shorthand",
			owner: "owner",
			repo: "my-skill",
			ref: null,
			constraint: null,
			manifestKey: "owner/my-skill",
			cloneUrl: "https://github.com/owner/my-skill.git",
		};

		function setupBareAdd(): void {
			setupHappyPath();
			mockParseSource.mockReturnValue(BARE_PARSED);
		}

		it("bare add resolves latest semver tag and auto-applies caret constraint", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-skill");

			// cloneSource should receive resolved tag, not constraint
			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v2.0.0");

			// manifest entry should have constraint and ref
			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("v2.0.0");
			expect(entry.constraint).toBe("^2.0.0");
		});

		it("bare add falls back to HEAD when no semver tags exist", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue([]);
			mockResolveLatestVersion.mockReturnValue(null);

			await runAdd("owner/my-skill");

			// cloneSource gets null ref (clone default branch)
			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBeNull();

			// no constraint in manifest
			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.constraint).toBeUndefined();
			expect(entry.ref).toBeNull();
		});

		it("bare add falls back to HEAD when only pre-release tags exist", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0-beta.1", "v2.0.0-rc.1"]);
			mockResolveLatestVersion.mockReturnValue(null);

			await runAdd("owner/my-skill");

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBeNull();

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.constraint).toBeUndefined();
		});

		it("bare add ignores non-semver tags", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue([
				"latest",
				"release-candidate",
				"nope",
			]);
			mockResolveLatestVersion.mockReturnValue(null);

			await runAdd("owner/my-skill");

			// resolveLatestVersion was called with whatever fetchRemoteTags returned
			expect(mockResolveLatestVersion).toHaveBeenCalledWith([
				"latest",
				"release-candidate",
				"nope",
			]);

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBeNull();
		});

		it("bare add with mixed semver and non-semver tags picks highest semver", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue([
				"v1.0.0",
				"latest",
				"v2.0.0",
				"beta",
			]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-skill");

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v2.0.0");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.constraint).toBe("^2.0.0");
		});

		it("bare add local path skips tag resolution", async () => {
			setupHappyPath();
			mockParseSource.mockReturnValue({
				type: "local-path",
				resolvedPath: "/Users/lee/Code/my-skill",
				ref: null,
				constraint: null,
				manifestKey: "/Users/lee/Code/my-skill",
			} satisfies ParsedSource);

			await runAdd("./my-skill");

			expect(mockFetchRemoteTags).not.toHaveBeenCalled();
			expect(mockResolveLatestVersion).not.toHaveBeenCalled();
		});

		it("bare add stores constraint in manifest entry", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-skill");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.constraint).toBe("^2.0.0");
			expect(entry.ref).toBe("v2.0.0");
			expect(entry.commit).toBe("abc123def456");
		});

		it("bare add clones at resolved tag not constraint expression", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-skill");

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			// Should be the actual tag name, not "^2.0.0"
			expect(cloneCall.ref).toBe("v2.0.0");
			expect(cloneCall.ref).not.toContain("^");
		});

		it("bare add calls fetchRemoteTags exactly once", async () => {
			setupBareAdd();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-skill");

			expect(mockFetchRemoteTags).toHaveBeenCalledTimes(1);
		});
	});

	describe("explicit constraint — tag resolution", () => {
		const CONSTRAINT_PARSED: ParsedSource = {
			type: "github-shorthand",
			owner: "owner",
			repo: "my-skill",
			ref: null,
			constraint: "^1.0",
			manifestKey: "owner/my-skill",
			cloneUrl: "https://github.com/owner/my-skill.git",
		};

		function setupExplicitConstraint(): void {
			setupHappyPath();
			mockParseSource.mockReturnValue(CONSTRAINT_PARSED);
		}

		it("explicit caret constraint resolves best matching tag", async () => {
			setupExplicitConstraint();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v2.0.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.1.0",
				version: "1.1.0",
			});

			await runAdd("owner/my-skill@^1.0");

			// cloneSource should receive resolved tag
			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v1.1.0");

			// manifest entry should have constraint and ref
			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("v1.1.0");
			expect(entry.constraint).toBe("^1.0");
		});

		it("explicit tilde constraint resolves best matching tag", async () => {
			setupExplicitConstraint();
			const tildeParsed: ParsedSource = {
				...CONSTRAINT_PARSED,
				constraint: "~1.0.0",
			};
			mockParseSource.mockReturnValue(tildeParsed);
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.0.5", "v1.1.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.0.5",
				version: "1.0.5",
			});

			await runAdd("owner/my-skill@~1.0.0");

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v1.0.5");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("v1.0.5");
			expect(entry.constraint).toBe("~1.0.0");
		});

		it("no tags satisfy constraint throws error", async () => {
			setupExplicitConstraint();
			const parsed: ParsedSource = {
				...CONSTRAINT_PARSED,
				constraint: "^2.0",
			};
			mockParseSource.mockReturnValue(parsed);
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v1.2.0"]);
			mockResolveVersion.mockReturnValue(null);

			await expect(runAdd("owner/my-skill@^2.0")).rejects.toThrow(ExitSignal);

			// Should not clone
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("partial constraint resolves against full tags", async () => {
			setupExplicitConstraint();
			// ^1 is a partial constraint
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.2.3", "v2.0.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.2.3",
				version: "1.2.3",
			});

			await runAdd("owner/my-skill@^1");

			// resolveVersion called with original constraint and tags
			expect(mockResolveVersion).toHaveBeenCalledWith("^1.0", [
				"v1.0.0",
				"v1.2.3",
				"v2.0.0",
			]);

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v1.2.3");
		});

		it("pre-1.0 caret semantics work correctly", async () => {
			setupExplicitConstraint();
			const parsed: ParsedSource = {
				...CONSTRAINT_PARSED,
				constraint: "^0.2.0",
			};
			mockParseSource.mockReturnValue(parsed);
			mockFetchRemoteTags.mockResolvedValue([
				"v0.1.0",
				"v0.2.0",
				"v0.2.5",
				"v0.3.0",
			]);
			mockResolveVersion.mockReturnValue({
				tag: "v0.2.5",
				version: "0.2.5",
			});

			await runAdd("owner/my-skill@^0.2.0");

			expect(mockResolveVersion).toHaveBeenCalledWith("^0.2.0", [
				"v0.1.0",
				"v0.2.0",
				"v0.2.5",
				"v0.3.0",
			]);

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v0.2.5");
		});

		it("explicit constraint stores original expression in manifest", async () => {
			setupExplicitConstraint();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.5.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.5.0",
				version: "1.5.0",
			});

			await runAdd("owner/my-skill@^1.0");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			// Stores original "^1.0", not normalized "^1.0.0"
			expect(entry.constraint).toBe("^1.0");
		});

		it("explicit constraint on HTTPS URL works", async () => {
			setupExplicitConstraint();
			const httpsParsed: ParsedSource = {
				type: "https-url",
				owner: "owner",
				repo: "my-skill",
				ref: null,
				constraint: "^1.0",
				manifestKey: "owner/my-skill",
				cloneUrl: "https://github.com/owner/my-skill.git",
			};
			mockParseSource.mockReturnValue(httpsParsed);
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.3.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.3.0",
				version: "1.3.0",
			});

			await runAdd("https://github.com/owner/my-skill@^1.0");

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v1.3.0");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.constraint).toBe("^1.0");
		});

		it("explicit constraint on SSH URL works", async () => {
			setupExplicitConstraint();
			const sshParsed: ParsedSource = {
				type: "ssh-url",
				owner: "owner",
				repo: "my-skill",
				ref: null,
				constraint: "^1.0",
				manifestKey: "owner/my-skill",
				cloneUrl: "git@github.com:owner/my-skill.git",
			};
			mockParseSource.mockReturnValue(sshParsed);
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.2.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.2.0",
				version: "1.2.0",
			});

			await runAdd("git@github.com:owner/my-skill@^1.0");

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v1.2.0");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.constraint).toBe("^1.0");
		});

		it("explicit constraint calls fetchRemoteTags exactly once", async () => {
			setupExplicitConstraint();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v2.0.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.1.0",
				version: "1.1.0",
			});

			await runAdd("owner/my-skill@^1.0");

			expect(mockFetchRemoteTags).toHaveBeenCalledTimes(1);
		});
	});

	describe("exact tag and branch ref — no constraint", () => {
		const EXACT_TAG_PARSED: ParsedSource = {
			type: "github-shorthand",
			owner: "owner",
			repo: "my-skill",
			ref: "v1.2.3",
			constraint: null,
			manifestKey: "owner/my-skill",
			cloneUrl: "https://github.com/owner/my-skill.git",
		};

		const BRANCH_REF_PARSED: ParsedSource = {
			type: "github-shorthand",
			owner: "owner",
			repo: "my-skill",
			ref: "main",
			constraint: null,
			manifestKey: "owner/my-skill",
			cloneUrl: "https://github.com/owner/my-skill.git",
		};

		function setupExactTag(): void {
			setupHappyPath();
			mockParseSource.mockReturnValue(EXACT_TAG_PARSED);
		}

		function setupBranchRef(): void {
			setupHappyPath();
			mockParseSource.mockReturnValue(BRANCH_REF_PARSED);
		}

		it("exact tag add produces manifest entry without constraint", async () => {
			setupExactTag();

			await runAdd("owner/my-skill@v1.2.3");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("v1.2.3");
			expect("constraint" in entry).toBe(false);
		});

		it("branch ref add produces manifest entry without constraint", async () => {
			setupBranchRef();

			await runAdd("owner/my-skill@main");

			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("main");
			expect("constraint" in entry).toBe(false);
		});

		it("exact tag add does not call ls-remote", async () => {
			setupExactTag();

			await runAdd("owner/my-skill@v1.2.3");

			expect(mockFetchRemoteTags).not.toHaveBeenCalled();
			expect(mockResolveLatestVersion).not.toHaveBeenCalled();
			expect(mockResolveVersion).not.toHaveBeenCalled();
		});

		it("branch ref add does not call ls-remote", async () => {
			setupBranchRef();

			await runAdd("owner/my-skill@main");

			expect(mockFetchRemoteTags).not.toHaveBeenCalled();
			expect(mockResolveLatestVersion).not.toHaveBeenCalled();
			expect(mockResolveVersion).not.toHaveBeenCalled();
		});

		it("re-add from constrained to exact tag removes constraint", async () => {
			setupExactTag();
			const existingEntry: ManifestEntry = {
				ref: "v1.0.0",
				commit: "old-commit",
				installedAt: "2025-01-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
				cloneUrl: "https://github.com/owner/my-skill.git",
				constraint: "^1.0",
			};
			mockReadManifest.mockResolvedValue({
				"owner/my-skill": existingEntry,
			});

			await runAdd("owner/my-skill@v1.2.3");

			// Should nuke old files
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				existingEntry.files,
			);

			// New entry should not have constraint
			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("v1.2.3");
			expect("constraint" in entry).toBe(false);
		});

		it("re-add from constrained to branch removes constraint", async () => {
			setupBranchRef();
			const existingEntry: ManifestEntry = {
				ref: "v1.0.0",
				commit: "old-commit",
				installedAt: "2025-01-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
				cloneUrl: "https://github.com/owner/my-skill.git",
				constraint: "^1.0",
			};
			mockReadManifest.mockResolvedValue({
				"owner/my-skill": existingEntry,
			});

			await runAdd("owner/my-skill@main");

			// Should nuke old files
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				existingEntry.files,
			);

			// New entry should not have constraint
			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("main");
			expect("constraint" in entry).toBe(false);
		});

		it("re-add from constrained to bare add applies new constraint", async () => {
			const BARE_PARSED: ParsedSource = {
				type: "github-shorthand",
				owner: "owner",
				repo: "my-skill",
				ref: null,
				constraint: null,
				manifestKey: "owner/my-skill",
				cloneUrl: "https://github.com/owner/my-skill.git",
			};
			setupHappyPath();
			mockParseSource.mockReturnValue(BARE_PARSED);
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});
			const existingEntry: ManifestEntry = {
				ref: "v1.0.0",
				commit: "old-commit",
				installedAt: "2025-01-01T00:00:00.000Z",
				agents: ["claude"],
				files: [".claude/skills/my-skill/"],
				cloneUrl: "https://github.com/owner/my-skill.git",
				constraint: "^1.0",
			};
			mockReadManifest.mockResolvedValue({
				"owner/my-skill": existingEntry,
			});

			await runAdd("owner/my-skill");

			// Should nuke old files
			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				existingEntry.files,
			);

			// New entry should have new constraint from bare-add resolution
			const addEntryCall = mockAddEntry.mock.calls[0]!;
			const entry = addEntryCall[2] as ManifestEntry;
			expect(entry.ref).toBe("v2.0.0");
			expect(entry.constraint).toBe("^2.0.0");
		});

		it("cloneSource receives exact tag ref directly", async () => {
			setupExactTag();

			await runAdd("owner/my-skill@v1.2.3");

			const cloneCall = mockCloneSource.mock.calls[0]![0] as ParsedSource;
			expect(cloneCall.ref).toBe("v1.2.3");
			expect(cloneCall.constraint).toBeNull();
		});
	});

	describe("collection constraint propagation", () => {
		const COLLECTION_BARE_PARSED: ParsedSource = {
			type: "github-shorthand",
			owner: "owner",
			repo: "my-collection",
			ref: null,
			constraint: null,
			manifestKey: "owner/my-collection",
			cloneUrl: "https://github.com/owner/my-collection.git",
		};

		const COLLECTION_CLONE_RESULT: CloneResult = {
			tempDir: "/tmp/agntc-coll-constraint",
			commit: "coll-constraint-abc",
		};

		const COLLECTION_DETECTED: DetectedType = {
			type: "collection",
			plugins: ["pluginA", "pluginB"],
		};

		const PLUGIN_CONFIG: AgntcConfig = { agents: ["claude"] };
		const PLUGIN_BARE: DetectedType = { type: "bare-skill" };

		function setupCollectionConstraintBase(): void {
			mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
			mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
			mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
			mockDetectAgents.mockResolvedValue(["claude"]);
			mockGetDriver.mockReturnValue(FAKE_DRIVER);
			mockSelectAgents.mockResolvedValue(selected(["claude"]));
			mockWriteManifest.mockResolvedValue(undefined);
			mockCleanupTempDir.mockResolvedValue(undefined);
			mockAddEntry.mockImplementation((manifest, key, entry) => ({
				...manifest,
				[key]: entry,
			}));
			mockComputeIncomingFiles.mockReturnValue([".claude/skills/pluginA/"]);
			mockCheckFileCollisions.mockReturnValue(new Map());
			mockCheckUnmanagedConflicts.mockResolvedValue([]);
			mockResolveUnmanagedConflicts.mockResolvedValue({
				approved: [],
				cancelled: [],
			});
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			// Root readConfig returns null (no root agntc.json) — per-plugin returns config
			mockReadConfig.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return null;
				return PLUGIN_CONFIG;
			});
			// Root detectType returns collection — per-plugin returns bare-skill
			mockDetectType.mockImplementation(async (dir) => {
				if (dir === COLLECTION_CLONE_RESULT.tempDir) return COLLECTION_DETECTED;
				return PLUGIN_BARE;
			});
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginA/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/pluginB/"] });
		}

		it("collection bare add auto-applies same ^X.Y.Z to all selected plugins", async () => {
			mockParseSource.mockReturnValue(COLLECTION_BARE_PARSED);
			setupCollectionConstraintBase();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-collection");

			const addEntryCalls = mockAddEntry.mock.calls;
			expect(addEntryCalls.length).toBe(2);

			const entryA = addEntryCalls[0]![2] as ManifestEntry;
			const entryB = addEntryCalls[1]![2] as ManifestEntry;

			expect(entryA.constraint).toBe("^2.0.0");
			expect(entryA.ref).toBe("v2.0.0");
			expect(entryB.constraint).toBe("^2.0.0");
			expect(entryB.ref).toBe("v2.0.0");
		});

		it("collection with explicit constraint propagates to all plugins", async () => {
			const explicitConstraintParsed: ParsedSource = {
				...COLLECTION_BARE_PARSED,
				constraint: "^1.0",
			};
			mockParseSource.mockReturnValue(explicitConstraintParsed);
			setupCollectionConstraintBase();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v2.0.0"]);
			mockResolveVersion.mockReturnValue({
				tag: "v1.1.0",
				version: "1.1.0",
			});

			await runAdd("owner/my-collection@^1.0");

			const addEntryCalls = mockAddEntry.mock.calls;
			expect(addEntryCalls.length).toBe(2);

			const entryA = addEntryCalls[0]![2] as ManifestEntry;
			const entryB = addEntryCalls[1]![2] as ManifestEntry;

			expect(entryA.constraint).toBe("^1.0");
			expect(entryA.ref).toBe("v1.1.0");
			expect(entryB.constraint).toBe("^1.0");
			expect(entryB.ref).toBe("v1.1.0");
		});

		it("collection with exact tag has no constraint on plugins", async () => {
			const exactTagParsed: ParsedSource = {
				...COLLECTION_BARE_PARSED,
				ref: "v1.0.0",
			};
			mockParseSource.mockReturnValue(exactTagParsed);
			setupCollectionConstraintBase();

			await runAdd("owner/my-collection@v1.0.0");

			const addEntryCalls = mockAddEntry.mock.calls;
			expect(addEntryCalls.length).toBe(2);

			const entryA = addEntryCalls[0]![2] as ManifestEntry;
			const entryB = addEntryCalls[1]![2] as ManifestEntry;

			expect("constraint" in entryA).toBe(false);
			expect(entryA.ref).toBe("v1.0.0");
			expect("constraint" in entryB).toBe(false);
			expect(entryB.ref).toBe("v1.0.0");
		});

		it("collection with branch ref has no constraint on plugins", async () => {
			const branchParsed: ParsedSource = {
				...COLLECTION_BARE_PARSED,
				ref: "main",
			};
			mockParseSource.mockReturnValue(branchParsed);
			setupCollectionConstraintBase();

			await runAdd("owner/my-collection@main");

			const addEntryCalls = mockAddEntry.mock.calls;
			expect(addEntryCalls.length).toBe(2);

			const entryA = addEntryCalls[0]![2] as ManifestEntry;
			const entryB = addEntryCalls[1]![2] as ManifestEntry;

			expect("constraint" in entryA).toBe(false);
			expect(entryA.ref).toBe("main");
			expect("constraint" in entryB).toBe(false);
			expect(entryB.ref).toBe("main");
		});

		it("collection bare add with no semver tags falls back to HEAD", async () => {
			mockParseSource.mockReturnValue(COLLECTION_BARE_PARSED);
			setupCollectionConstraintBase();
			mockFetchRemoteTags.mockResolvedValue([]);
			mockResolveLatestVersion.mockReturnValue(null);

			await runAdd("owner/my-collection");

			const addEntryCalls = mockAddEntry.mock.calls;
			expect(addEntryCalls.length).toBe(2);

			const entryA = addEntryCalls[0]![2] as ManifestEntry;
			const entryB = addEntryCalls[1]![2] as ManifestEntry;

			expect("constraint" in entryA).toBe(false);
			expect(entryA.ref).toBeNull();
			expect("constraint" in entryB).toBe(false);
			expect(entryB.ref).toBeNull();
		});

		it("collection tag resolution happens once not per-plugin", async () => {
			mockParseSource.mockReturnValue(COLLECTION_BARE_PARSED);
			setupCollectionConstraintBase();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-collection");

			// fetchRemoteTags should be called exactly once for the collection
			expect(mockFetchRemoteTags).toHaveBeenCalledTimes(1);
			expect(mockResolveLatestVersion).toHaveBeenCalledTimes(1);
		});

		it("direct-path member install preserves existing key/files via the standalone route", async () => {
			// With detection now against unitDir = root + '/' + targetPlugin, a
			// member of a collection resolves directly to its unit type and installs
			// STANDALONE keyed owner/repo/<targetPlugin> — same key and files as
			// the previous pipeline-based direct-path behaviour, no constraint.
			const directPathParsed: ParsedSource = {
				type: "direct-path",
				owner: "owner",
				repo: "my-collection",
				ref: "main",
				constraint: null,
				targetPlugin: "pluginA",
				manifestKey: "owner/my-collection/pluginA",
				cloneUrl: "https://github.com/owner/my-collection.git",
			};
			mockParseSource.mockReturnValue(directPathParsed);
			setupCollectionConstraintBase();
			const unitDir = `${COLLECTION_CLONE_RESULT.tempDir}/pluginA`;
			// detectType returns the member unit type when called with unitDir
			mockDetectType.mockImplementation(async (dir) => {
				if (dir.endsWith("/pluginA")) return PLUGIN_BARE;
				return COLLECTION_DETECTED;
			});
			mockReadConfig.mockResolvedValue(null);
			mockComputeIncomingFiles.mockReturnValue([".claude/skills/pluginA/"]);
			mockCopyBareSkill.mockReset();
			mockCopyBareSkill.mockResolvedValueOnce({
				copiedFiles: [".claude/skills/pluginA/"],
			});

			await runAdd("https://github.com/owner/my-collection/tree/main/pluginA");

			// direct-path has ref="main" (exact ref), no constraint resolution
			expect(mockFetchRemoteTags).not.toHaveBeenCalled();
			// Standalone route: copy from the member's unitDir, no multiselect.
			expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: unitDir }),
			);

			const addEntryCalls = mockAddEntry.mock.calls;
			expect(addEntryCalls.length).toBe(1);
			expect(addEntryCalls[0]![1]).toBe("owner/my-collection/pluginA");

			const entry = addEntryCalls[0]![2] as ManifestEntry;
			expect(entry.files).toEqual([".claude/skills/pluginA/"]);
			expect("constraint" in entry).toBe(false);
			expect(entry.ref).toBe("main");
		});

		it("each plugin manifest entry is independent", async () => {
			mockParseSource.mockReturnValue(COLLECTION_BARE_PARSED);
			setupCollectionConstraintBase();
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v2.0.0"]);
			mockResolveLatestVersion.mockReturnValue({
				tag: "v2.0.0",
				version: "2.0.0",
			});

			await runAdd("owner/my-collection");

			const addEntryCalls = mockAddEntry.mock.calls;
			expect(addEntryCalls.length).toBe(2);

			// Each entry is for a different manifest key
			const keyA = addEntryCalls[0]![1] as string;
			const keyB = addEntryCalls[1]![1] as string;
			expect(keyA).toBe("owner/my-collection/pluginA");
			expect(keyB).toBe("owner/my-collection/pluginB");

			// Each entry has its own installedAt, files, etc
			const entryA = addEntryCalls[0]![2] as ManifestEntry;
			const entryB = addEntryCalls[1]![2] as ManifestEntry;
			expect(entryA).not.toBe(entryB);
		});
	});

	describe("--plugin override flag", () => {
		it("registers --plugin as a boolean option on addCommand", () => {
			const flags = addCommand.options.map((o) => o.long);
			expect(flags).toContain("--plugin");
		});

		it("forwards forcePlugin: true to detectType when options.plugin is set", async () => {
			await runAdd("owner/my-skill", { forcePlugin: true });

			expect(mockDetectType).toHaveBeenCalledTimes(1);
			expect(mockDetectType).toHaveBeenCalledWith(
				CLONE_RESULT.tempDir,
				expect.objectContaining({ forcePlugin: true }),
			);
		});

		it("does not set forcePlugin true when flag absent (behaves as task 2-1)", async () => {
			await runAdd("owner/my-skill");

			expect(mockDetectType).toHaveBeenCalledTimes(1);
			const opts = mockDetectType.mock.calls[0]![1] as {
				forcePlugin?: boolean;
			};
			expect(opts.forcePlugin).toBeFalsy();
		});

		it("bundles a skills-only repo as a plugin via copyPluginAssets", async () => {
			// detectType resolves the skills-only ambiguity to plugin under --plugin
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue({
				type: "plugin",
				assetDirs: ["skills"],
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("owner/my-skill", { forcePlugin: true });

			expect(mockDetectType).toHaveBeenCalledWith(
				CLONE_RESULT.tempDir,
				expect.objectContaining({ forcePlugin: true }),
			);
			expect(mockCopyPluginAssets).toHaveBeenCalledWith(
				expect.objectContaining({ assetDirs: ["skills"] }),
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCancel).not.toHaveBeenCalled();
		});

		it("--plugin on a bare skill is a hard error attributing the conflict to the flag (no copy, no manifest)", async () => {
			// No config type:plugin — the conflict is triggered by the --plugin flag.
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockRejectedValue(
				new TypeConflictError("the source is a bare skill — cannot bundle"),
			);

			const err = await runAdd("owner/my-skill", {
				forcePlugin: true,
			}).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			const message = mockCancel.mock.calls[0]![0] as string;
			// Names the source (manifestKey).
			expect(message).toContain("owner/my-skill");
			// Attributes to the --plugin flag, not a config declaration.
			expect(message).toContain("--plugin flag");
			expect(message).not.toContain("declares type plugin");
			// Keeps the structural half from err.message.
			expect(message).toContain("the source is a bare skill — cannot bundle");
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});

		it("--plugin on a member-dirs collection is a hard error attributing the conflict to the flag, never enters the pipeline", async () => {
			// No config type:plugin — the conflict is triggered by the --plugin flag.
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockRejectedValue(
				new TypeConflictError(
					"its structure is a collection of 3 members — cannot bundle",
				),
			);

			const err = await runAdd("owner/my-skill", {
				forcePlugin: true,
			}).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			const message = mockCancel.mock.calls[0]![0] as string;
			expect(message).toContain("owner/my-skill");
			expect(message).toContain("--plugin flag");
			expect(message).not.toContain("declares type plugin");
			expect(message).toContain(
				"its structure is a collection of 3 members — cannot bundle",
			);
			// Collection pipeline must not be entered.
			expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("config type:plugin (no --plugin flag) on a conflicting structure attributes the conflict to the config declaration", async () => {
			// Config declares type:plugin; NO --plugin flag — config triggers the conflict.
			mockReadConfig.mockResolvedValue({ agents: ["claude"], type: "plugin" });
			mockDetectType.mockRejectedValue(
				new TypeConflictError("the source is a bare skill — cannot bundle"),
			);

			const err = await runAdd("owner/my-skill").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			const message = mockCancel.mock.calls[0]![0] as string;
			expect(message).toContain("owner/my-skill");
			expect(message).toContain("declares type plugin but");
			expect(message).not.toContain("--plugin flag");
			expect(message).toContain("the source is a bare skill — cannot bundle");
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
		});

		it("--plugin on a multi-asset plugin is a redundant no-op and installs normally", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockResolvedValue({
				type: "plugin",
				assetDirs: ["skills", "agents"],
			});
			mockCopyPluginAssets.mockResolvedValue({
				copiedFiles: [".claude/skills/planning/"],
				assetCountsByAgent: { claude: { skills: 1 } },
			});

			await runAdd("owner/my-skill", { forcePlugin: true });

			expect(mockCopyPluginAssets).toHaveBeenCalled();
			expect(mockCancel).not.toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("TypeConflictError surfaces before any manifest write or copy (pre-flight)", async () => {
			mockReadConfig.mockResolvedValue(null);
			mockDetectType.mockRejectedValue(
				new TypeConflictError("the source is a bare skill — cannot bundle"),
			);

			await runAdd("owner/my-skill", { forcePlugin: true }).catch(() => {});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockComputeIncomingFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockCopyPluginAssets).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			// Temp dir still cleaned up.
			expect(mockCleanupTempDir).toHaveBeenCalledWith(CLONE_RESULT.tempDir);
		});
	});

	describe("copy-safety pre-flight", () => {
		describe("standalone", () => {
			it("whole-repo bare skill runs symlink scan over unit dir + no-op traversal guard", async () => {
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);

				await runAdd("owner/my-skill");

				// Symlink scan: unitDir === cloneRoot === sourceDir (tempDir).
				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					CLONE_RESULT.tempDir,
					CLONE_RESULT.tempDir,
				);
				// Traversal guard runs but with no selector (no-op).
				expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
					CLONE_RESULT.tempDir,
					undefined,
				);
				expect(mockCopyBareSkill).toHaveBeenCalled();
			});

			it("local-path source scans with cloneRoot = resolved local path", async () => {
				mockParseSource.mockReturnValue({
					type: "local-path",
					resolvedPath: "/Users/lee/Code/my-skill",
					ref: null,
					manifestKey: "/Users/lee/Code/my-skill",
				});
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);

				await runAdd("/Users/lee/Code/my-skill");

				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					"/Users/lee/Code/my-skill",
					"/Users/lee/Code/my-skill",
				);
			});

			it("standalone symlink scan boundary is clone root, not unit dir, for a tree-path unit", async () => {
				const UNIT_DIR = `${CLONE_RESULT.tempDir}/pluginA`;
				mockParseSource.mockReturnValue({
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "pluginA",
					manifestKey: "owner/my-collection/pluginA",
					cloneUrl: "https://github.com/owner/my-collection.git",
				});
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);

				await runAdd(
					"https://github.com/owner/my-collection/tree/main/pluginA",
				);

				// unitDir is the subdir; boundary stays the clone root (tempDir).
				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					UNIT_DIR,
					CLONE_RESULT.tempDir,
				);
				// Traversal guard validates the selector subpath against the clone root.
				expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
					CLONE_RESULT.tempDir,
					"pluginA",
				);
			});

			it("selector subpath escaping clone errors pre-flight before any copy/nuke/write", async () => {
				mockParseSource.mockReturnValue({
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "../evil",
					manifestKey: "owner/my-collection/../evil",
					cloneUrl: "https://github.com/owner/my-collection.git",
				});
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);
				mockAssertSubpathWithinClone.mockImplementation(() => {
					throw new PathTraversalError("../evil");
				});

				const err = await runAdd(
					"https://github.com/owner/my-collection/tree/main/../evil",
				).catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				// Identity-prefixed cancel with the guard message.
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("owner/my-collection/../evil"),
				);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("resolves outside the clone root"),
				);
				// No mutation.
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockCopyPluginAssets).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});

			it("valid subpath but escaping symlink errors pre-flight before any copy/nuke/write", async () => {
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);
				mockScanForEscapingSymlinks.mockRejectedValue(
					new SymlinkEscapeError("bad-link", "/etc/passwd"),
				);

				const err = await runAdd("owner/my-skill").catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("owner/my-skill"),
				);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("points outside the clone"),
				);
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});

			it("scan runs BEFORE nukeManifestFiles on reinstall", async () => {
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);
				const existing: Manifest = {
					"owner/my-skill": {
						ref: "main",
						commit: "old",
						installedAt: "2026-01-01T00:00:00.000Z",
						agents: ["claude"],
						files: [".claude/skills/my-skill/"],
					},
				};
				mockReadManifest.mockResolvedValue(existing);
				const order: string[] = [];
				mockScanForEscapingSymlinks.mockImplementation(async () => {
					order.push("scan");
				});
				mockNukeManifestFiles.mockImplementation(async () => {
					order.push("nuke");
					return { removed: [], skipped: [] };
				});

				await runAdd("owner/my-skill");

				expect(order).toEqual(["scan", "nuke"]);
			});

			it("lexical traversal guard fires BEFORE readConfig/detectType for a direct-path source (analysis 1-2)", async () => {
				const UNIT_DIR = `${CLONE_RESULT.tempDir}/pluginA`;
				mockParseSource.mockReturnValue({
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "pluginA",
					manifestKey: "owner/my-collection/pluginA",
					cloneUrl: "https://github.com/owner/my-collection.git",
				});
				const order: string[] = [];
				mockAssertSubpathWithinClone.mockImplementation(() => {
					order.push("guard");
				});
				mockReadConfig.mockImplementation(async () => {
					order.push("readConfig");
					return null;
				});
				mockDetectType.mockImplementation(async () => {
					order.push("detectType");
					return BARE_SKILL;
				});

				await runAdd(
					"https://github.com/owner/my-collection/tree/main/pluginA",
				);

				// Guard validated the selector subpath against the clone root first.
				expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
					CLONE_RESULT.tempDir,
					"pluginA",
				);
				// Scan still ran with unitDir vs clone root boundary.
				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					UNIT_DIR,
					CLONE_RESULT.tempDir,
				);
				// The lexical guard precedes the FIRST read of the joined subpath.
				expect(order[0]).toBe("guard");
				expect(order.indexOf("guard")).toBeLessThan(
					order.indexOf("readConfig"),
				);
				expect(order.indexOf("guard")).toBeLessThan(
					order.indexOf("detectType"),
				);
			});

			it("escaping direct-path selector aborts BEFORE readConfig/detectType touch the joined path (analysis 1-2)", async () => {
				mockParseSource.mockReturnValue({
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "../evil",
					manifestKey: "owner/my-collection/../evil",
					cloneUrl: "https://github.com/owner/my-collection.git",
				});
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockResolvedValue(BARE_SKILL);
				mockAssertSubpathWithinClone.mockImplementation(() => {
					throw new PathTraversalError("../evil");
				});

				const err = await runAdd(
					"https://github.com/owner/my-collection/tree/main/../evil",
				).catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				// Identity-prefixed cancel with the guard message.
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("owner/my-collection/../evil"),
				);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("resolves outside the clone root"),
				);
				// No filesystem read at the joined (escaped) path occurred.
				expect(mockReadConfig).not.toHaveBeenCalled();
				expect(mockDetectType).not.toHaveBeenCalled();
				// And no on-disk mutation.
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockCopyBareSkill).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});
		});

		describe("collection", () => {
			const COLLECTION_PARSED: ParsedSource = {
				type: "github-shorthand",
				owner: "owner",
				repo: "my-collection",
				ref: "main",
				manifestKey: "owner/my-collection",
			};
			const COLLECTION_CLONE_RESULT: CloneResult = {
				tempDir: "/tmp/agntc-coll123",
				commit: "coll123def456",
			};
			const COLLECTION_DETECTED: DetectedType = {
				type: "collection",
				plugins: ["pluginA", "pluginB"],
			};

			function setupCollection(): void {
				mockParseSource.mockReturnValue(COLLECTION_PARSED);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockSelectCollectionPlugins.mockResolvedValue(["pluginA", "pluginB"]);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					return { type: "bare-skill" } as DetectedType;
				});
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/x/"],
				});
			}

			it("scans each member independently against the clone root before its copy", async () => {
				setupCollection();

				await runAdd("owner/my-collection");

				// Each member dir scanned with the clone root as boundary (not unitDir).
				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					`${COLLECTION_CLONE_RESULT.tempDir}/pluginA`,
					COLLECTION_CLONE_RESULT.tempDir,
				);
				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					`${COLLECTION_CLONE_RESULT.tempDir}/pluginB`,
					COLLECTION_CLONE_RESULT.tempDir,
				);
			});

			it("member with escaping symlink reported failed while siblings install", async () => {
				setupCollection();
				mockScanForEscapingSymlinks.mockImplementation(async (unitDir) => {
					if (unitDir === `${COLLECTION_CLONE_RESULT.tempDir}/pluginA`) {
						throw new SymlinkEscapeError("bad-link", "/etc/passwd");
					}
				});

				const err = await runAdd("owner/my-collection").catch((e) => e);

				// pluginB installs, pluginA does not.
				expect(mockCopyBareSkill).toHaveBeenCalledTimes(1);
				const keys = mockAddEntry.mock.calls.map((c) => c[1]);
				expect(keys).toContain("owner/my-collection/pluginB");
				expect(keys).not.toContain("owner/my-collection/pluginA");
				// Manifest still written (siblings commit).
				expect(mockWriteManifest).toHaveBeenCalledTimes(1);
				// Summary rendered.
				expect(mockOutro).toHaveBeenCalled();
				// Non-zero exit after the write + summary.
				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				// Failed member surfaced in the summary.
				const outroCall = summaryText();
				expect(outroCall).toContain("pluginA");
				expect(outroCall).toMatch(/failed/i);
			});

			it("write + summary happen BEFORE the non-zero exit on a failed member", async () => {
				setupCollection();
				mockScanForEscapingSymlinks.mockImplementation(async (unitDir) => {
					if (unitDir === `${COLLECTION_CLONE_RESULT.tempDir}/pluginA`) {
						throw new SymlinkEscapeError("bad-link", "/etc/passwd");
					}
				});
				const order: string[] = [];
				mockWriteManifest.mockImplementation(async () => {
					order.push("write");
				});
				mockOutro.mockImplementation(() => {
					order.push("summary");
				});

				const err = await runAdd("owner/my-collection").catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect(order).toEqual(["write", "summary"]);
			});

			it("member scan runs BEFORE that member's nuke on reinstall", async () => {
				setupCollection();
				mockReadManifest.mockResolvedValue({
					"owner/my-collection/pluginA": {
						ref: "main",
						commit: "old",
						installedAt: "2026-01-01T00:00:00.000Z",
						agents: ["claude"],
						files: [".claude/skills/pluginA/"],
					},
				});
				const order: string[] = [];
				mockScanForEscapingSymlinks.mockImplementation(async (unitDir) => {
					if (unitDir === `${COLLECTION_CLONE_RESULT.tempDir}/pluginA`) {
						order.push("scan-A");
					}
				});
				mockNukeManifestFiles.mockImplementation(async () => {
					order.push("nuke-A");
					return { removed: [], skipped: [] };
				});

				await runAdd("owner/my-collection").catch(() => {});

				expect(order[0]).toBe("scan-A");
				expect(order).toContain("nuke-A");
				expect(order.indexOf("scan-A")).toBeLessThan(order.indexOf("nuke-A"));
			});

			it("a run whose only non-success outcome is skipped does NOT exit non-zero", async () => {
				setupCollection();
				// pluginA detects not-agntc (skipped); pluginB installs.
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === COLLECTION_CLONE_RESULT.tempDir)
						return COLLECTION_DETECTED;
					if (dir.endsWith("/pluginA"))
						return { type: "not-agntc" } as DetectedType;
					return { type: "bare-skill" } as DetectedType;
				});

				await expect(runAdd("owner/my-collection")).resolves.toBeUndefined();

				expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			});

			it("direct-path collection member runs the traversal guard against the clone root", async () => {
				const TREE_PARSED: ParsedSource = {
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "pluginA",
					manifestKey: "owner/my-collection/pluginA",
					cloneUrl: "https://github.com/owner/my-collection.git",
				};
				const unitDir = `${COLLECTION_CLONE_RESULT.tempDir}/pluginA`;
				mockParseSource.mockReturnValue(TREE_PARSED);
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadConfig.mockResolvedValue(null);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				mockDetectAgents.mockResolvedValue(["claude"]);
				mockGetDriver.mockReturnValue(FAKE_DRIVER);
				mockSelectAgents.mockResolvedValue(selected(["claude"]));
				mockWriteManifest.mockResolvedValue(undefined);
				mockCleanupTempDir.mockResolvedValue(undefined);
				mockComputeIncomingFiles.mockReturnValue([]);
				mockCheckFileCollisions.mockReturnValue(new Map());
				mockCheckUnmanagedConflicts.mockResolvedValue([]);
				mockAddEntry.mockImplementation((manifest, key, entry) => ({
					...manifest,
					[key]: entry,
				}));
				mockDetectType.mockImplementation(async (dir) => {
					// The unit re-detects as a collection routing into the pipeline.
					if (dir === unitDir) {
						return { type: "collection", plugins: ["pluginA"] } as DetectedType;
					}
					return { type: "bare-skill" } as DetectedType;
				});
				mockCopyBareSkill.mockResolvedValue({
					copiedFiles: [".claude/skills/pluginA/"],
				});

				await runAdd(
					"https://github.com/owner/my-collection/tree/main/pluginA",
				);

				// Boundary for the member scan is the true clone root (tempDir), not unitDir.
				expect(mockScanForEscapingSymlinks).toHaveBeenCalledWith(
					`${unitDir}/pluginA`,
					COLLECTION_CLONE_RESULT.tempDir,
				);
				// Traversal guard validated the selector against the clone root.
				expect(mockAssertSubpathWithinClone).toHaveBeenCalledWith(
					COLLECTION_CLONE_RESULT.tempDir,
					"pluginA",
				);
			});

			it("escaping direct-path selector aborts BEFORE runCollectionPipeline reads member configs (analysis 1-2)", async () => {
				const unitDir = `${COLLECTION_CLONE_RESULT.tempDir}/../evil`;
				mockParseSource.mockReturnValue({
					type: "direct-path",
					owner: "owner",
					repo: "my-collection",
					ref: "main",
					targetPlugin: "../evil",
					manifestKey: "owner/my-collection/../evil",
					cloneUrl: "https://github.com/owner/my-collection.git",
				});
				mockCloneSource.mockResolvedValue(COLLECTION_CLONE_RESULT);
				mockReadManifest.mockResolvedValue(EMPTY_MANIFEST);
				// Were the joined path read, it would route into the pipeline.
				mockReadConfig.mockResolvedValue(null);
				mockDetectType.mockImplementation(async (dir) => {
					if (dir === unitDir) {
						return { type: "collection", plugins: ["pluginA"] } as DetectedType;
					}
					return { type: "bare-skill" } as DetectedType;
				});
				mockAssertSubpathWithinClone.mockImplementation(() => {
					throw new PathTraversalError("../evil");
				});

				const err = await runAdd(
					"https://github.com/owner/my-collection/tree/main/../evil",
				).catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(1);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("owner/my-collection/../evil"),
				);
				expect(mockCancel).toHaveBeenCalledWith(
					expect.stringContaining("resolves outside the clone root"),
				);
				// Pipeline never entered: no member config read, no select, no write.
				expect(mockReadConfig).not.toHaveBeenCalled();
				expect(mockDetectType).not.toHaveBeenCalled();
				expect(mockSelectCollectionPlugins).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});
		});
	});
});

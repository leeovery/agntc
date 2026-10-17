import type { Stats } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdatableCheck, UpdateRun } from "../../src/key-update.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { Scope } from "../../src/scope.js";
import type { Row } from "../../src/terminal/types.js";

// The clone-reinstall dependency surface shared with list-change-version-action
// is mocked via factory bodies authored once in ../helpers/list-action-mocks.
// vitest hoists `vi.mock` to the top of *this* file and needs the literal
// module path at hoist time, so each `vi.mock(path, ...)` call lives here; the
// factory contents are delegated to the shared helper.
vi.mock("../../src/manifest.js", async (importOriginal) => {
	const { mockManifestModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockManifestModule(
		importOriginal<typeof import("../../src/manifest.js")>,
	);
});

vi.mock("../../src/git-clone.js", async () => {
	const { mockGitCloneModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockGitCloneModule();
});

vi.mock("../../src/nuke-files.js", async () => {
	const { mockNukeFilesModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockNukeFilesModule();
});

vi.mock("../../src/copy-pack.js", async (importOriginal) => {
	const { mockCopyPackModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyPackModule(
		importOriginal<typeof import("../../src/copy-pack.js")>,
	);
});

vi.mock("../../src/copy-bare-skill.js", async (importOriginal) => {
	const { mockCopyBareSkillModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyBareSkillModule(
		importOriginal<typeof import("../../src/copy-bare-skill.js")>,
	);
});

vi.mock("../../src/discover.js", async (importOriginal) => {
	const { mockDiscoverModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockDiscoverModule(
		importOriginal<typeof import("../../src/discover.js")>,
	);
});

vi.mock("../../src/unmanaged-check.js", async () => {
	const { mockUnmanagedCheckModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockUnmanagedCheckModule();
});

vi.mock("../../src/dropped-folders.js", async () => {
	const { mockDroppedFoldersModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockDroppedFoldersModule();
});

// File-specific: this file also needs `stat` (local-path validation).
vi.mock("node:fs/promises", () => ({
	stat: vi.fn(),
	access: vi.fn(),
}));

vi.mock("../../src/copy-safety.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/copy-safety.js")>();
	const { mockCopySafety } = await import("../helpers/copy-safety-mock.js");
	return {
		...actual,
		...mockCopySafety(actual.SymlinkEscapeError),
	};
});

import { stat } from "node:fs/promises";
import { executeUpdateAction } from "../../src/commands/list-update-action.js";
import { SymlinkEscapeError } from "../../src/copy-safety.js";
import { globalScope, projectScope } from "../../src/scope.js";
import { makeEntry } from "../helpers/factories.js";
import {
	looseSkillsAt,
	packAt,
	REMOTE_SHA,
	setupListActionMocks,
} from "../helpers/list-action-mocks.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const mocks = setupListActionMocks();
const mockWriteManifest = mocks.writeManifest;
const mockAddEntry = mocks.addEntry;
const mockCloneSource = mocks.cloneSource;
const mockCleanupTempDir = mocks.cleanupTempDir;
const mockNukeManifestFiles = mocks.nukeManifestFiles;
const mockCopyBareSkill = mocks.copyBareSkill;
const mockCopyPack = mocks.copyPack;
const mockAccess = mocks.access;
const mockScanForEscapingSymlinks = mocks.scanForEscapingSymlinks;
const mockDiscover = mocks.discover;
const mockDroppedButInSource = mocks.droppedButInSource;
// File-specific handle: local-path validation via fs.stat.
const mockStat = vi.mocked(stat);
let ui: TestUi;

beforeEach(() => {
	ui = testUi();
});

const PROJECT = projectScope("/fake/project");
const REMOTE: UpdatableCheck = {
	status: "update-available",
	remoteCommit: REMOTE_SHA,
};

function runIn(scope: Scope = PROJECT): UpdateRun {
	return { scope, yes: false, ui, home: "/home/me" };
}

/** Updates the entry as the list's action does, a remote one as its check found a newer commit. */
function update(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest = { [key]: entry },
	check: UpdatableCheck = entry.commit === null ? { status: "local" } : REMOTE,
	scope: Scope = PROJECT,
) {
	return executeUpdateAction({ key, entry }, check, manifest, runIn(scope));
}

/** The row the update settled into. */
function settled(): Row {
	const rows = ui.rows();
	expect(rows).toHaveLength(1);
	return rows[0]!;
}

/** What was written as the manifest, the last time it was. */
function written(): Manifest {
	return mockWriteManifest.mock.calls.at(-1)![1];
}

function cloned(commit = REMOTE_SHA): void {
	mockCloneSource.mockResolvedValue({ tempDir: "/tmp/agntc-clone", commit });
}

describe("executeUpdateAction", () => {
	it("updates under the row `update <key>` draws: progress as its block's task, settling into the repo's row", async () => {
		const key = "owner/repo";
		const entry = makeEntry({ type: "skill" });
		cloned();
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/my-skill/"],
		});

		const result = await update(key, entry);

		expect(result).toEqual({ key, change: "updated" });
		expect(ui.block).toHaveBeenCalledWith([
			{
				subject: "owner/repo",
				meta: "HEAD",
				children: [{ name: "repo", status: "done" }],
			},
		]);
		const [task] = ui.blocks[0]!.tasks;
		expect(ui.blocks[0]!.task).toHaveBeenCalledWith({
			subject: "owner/repo",
			meta: "HEAD",
			text: "updating to bbbbbbb…",
		});
		expect(task!.settle).toHaveBeenCalledWith({
			status: "done",
			subject: "owner/repo",
			meta: "HEAD",
			detail: { move: { from: "aaaaaaa", to: "bbbbbbb" } },
			children: [{ name: "repo", detail: "skill · 1 file" }],
		});
	});

	describe("remote update (commit is not null)", () => {
		it("clones, nukes, copies and records the reinstalled entry", async () => {
			const key = "owner/repo";
			const entry = makeEntry();
			const manifest: Manifest = { [key]: entry };
			cloned();
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await update(key, entry, manifest);

			expect(mockCloneSource).toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				manifest,
				key,
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(written()[key]).toMatchObject({
				commit: REMOTE_SHA,
				files: [".claude/skills/my-skill/"],
			});
		});
	});

	describe("local update (commit is null)", () => {
		it("validates the path, refreshes from it without cloning, and counts it as updated", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ commit: null, ref: null });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			const result = await update(key, entry);

			expect(result).toEqual({ key, change: "updated" });
			expect(mockStat).toHaveBeenCalledWith(key);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(written()[key]).toMatchObject({
				commit: null,
				ref: null,
				files: [".claude/skills/my-plugin/"],
			});
			expect(ui.blocks[0]!.task).toHaveBeenCalledWith({
				subject: key,
				meta: "local",
				text: "refreshing…",
			});
			expect(settled()).toMatchObject({
				status: "done",
				subject: key,
				meta: "local",
				detail: { label: "refreshed" },
			});
		});

		it("names the recorded root, not the key, when that folder is gone", async () => {
			const key = "/Users/lee/Code/skills/go";
			const entry = makeEntry({
				commit: null,
				ref: null,
				localRoot: "/Users/lee/Code/skills",
			});
			mockStat.mockRejectedValue(new Error("ENOENT"));

			const result = await update(key, entry);

			expect(result).toEqual({ key, change: null });
			expect(settled()).toMatchObject({
				status: "failed",
				detail: "/Users/lee/Code/skills: path does not exist",
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("clone failure", () => {
		it("says so on the row, and neither nukes nor writes the manifest", async () => {
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await update("owner/repo", makeEntry());

			expect(result).toEqual({ key: "owner/repo", change: null });
			expect(settled()).toMatchObject({
				status: "failed",
				detail: { label: "clone failed", aside: "git clone failed" },
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("temp dir cleanup", () => {
		it("cleans up on success", async () => {
			cloned();
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await update("owner/repo", makeEntry());

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up on failure", async () => {
			cloned();
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await update("owner/repo", makeEntry());

			expect(result.change).toBeNull();
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("collection key (3+ parts)", () => {
		it("clones the repo and reads the entry's folder in it", async () => {
			const key = "owner/repo/go";
			const entry = makeEntry({ type: "skill", files: [".claude/skills/go/"] });
			cloned();
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			const result = await update(key, entry);

			expect(result.change).toBe("updated");
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ owner: "owner", repo: "repo" }),
			);
			expect(mockAccess).toHaveBeenCalledWith("/tmp/agntc-clone/go/SKILL.md");
		});
	});

	describe("copy-failed — remote update", () => {
		it("drops the entry, says why on the row, and puts the re-add that installs it again under Next", async () => {
			const key = "owner/repo";
			cloned();
			mockCopyBareSkill.mockRejectedValue(
				new Error("ENOSPC: no space left on device, write"),
			);

			const result = await update(key, makeEntry());

			expect(result).toEqual({ key, change: null });
			expect(settled()).toMatchObject({
				status: "failed",
				children: [
					{
						name: "repo",
						detail:
							"update failed after removing old files (ENOSPC: no space left on device, write). It is currently uninstalled.",
					},
				],
			});
			expect(ui.next).toHaveBeenCalledWith({
				subject: key,
				remedy: {
					lead: "To install it again:",
					steps: [{ command: "npx agntc add owner/repo" }],
				},
			});
			expect(written()).not.toHaveProperty(key);
		});
	});

	describe("copy-failed — local update", () => {
		it("drops the entry, its re-add naming the folder under Next", async () => {
			const key = "/Users/lee/Code/my-plugin";
			const entry = makeEntry({ commit: null, ref: null });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await update(key, entry);

			const item = ui.next.mock.calls[0]?.[0];
			expect(item!.remedy.steps).toEqual([{ command: `npx agntc add ${key}` }]);
			expect(written()).not.toHaveProperty(key);
		});
	});

	describe("aborted (derive-before-delete)", () => {
		it("leaves the install intact, says why on the row, and puts the remedy adding either skill under Next", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			cloned();
			// The recorded SKILL.md is gone and two skills now carry its name → abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));

			const result = await update(key, entry);

			expect(result).toEqual({ key, change: null });
			expect(settled()).toMatchObject({
				status: "failed",
				detail: {
					move: { from: "aaaaaaa", to: "bbbbbbb" },
					note: "not updated",
				},
				children: [
					{
						name: "repo",
						detail:
							"can't be updated: its SKILL.md is gone from repo and 2 skills are now named repo: a/repo, b/repo. The existing install is unchanged.",
					},
				],
			});
			expect(ui.next).toHaveBeenCalledExactlyOnceWith({
				subject: key,
				remedy: {
					lead: "To follow one of them:",
					steps: [
						{ command: "npx agntc remove owner/repo" },
						{
							choice: [
								"npx agntc add owner/repo/a/repo",
								"npx agntc add owner/repo/b/repo",
							],
						},
					],
				},
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("carries -g in the remedy for a global entry", async () => {
			const entry = makeEntry({ type: "skill", ref: "v1.0.0" });
			cloned();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));

			await update(
				"owner/repo",
				entry,
				{ "owner/repo": entry },
				REMOTE,
				globalScope("/home/lee"),
			);

			const item = ui.next.mock.calls[0]?.[0];
			expect(item!.remedy.steps).toEqual([
				{ command: "npx agntc remove -g owner/repo" },
				{
					choice: [
						"npx agntc add -g owner/repo/a/repo@v1.0.0",
						"npx agntc add -g owner/repo/b/repo@v1.0.0",
					],
				},
			]);
		});

		it("names the folders it would remove that the source still has, and how to update anyway", async () => {
			const key = "owner/repo/tools";
			const entry = makeEntry({
				type: "pack",
				files: [".claude/skills/a/", ".claude/skills/workflow-shared/"],
			});
			cloned();
			mockDiscover.mockResolvedValue(packAt("tools", "a"));
			mockDroppedButInSource.mockResolvedValue(["workflow-shared"]);

			await update(key, entry);

			expect(settled().children).toEqual([
				{
					name: "tools",
					detail:
						"can't be updated: it would remove workflow-shared, which is still in the source but would no longer be installed. The existing install is unchanged.",
				},
			]);
			expect(ui.next).toHaveBeenCalledWith({
				subject: key,
				remedy: {
					lead: "To update it anyway:",
					steps: [
						{ command: "npx agntc remove owner/repo/tools" },
						{ command: "npx agntc add owner/repo/tools --pack" },
					],
				},
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("a skill that moved upstream", () => {
		it("follows it, records its new path, and says so as a note, as a Message", async () => {
			const key = "owner/repo/go";
			const entry = makeEntry({ type: "skill", files: [".claude/skills/go/"] });
			cloned();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/go"));
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			await update(key, entry);

			expect(written()[key]).toMatchObject({ sourceSubpath: "skills/go" });
			expect(ui.said("info")).toEqual([
				"owner/repo/go moved from go to skills/go",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: "/tmp/agntc-clone/skills/go" }),
			);
		});
	});

	describe("a root skill that moved upstream", () => {
		it("moves the entry to the key add gives it, the old key gone in the same write, and follows it", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/repo/"],
			});
			const other = makeEntry({ files: [".claude/skills/other/"] });
			cloned();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/repo"));
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});

			const result = await update(key, entry, {
				[key]: entry,
				"owner/other": other,
			});

			expect(result).toEqual({ key: "owner/repo/repo", change: "updated" });
			expect(ui.said("info")).toEqual([
				"owner/repo moved from repo to skills/repo, now keyed owner/repo/repo",
			]);
			expect(mockWriteManifest).toHaveBeenCalledOnce();
			expect(Object.keys(written())).toEqual([
				"owner/other",
				"owner/repo/repo",
			]);
			expect(written()["owner/repo/repo"]).toMatchObject({
				sourceSubpath: "skills/repo",
			});
			expect(settled().children).toEqual([
				{ name: "repo", detail: "skill · 1 file · now keyed owner/repo/repo" },
			]);
		});
	});

	describe("a pack moving onto the key of a loose skill it takes over", () => {
		it("records the pack alone under that key, the skill dropped in the same write", async () => {
			const key = "owner/repo/tools";
			const entry = makeEntry({
				type: "pack",
				sourceSubpath: "packs/tools",
				files: [".claude/skills/a/"],
			});
			const loose = makeEntry({ files: [".claude/skills/tools/"] });
			cloned();
			mockDiscover.mockResolvedValue(packAt("packs/tools", "a", "tools"));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/a/", ".claude/skills/tools/"],
				assetCounts: { skills: 2 },
			});

			const result = await update(key, entry, {
				[key]: entry,
				"owner/repo/packs/tools": loose,
			});

			expect(result).toEqual({
				key: "owner/repo/packs/tools",
				change: "updated",
			});
			expect(mockWriteManifest).toHaveBeenCalledOnce();
			expect(Object.keys(written())).toEqual(["owner/repo/packs/tools"]);
			expect(written()["owner/repo/packs/tools"]).toMatchObject({
				type: "pack",
			});
		});
	});

	describe("an entry gone upstream", () => {
		const key = "owner/repo/go";
		const entry = makeEntry({ type: "skill", files: [".claude/skills/go/"] });
		const other = makeEntry({ files: [".claude/skills/other/"] });
		const manifest: Manifest = { [key]: entry, "owner/other": other };

		function arrangeGone(): void {
			cloned();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/other"));
		}

		it("asks whether to remove it, no by default", async () => {
			arrangeGone();
			ui.confirm.mockResolvedValue(false);

			await update(key, entry, manifest);

			expect(ui.confirm).toHaveBeenCalledExactlyOnceWith({
				message: "Remove it and its folder?",
				initialValue: false,
			});
		});

		it("keeps it on no: nothing removed, written or counted, the row saying so", async () => {
			arrangeGone();
			ui.confirm.mockResolvedValue(false);

			const result = await update(key, entry, manifest);

			expect(result).toEqual({ key, change: null });
			expect(settled()).toMatchObject({
				status: "attention",
				detail: { label: "kept" },
				children: [
					{
						name: "go",
						detail: "kept — it's gone upstream; update will ask again",
					},
				],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("removes its files and then its entry on yes, counted as removed", async () => {
			arrangeGone();
			ui.confirm.mockResolvedValue(true);

			const result = await update(key, entry, manifest);

			expect(result).toEqual({ key, change: "removed" });
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/go/"],
			);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/other": other },
			);
			expect(mockNukeManifestFiles.mock.invocationCallOrder[0]).toBeLessThan(
				mockWriteManifest.mock.invocationCallOrder[0]!,
			);
			expect(settled()).toMatchObject({
				status: "done",
				detail: { label: "removed" },
			});
		});

		it("keeps it and says why when removing it fails", async () => {
			arrangeGone();
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockRejectedValue(
				new Error("EACCES: permission denied"),
			);

			const result = await update(key, entry, manifest);

			expect(result).toEqual({ key, change: null });
			expect(settled()).toMatchObject({
				status: "failed",
				children: [{ name: "go", detail: "EACCES: permission denied" }],
			});
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("blocked (symlink-escape copy-safety)", () => {
		it("names the link on the row, offers no remedy, and leaves the install intact", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/my-skill/"],
			});
			cloned();
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);

			const result = await update(key, entry);

			expect(result).toEqual({ key, change: null });
			const row = settled();
			expect(row.status).toBe("failed");
			const detail = row.children?.[0]?.detail ?? "";
			expect(detail).toContain("evil-link");
			expect(detail.toLowerCase()).toContain("symlink");
			expect(detail).toContain("unchanged");
			expect(ui.next).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("what the check found", () => {
		it("clones and records a constrained entry at the tag its check resolved", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0", constraint: "^1.0.0" });
			const resolved = "c".repeat(40);
			cloned(resolved);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await update(
				key,
				entry,
				{ [key]: entry },
				{
					status: "constrained-update-available",
					tag: "v1.2.0",
					commit: resolved,
					latestOverall: null,
				},
			);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "v1.2.0" }),
			);
			expect(written()[key]).toMatchObject({ ref: "v1.2.0", commit: resolved });
			expect(settled().detail).toEqual({
				move: { from: "v1.0.0", to: "v1.2.0" },
			});
		});

		it("keeps a branch entry on its branch, at the clone's commit", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "dev" });
			cloned();
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await update(key, entry);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({ ref: "dev" }),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				{ [key]: entry },
				key,
				expect.objectContaining({ ref: "dev", commit: REMOTE_SHA }),
			);
		});
	});

	it("settles its row as failed, the manifest as it was, when a step throws", async () => {
		cloned();
		mockCopyBareSkill.mockRejectedValue(new Error("disk full"));
		ui.next.mockImplementation(() => {
			throw new Error("the terminal went away");
		});

		const result = await update("owner/repo", makeEntry());

		expect(result).toEqual({ key: "owner/repo", change: null });
		expect(settled()).toMatchObject({
			status: "failed",
			children: [{ name: "repo", detail: "the terminal went away" }],
		});
		expect(mockWriteManifest).not.toHaveBeenCalled();
	});

	it("warns under the row it drew when the manifest can't be written, and carries on", async () => {
		cloned();
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/my-skill/"],
		});
		mockWriteManifest.mockRejectedValue(new Error("EROFS: read-only"));

		const result = await update("owner/repo", makeEntry());

		expect(result).toEqual({ key: "owner/repo", change: null });
		expect(settled()).toMatchObject({ status: "done" });
		expect(ui.warn).toHaveBeenCalledWith(
			"couldn't record owner/repo: EROFS: read-only",
		);
	});

	it("never draws through the old surface", async () => {
		cloned();
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/my-skill/"],
		});

		await update("owner/repo", makeEntry());

		expect(ui.spinner).not.toHaveBeenCalled();
		for (const channel of Object.values(ui.log)) {
			expect(channel).not.toHaveBeenCalled();
		}
	});
});

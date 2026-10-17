import { beforeEach, describe, expect, it, vi } from "vitest";

// The clone-reinstall dependency surface shared with list-update-action is
// mocked via factory bodies authored once in ../helpers/list-action-mock-
// factories. vitest hoists `vi.mock` to the top of *this* file and needs the
// literal module path at hoist time, so each `vi.mock(path, ...)` call lives
// here; the factory contents are delegated to the shared helper.
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

// File-specific: this file mocks `access` only (no local-path `stat`).
vi.mock("node:fs/promises", () => ({
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

// File-specific: change-version fetches the remote's tags with their commits.
vi.mock("../../src/git-utils.js", () => ({
	fetchRemoteTagRefs: vi.fn(),
}));

import { executeChangeVersionAction } from "../../src/commands/list-change-version-action.js";
import { SymlinkEscapeError } from "../../src/copy-safety.js";
import { PackConflictError } from "../../src/discover.js";
import { fetchRemoteTagRefs, type TagRef } from "../../src/git-utils.js";
import type { UpdateRun } from "../../src/key-update.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import { globalScope, projectScope, type Scope } from "../../src/scope.js";
import type { Row } from "../../src/terminal/types.js";
import type { SelectPrompt } from "../../src/ui.js";
import { makeEntry } from "../helpers/factories.js";
import { SSH_REFUSAL } from "../helpers/git-mocks.js";
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
const mockFetchTagRefs = vi.mocked(fetchRemoteTagRefs);

const PROJECT = projectScope("/fake/project");
/** The entry's row the detail view asked under, which the version questions ask under too. */
const ROW: Row = { status: "subject", subject: "owner/repo", detail: "skill" };

/** Each tag as the remote lists them, oldest first, at a commit of its own. */
function tagsAt(...tags: string[]): TagRef[] {
	return tags.map((tag) => ({ tag, sha: `${tag}-sha` }));
}

/** The version select answered with `tag`, or cancelled with none. */
function picks(tag: string | null): void {
	ui.select.mockImplementation(async (prompt: SelectPrompt<unknown>) =>
		tag === null
			? null
			: ((
					prompt.options.find(
						(option) => "label" in option && option.label === tag,
					) as { value: unknown } | undefined
				)?.value ?? null),
	);
}

// Drives the bare-skill clone+copy path to success — every test that reaches the
// reinstall needs these mocks primed.
function primeSuccessfulReinstall(): void {
	mockCloneSource.mockResolvedValue({
		tempDir: "/tmp/agntc-clone",
		commit: REMOTE_SHA,
	});
	mockCopyBareSkill.mockResolvedValue({
		copiedFiles: [".claude/skills/my-skill/"],
	});
}

function change(
	key: string,
	entry: ManifestEntry,
	manifest: Manifest = { [key]: entry },
	scope: Scope = PROJECT,
) {
	const run: UpdateRun = { scope, yes: false, ui, home: "/home/me" };
	return executeChangeVersionAction({ key, entry }, ROW, manifest, run);
}

/** The rows drawn. */
function drawn(): Row[] {
	return ui.rows();
}

function settled(): Row {
	const rows = drawn();
	expect(rows).toHaveLength(1);
	return rows[0]!;
}

function written(): Manifest {
	return mockWriteManifest.mock.calls.at(-1)![1];
}

let ui: TestUi;

// File-specific defaults: a non-empty tag list (so select is reached) and the
// change confirmed.
beforeEach(() => {
	ui = testUi();
	mockFetchTagRefs.mockResolvedValue(tagsAt("v1.0.0", "v1.1.0", "v2.0.0"));
	ui.confirm.mockResolvedValue(true);
});

describe("executeChangeVersionAction", () => {
	describe("fetching the versions", () => {
		it("fetches the remote's tags under progress of its own that clears", async () => {
			picks("v1.1.0");
			primeSuccessfulReinstall();

			await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			expect(mockFetchTagRefs).toHaveBeenCalledExactlyOnceWith(
				"https://github.com/owner/repo.git",
			);
			const [block] = ui.blocks;
			expect(block!.task).toHaveBeenCalledWith({
				text: "fetching the versions of owner/repo…",
			});
			expect(block!.tasks[0]!.clear).toHaveBeenCalledOnce();
		});

		it("changes nothing and says why on the entry's row, in one line, when they can't be fetched", async () => {
			const key = "owner/repo/skill";
			mockFetchTagRefs.mockRejectedValue(new Error(SSH_REFUSAL));

			const result = await change(key, makeEntry({ ref: "v1.0.0" }));

			expect(result).toEqual({ key, change: null });
			expect(settled()).toEqual({
				status: "attention",
				subject: "owner/repo",
				meta: "v1.0.0",
				detail: {
					label: "couldn't fetch its versions — left untouched",
					aside: "git@github.com: Permission denied (publickey).",
				},
				children: [{ name: "skill" }],
			});
			expect(ui.select).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("changes nothing and says so when the remote has no tagged versions", async () => {
			mockFetchTagRefs.mockResolvedValue([]);

			const result = await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			expect(result.change).toBeNull();
			expect(settled()).toMatchObject({
				status: "attention",
				detail: { label: "no tagged versions available" },
			});
			expect(ui.select).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("the version select", () => {
		it("asks under the entry's row, newest first, flagging the current version, in a window of 15", async () => {
			mockFetchTagRefs.mockResolvedValue(
				tagsAt("v1.0.0", "v1.1.0", "v1.2.0", "v2.0.0"),
			);
			picks("v2.0.0");
			primeSuccessfulReinstall();

			await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			const asking = ui.blocks.find(
				({ select }) => select.mock.calls.length > 0,
			);
			expect(ui.block).toHaveBeenCalledWith([ROW]);
			expect(asking!.select).toHaveBeenCalledWith(ROW, {
				message: "Select a version",
				options: [
					{ value: { tag: "v2.0.0", sha: "v2.0.0-sha" }, label: "v2.0.0" },
					{ value: { tag: "v1.2.0", sha: "v1.2.0-sha" }, label: "v1.2.0" },
					{ value: { tag: "v1.1.0", sha: "v1.1.0-sha" }, label: "v1.1.0" },
					{
						value: { tag: "v1.0.0", sha: "v1.0.0-sha" },
						label: "v1.0.0",
						hint: "current",
					},
				],
				maxItems: 15,
				escape: "back",
			});
		});

		it("changes nothing and draws nothing when cancelled", async () => {
			picks(null);

			const result = await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			expect(result).toEqual({ key: "owner/repo", change: null });
			expect(drawn()).toEqual([]);
			expect(ui.confirm).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("says it's already on the version picked, as nothing to do", async () => {
			picks("v2.0.0");

			const result = await change("owner/repo", makeEntry({ ref: "v2.0.0" }));

			expect(result.change).toBeNull();
			expect(settled()).toMatchObject({
				status: "unchanged",
				detail: "already on v2.0.0",
			});
			expect(ui.confirm).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("the confirm", () => {
		it("asks under the entry's row, in the block the select asked in", async () => {
			picks("v2.0.0");
			primeSuccessfulReinstall();

			await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			const asking = ui.blocks.find(
				({ select }) => select.mock.calls.length > 0,
			);
			expect(asking!.confirm).toHaveBeenCalledWith(ROW, {
				message:
					"Change owner/repo to v2.0.0? This re-installs it at the new version.",
			});
		});

		it("changes nothing and draws nothing when declined", async () => {
			picks("v2.0.0");
			ui.confirm.mockResolvedValue(false);

			const result = await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			expect(result).toEqual({ key: "owner/repo", change: null });
			expect(drawn()).toEqual([]);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("successful version change", () => {
		it("reinstalls at the tag under the row update draws, pinning it there, counted as a version change", async () => {
			const key = "owner/repo";
			picks("v2.0.0");
			primeSuccessfulReinstall();

			const result = await change(key, makeEntry({ ref: "v1.0.0" }));

			expect(result).toEqual({ key, change: "versionChanged" });
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(written()[key]).toMatchObject({
				commit: REMOTE_SHA,
				ref: "v2.0.0",
				files: [".claude/skills/my-skill/"],
			});
			const reinstall = ui.blocks.at(-1)!;
			expect(reinstall.task).toHaveBeenCalledWith({
				subject: "owner/repo",
				meta: "v2.0.0",
				text: "updating to v2.0.0…",
			});
			expect(settled()).toEqual({
				status: "done",
				subject: "owner/repo",
				meta: "v2.0.0",
				detail: { move: { from: "v1.0.0", to: "v2.0.0" } },
				children: [{ name: "repo", detail: "skill · 1 file" }],
			});
		});

		it("downgrades: clones at an older tag", async () => {
			picks("v1.1.0");
			primeSuccessfulReinstall();

			await change("owner/repo", makeEntry({ ref: "v2.0.0" }));

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "owner",
					repo: "repo",
					ref: "v1.1.0",
				}),
			);
		});

		it("strips the constraint, the entry pinned to the tag", async () => {
			const key = "owner/repo";
			mockFetchTagRefs.mockResolvedValue(
				tagsAt("v1.0.0", "v1.2.0", "v1.3.0", "v2.0.0"),
			);
			picks("v2.0.0");
			primeSuccessfulReinstall();

			await change(key, makeEntry({ ref: "v1.2.0", constraint: "^1.0" }));

			expect(written()[key]!.ref).toBe("v2.0.0");
			expect(written()[key]).not.toHaveProperty("constraint");
		});

		it("leaves an unconstrained entry with no constraint", async () => {
			const key = "owner/repo";
			picks("v2.0.0");
			primeSuccessfulReinstall();

			await change(key, makeEntry({ ref: "v1.0.0" }));

			expect(written()[key]).not.toHaveProperty("constraint");
		});
	});

	describe("clone failure", () => {
		it("says so on the row, and neither nukes nor writes", async () => {
			picks("v1.1.0");
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			expect(result.change).toBeNull();
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
			picks("v1.1.0");
			primeSuccessfulReinstall();

			await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up on failure", async () => {
			picks("v1.1.0");
			primeSuccessfulReinstall();
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

			expect(result.change).toBeNull();
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("a root skill that moved at the chosen version", () => {
		it("moves the entry to the key add gives it, the old key gone in the same write", async () => {
			const key = "owner/repo";
			picks("v2.0.0");
			primeSuccessfulReinstall();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/repo"));

			const result = await change(
				key,
				makeEntry({ ref: "v1.0.0", files: [".claude/skills/repo/"] }),
			);

			expect(result).toEqual({
				key: "owner/repo/repo",
				change: "versionChanged",
			});
			expect(mockWriteManifest).toHaveBeenCalledOnce();
			expect(Object.keys(written())).toEqual(["owner/repo/repo"]);
			expect(written()["owner/repo/repo"]).toMatchObject({
				ref: "v2.0.0",
				sourceSubpath: "skills/repo",
			});
		});
	});

	describe("a pack moving onto the key of a loose skill it takes over", () => {
		it("records the pack alone under that key, the skill dropped in the same write", async () => {
			const key = "owner/repo/tools";
			const entry = makeEntry({
				type: "pack",
				ref: "v1.0.0",
				sourceSubpath: "packs/tools",
				files: [".claude/skills/a/"],
			});
			const loose = makeEntry({
				ref: "v1.0.0",
				files: [".claude/skills/tools/"],
			});
			picks("v2.0.0");
			primeSuccessfulReinstall();
			mockDiscover.mockResolvedValue(packAt("packs/tools", "a", "tools"));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/a/", ".claude/skills/tools/"],
				assetCounts: { skills: 2 },
			});

			const result = await change(key, entry, {
				[key]: entry,
				"owner/repo/packs/tools": loose,
			});

			expect(result).toEqual({
				key: "owner/repo/packs/tools",
				change: "versionChanged",
			});
			expect(mockWriteManifest).toHaveBeenCalledOnce();
			expect(Object.keys(written())).toEqual(["owner/repo/packs/tools"]);
			expect(written()["owner/repo/packs/tools"]).toMatchObject({
				type: "pack",
				ref: "v2.0.0",
			});
		});
	});

	describe("a key another entry holds at the chosen version", () => {
		it("tells the user to free it and change the version again, as an update wouldn't install that version", async () => {
			const key = "owner/repo/packs/foo";
			const entry = makeEntry({ type: "pack", ref: "v1.0.0" });
			const other = makeEntry({ type: "pack", files: [".claude/skills/x/"] });
			picks("v2.0.0");
			primeSuccessfulReinstall();
			mockDiscover.mockRejectedValue(
				new PackConflictError("single", "single-skill"),
			);

			const result = await change(key, entry, {
				[key]: entry,
				"owner/repo/foo": other,
			});

			expect(result.change).toBeNull();
			expect(settled().children).toEqual([
				{
					name: "foo",
					detail:
						"can't be updated: it would move to owner/repo/foo, which is already installed. The existing install is unchanged.",
				},
			]);
			expect(ui.next).toHaveBeenCalledExactlyOnceWith({
				subject: key,
				remedy: {
					lead: "To replace that entry with it:",
					steps: [
						{ command: "npx agntc remove owner/repo/foo" },
						{ words: "change it to v2.0.0 again" },
					],
				},
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("copy-failed", () => {
		it("drops the entry, its recovery re-adding the tag picked", async () => {
			const key = "owner/repo";
			picks("v1.1.0");
			primeSuccessfulReinstall();
			mockCopyBareSkill.mockRejectedValue(
				new Error("ENOSPC: no space left on device, write"),
			);

			const result = await change(key, makeEntry({ ref: "v1.0.0" }));

			expect(result.change).toBeNull();
			expect(settled().children).toEqual([
				{
					name: "repo",
					detail:
						"update failed after removing old files (ENOSPC: no space left on device, write). It is currently uninstalled.",
				},
			]);
			expect(ui.next).toHaveBeenCalledWith({
				subject: key,
				remedy: {
					lead: "To install it again:",
					steps: [{ command: "npx agntc add owner/repo@v1.1.0" }],
				},
			});
			expect(written()).not.toHaveProperty(key);
		});

		it("re-adds the tag picked, not the constraint the entry had", async () => {
			picks("v2.0.0");
			primeSuccessfulReinstall();
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await change(
				"owner/repo",
				makeEntry({ ref: "v1.0.0", constraint: "^1.0.0" }),
			);

			const item = ui.next.mock.calls[0]?.[0];
			expect(item!.remedy.steps).toEqual([
				{ command: "npx agntc add owner/repo@v2.0.0" },
			]);
		});
	});

	describe("a removal that fails part way", () => {
		it("says why, copying nothing and keeping the entry", async () => {
			const key = "owner/repo";
			picks("v1.1.0");
			primeSuccessfulReinstall();
			mockNukeManifestFiles.mockRejectedValue(new Error("EACCES"));

			const result = await change(key, makeEntry({ ref: "v1.0.0" }));

			expect(result).toEqual({ key, change: null });
			expect(settled().children).toEqual([
				{ name: "repo", detail: "couldn't remove its old files: EACCES" },
			]);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("a local source folder that's gone", () => {
		it("names the recorded root, not the key", async () => {
			const key = "/Users/lee/Code/skills/go";
			mockFetchTagRefs.mockResolvedValue(tagsAt("v1.0.0", "v1.1.0"));
			picks("v1.1.0");

			const result = await change(
				key,
				makeEntry({
					commit: null,
					ref: "v1.0.0",
					localRoot: "/Users/lee/Code/skills",
				}),
			);

			expect(result).toEqual({ key, change: null });
			expect(settled()).toMatchObject({
				status: "failed",
				children: [
					{ name: "go", detail: "/Users/lee/Code/skills: path does not exist" },
				],
			});
		});
	});

	describe("aborted (derive-before-delete)", () => {
		it("leaves the install intact, its remedy adding either skill at the chosen version", async () => {
			const key = "owner/repo";
			picks("v1.1.0");
			primeSuccessfulReinstall();
			// The recorded SKILL.md is gone and two skills now carry its name → abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));

			const result = await change(
				key,
				makeEntry({
					type: "skill",
					ref: "v1.0.0",
					files: [".claude/skills/my-skill/"],
				}),
			);

			expect(result.change).toBeNull();
			expect(settled()).toMatchObject({
				status: "failed",
				detail: { move: { from: "v1.0.0", to: "v1.1.0" }, note: "not updated" },
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
								"npx agntc add owner/repo/a/repo@v1.1.0",
								"npx agntc add owner/repo/b/repo@v1.1.0",
							],
						},
					],
				},
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("carries -g in the remedy for a global entry", async () => {
			picks("v1.1.0");
			primeSuccessfulReinstall();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));
			const entry = makeEntry({ type: "skill", ref: "v1.0.0" });

			await change(
				"owner/repo",
				entry,
				{ "owner/repo": entry },
				globalScope("/home/lee"),
			);

			const item = ui.next.mock.calls[0]?.[0];
			expect(item!.remedy.steps).toEqual([
				{ command: "npx agntc remove -g owner/repo" },
				{
					choice: [
						"npx agntc add -g owner/repo/a/repo@v1.1.0",
						"npx agntc add -g owner/repo/b/repo@v1.1.0",
					],
				},
			]);
		});

		it("names the folders it would remove that the source still has, and re-adds at the chosen version", async () => {
			const key = "owner/repo/tools";
			picks("v2.0.0");
			primeSuccessfulReinstall();
			mockDiscover.mockResolvedValue(packAt("tools", "a"));
			mockDroppedButInSource.mockResolvedValue(["workflow-shared"]);

			await change(
				key,
				makeEntry({
					type: "pack",
					ref: "v1.0.0",
					files: [".claude/skills/a/", ".claude/skills/workflow-shared/"],
				}),
			);

			expect(ui.next).toHaveBeenCalledWith({
				subject: key,
				remedy: {
					lead: "To update it anyway:",
					steps: [
						{ command: "npx agntc remove owner/repo/tools" },
						{ command: "npx agntc add owner/repo/tools@v2.0.0 --pack" },
					],
				},
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("an entry gone upstream at the chosen version", () => {
		const key = "owner/repo/go";
		const entry = makeEntry({
			type: "skill",
			ref: "v1.0.0",
			files: [".claude/skills/go/"],
		});
		const other = makeEntry({ files: [".claude/skills/other/"] });
		const manifest: Manifest = { [key]: entry, "owner/other": other };

		function arrangeGone(removeIt: boolean): void {
			picks("v2.0.0");
			primeSuccessfulReinstall();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/other"));
			// The first confirm is the version change itself.
			ui.confirm.mockResolvedValueOnce(true).mockResolvedValueOnce(removeIt);
		}

		it("asks whether to remove it, no by default, after the change is confirmed", async () => {
			arrangeGone(false);

			await change(key, entry, manifest);

			expect(ui.confirm).toHaveBeenCalledTimes(2);
			expect(ui.confirm).toHaveBeenLastCalledWith({
				message: "Remove it and its folder?",
				initialValue: false,
			});
		});

		it("keeps it on no: nothing removed, written or counted", async () => {
			arrangeGone(false);

			const result = await change(key, entry, manifest);

			expect(result).toEqual({ key, change: null });
			expect(settled().children).toEqual([
				{
					name: "go",
					detail: "kept — it's gone upstream; update will ask again",
				},
			]);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("removes its files and its entry on yes, counted as removed", async () => {
			arrangeGone(true);

			const result = await change(key, entry, manifest);

			expect(result).toEqual({ key, change: "removed" });
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/go/"],
			);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/other": other },
			);
		});

		it("keeps it and says why, without throwing, when removing it fails", async () => {
			arrangeGone(true);
			mockNukeManifestFiles.mockRejectedValue(
				new Error("EACCES: permission denied"),
			);

			const result = await change(key, entry, manifest);

			expect(result).toEqual({ key, change: null });
			expect(settled()).toMatchObject({ status: "failed" });
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("blocked (symlink-escape copy-safety)", () => {
		it("names the link on the row, offers no remedy, and leaves the install intact", async () => {
			picks("v1.1.0");
			primeSuccessfulReinstall();
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);

			const result = await change(
				"owner/repo",
				makeEntry({
					type: "skill",
					ref: "v1.0.0",
					files: [".claude/skills/my-skill/"],
				}),
			);

			expect(result.change).toBeNull();
			const detail = settled().children?.[0]?.detail ?? "";
			expect(detail).toContain("evil-link");
			expect(detail.toLowerCase()).toContain("symlink");
			expect(detail).toContain("unchanged");
			expect(ui.next).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	it("never draws through the old surface", async () => {
		picks("v1.1.0");
		primeSuccessfulReinstall();

		await change("owner/repo", makeEntry({ ref: "v1.0.0" }));

		expect(ui.spinner).not.toHaveBeenCalled();
		for (const channel of Object.values(ui.log)) {
			expect(channel).not.toHaveBeenCalled();
		}
		expect(mockAddEntry).toHaveBeenCalled();
	});
});

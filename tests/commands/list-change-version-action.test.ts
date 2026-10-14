import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../src/manifest.js";

// The clone-reinstall dependency surface shared with list-update-action is
// mocked via factory bodies authored once in ../helpers/list-action-mock-
// factories. vitest hoists `vi.mock` to the top of *this* file and needs the
// literal module path at hoist time, so each `vi.mock(path, ...)` call lives
// here; the factory contents are delegated to the shared helper.
vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack({ select: vi.fn(), isCancel: vi.fn(), confirm: vi.fn() });
});

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

// File-specific: change-version always fetches the full remote tag list.
vi.mock("../../src/git-utils.js", () => ({
	fetchRemoteTags: vi.fn(),
}));

import * as p from "@clack/prompts";
import { executeChangeVersionAction } from "../../src/commands/list-change-version-action.js";
import { SymlinkEscapeError } from "../../src/copy-safety.js";
import { PackConflictError } from "../../src/discover.js";
import { fetchRemoteTags } from "../../src/git-utils.js";
import { globalScope, projectScope } from "../../src/scope.js";
import { interactiveUi } from "../../src/ui.js";
import { makeEntry } from "../helpers/factories.js";
import { SSH_REFUSAL } from "../helpers/git-mocks.js";
import {
	looseSkillsAt,
	packAt,
	REMOTE_SHA,
	setupListActionMocks,
} from "../helpers/list-action-mocks.js";

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
// File-specific handles for the change-version flow.
const mockFetchRemoteTags = vi.mocked(fetchRemoteTags);
const mockSelect = vi.mocked(p.select);
const mockIsCancel = vi.mocked(p.isCancel);
const mockConfirm = vi.mocked(p.confirm);

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

// File-specific defaults: a non-empty tag list (so select is reached), no
// cancellation, and the change confirmed.
beforeEach(() => {
	mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0", "v2.0.0"]);
	mockIsCancel.mockReturnValue(false);
	mockConfirm.mockResolvedValue(true);
});

describe("executeChangeVersionAction", () => {
	describe("tag presentation", () => {
		it("presents all tags newest-first, flagging the current version", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			// fetchRemoteTags returns oldest→newest; the action reverses for display.
			mockFetchRemoteTags.mockResolvedValue([
				"v1.0.0",
				"v1.1.0",
				"v1.2.0",
				"v2.0.0",
			]);
			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockSelect).toHaveBeenCalledWith(
				expect.objectContaining({
					options: [
						{ value: "v2.0.0", label: "v2.0.0" },
						{ value: "v1.2.0", label: "v1.2.0" },
						{ value: "v1.1.0", label: "v1.1.0" },
						{ value: "v1.0.0", label: "v1.0.0", hint: "current" },
					],
				}),
			);
		});

		it("caps the visible list with maxItems so large tag lists scroll", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockSelect).toHaveBeenCalledWith(
				expect.objectContaining({ maxItems: 15 }),
			);
		});

		it("returns changed: false when the remote has no tagged versions", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockFetchRemoteTags.mockResolvedValue([]);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe("No tagged versions available");
			expect(mockSelect).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("always fetches the full remote tag list", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			primeSuccessfulReinstall();

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockFetchRemoteTags).toHaveBeenCalledTimes(1);
		});
	});

	describe("cancel", () => {
		it("returns changed: false when user cancels the version select", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			const cancelSymbol = Symbol("cancel");
			mockSelect.mockResolvedValue(cancelSymbol);
			mockIsCancel.mockReturnValue(true);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe("Cancelled");
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("returns changed: false (and does not clone) when the user declines the confirm", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v2.0.0");
			mockConfirm.mockResolvedValue(false); // user picks a version, then says no

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockConfirm).toHaveBeenCalled();
			expect(result.changed).toBe(false);
			expect(result.message).toBe("Cancelled");
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("returns changed: false when the user picks the version already installed", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v2.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v2.0.0");

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe("Already on this version");
			expect(mockConfirm).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("versions that can't be fetched", () => {
		it("changes nothing and says why in one line", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const spin = { start: vi.fn(), stop: vi.fn(), message: vi.fn() };
			vi.mocked(p.spinner).mockReturnValueOnce(spin);
			mockFetchRemoteTags.mockRejectedValue(new Error(SSH_REFUSAL));

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				changed: false,
				key,
				message:
					"owner/repo: couldn't fetch its versions (git@github.com: Permission denied (publickey).) — left untouched",
				notes: [],
			});
			expect(spin.stop).toHaveBeenCalledWith(
				"Couldn't fetch available versions",
				2,
			);
			expect(mockSelect).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("successful version change", () => {
		it("clones at selected tag, nukes, copies, writes manifest, returns changed: true", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.commit).toBe(REMOTE_SHA);
			expect(result.newEntry!.ref).toBe("v2.0.0");
			expect(result.newEntry!.files).toEqual([".claude/skills/my-skill/"]);
			expect(result.message).toBe("Changed owner/repo to v2.0.0");
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("downgrades: clones with an older selected tag ref", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v2.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			primeSuccessfulReinstall();

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "owner",
					repo: "repo",
					ref: "v1.1.0",
				}),
			);
		});
	});

	describe("clone failure", () => {
		it("returns changed: false, does not nuke", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("git clone failed");
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("temp dir cleanup", () => {
		it("cleans up on success", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			primeSuccessfulReinstall();

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up on failure", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("manifest updated with new ref", () => {
		it("writes manifest with new ref, not old ref", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			primeSuccessfulReinstall();

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockAddEntry).toHaveBeenCalledWith(
				manifest,
				key,
				expect.objectContaining({
					ref: "v1.1.0",
					commit: REMOTE_SHA,
				}),
			);
		});
	});

	describe("a root skill that moved at the chosen version", () => {
		it("moves the entry to the key add gives it, the old key gone in the same write", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				ref: "v1.0.0",
				files: [".claude/skills/repo/"],
			});

			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/repo"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toMatchObject({
				changed: true,
				key: "owner/repo/repo",
				message: "Changed owner/repo/repo to v2.0.0",
				newEntry: { ref: "v2.0.0", sourceSubpath: "skills/repo" },
			});
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/repo/repo": result.newEntry },
			);
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

			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();
			mockDiscover.mockResolvedValue(packAt("packs/tools", "a", "tools"));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/a/", ".claude/skills/tools/"],
				assetCounts: { skills: 2 },
			});

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry, "owner/repo/packs/tools": loose },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toMatchObject({
				changed: true,
				key: "owner/repo/packs/tools",
				newEntry: { type: "pack", ref: "v2.0.0" },
			});
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/repo/packs/tools": result.newEntry },
			);
		});
	});

	describe("a key another entry holds at the chosen version", () => {
		it("tells the user to free it and change the version again, as an update wouldn't install that version", async () => {
			const key = "owner/repo/packs/foo";
			const entry = makeEntry({ type: "pack", ref: "v1.0.0" });
			const other = makeEntry({ type: "pack", files: [".claude/skills/x/"] });

			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();
			mockDiscover.mockRejectedValue(
				new PackConflictError("single", "single-skill"),
			);

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry, "owner/repo/foo": other },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				changed: false,
				key,
				message:
					"owner/repo/packs/foo can't be updated: it would move to owner/repo/foo, which is already installed. The existing install is unchanged. To replace that entry with it: npx agntc remove owner/repo/foo then change it to v2.0.0 again",
				notes: [],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("copy-failed", () => {
		it("removes entry from manifest and returns changed: false with recovery hint", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("npx agntc add owner/repo");
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});
	});

	describe("copy-failed on an entry with a constraint", () => {
		it("tells the user to re-add the tag they picked, not the constraint the entry had", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0", constraint: "^1.0.0" });

			mockSelect.mockResolvedValue("v2.0.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain(
				"Run `npx agntc add owner/repo@v2.0.0` to install it again.",
			);
		});
	});

	describe("a removal that fails part way", () => {
		it("returns changed: false with the reason, copying nothing and keeping the entry", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });

			mockSelect.mockResolvedValue("v1.1.0");
			primeSuccessfulReinstall();
			mockNukeManifestFiles.mockRejectedValue(new Error("EACCES"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				changed: false,
				key,
				message: "couldn't remove its old files: EACCES",
				notes: [],
			});
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("a local source folder that's gone", () => {
		it("names the recorded root, not the key", async () => {
			const key = "/Users/lee/Code/skills/go";
			const entry = makeEntry({
				commit: null,
				ref: "v1.0.0",
				localRoot: "/Users/lee/Code/skills",
			});
			mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.1.0"]);
			mockSelect.mockResolvedValue("v1.1.0");
			mockConfirm.mockResolvedValue(true);

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				changed: false,
				key,
				message: "/Users/lee/Code/skills: path does not exist",
				notes: [],
			});
		});
	});

	describe("aborted (derive-before-delete)", () => {
		it("renders the canonical buildAbortMessage with recordedType + a remove+add remedy at the chosen version, leaves install intact", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				type: "skill",
				ref: "v1.0.0",
				files: [".claude/skills/my-skill/"],
			});
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// The recorded SKILL.md is gone and two skills now carry its name → abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe(
				"owner/repo was installed as a skill and can't be updated (its SKILL.md is gone from repo and 2 skills are now named repo: a/repo, b/repo). The existing install is unchanged. To migrate: npx agntc remove owner/repo then npx agntc add owner/repo@v1.1.0",
			);
			expect(result.newEntry).toBeUndefined();
			// Install intact: no nuke, no manifest write.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("carries -g in the remedy for a global entry", async () => {
			const entry = makeEntry({ type: "skill", ref: "v1.0.0" });
			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("a/repo", "b/repo"));

			const result = await executeChangeVersionAction(
				"owner/repo",
				entry,
				{ "owner/repo": entry },
				globalScope("/home/lee"),
				interactiveUi,
			);

			expect(result.message).toContain(
				"To migrate: npx agntc remove -g owner/repo then npx agntc add -g owner/repo",
			);
		});

		it("names the folders it would remove that the source still has, and re-adds at the chosen version", async () => {
			const key = "owner/repo/tools";
			const entry = makeEntry({
				type: "pack",
				ref: "v1.0.0",
				files: [".claude/skills/a/", ".claude/skills/workflow-shared/"],
			});
			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();
			mockDiscover.mockResolvedValue(packAt("tools", "a"));
			mockDroppedButInSource.mockResolvedValue(["workflow-shared"]);

			const result = await executeChangeVersionAction(
				key,
				entry,
				{ [key]: entry },
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toMatchObject({
				changed: false,
				message:
					"owner/repo/tools can't be updated: it would remove workflow-shared, which is still in the source but would no longer be installed. The existing install is unchanged. To update it anyway: npx agntc remove owner/repo/tools then npx agntc add owner/repo/tools@v2.0.0 --pack",
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
			mockSelect.mockResolvedValue("v2.0.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			mockDiscover.mockResolvedValue(looseSkillsAt("skills/other"));
			// The first confirm is the version change itself.
			mockConfirm.mockResolvedValueOnce(true).mockResolvedValueOnce(removeIt);
		}

		it("asks whether to remove it, no by default, after the change is confirmed", async () => {
			arrangeGone(false);

			await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(mockConfirm).toHaveBeenCalledTimes(2);
			expect(mockConfirm).toHaveBeenLastCalledWith({
				message: "owner/repo/go is gone upstream — remove it?",
				initialValue: false,
			});
		});

		it("keeps it on no: nothing removed or written", async () => {
			arrangeGone(false);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				changed: true,
				key,
				message:
					"Kept owner/repo/go — it's gone upstream; update will ask again",
				notes: [],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("removes its files and its entry on yes", async () => {
			arrangeGone(true);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				changed: true,
				key,
				message: "Removed owner/repo/go — it's gone upstream",
				notes: [],
			});
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/go/"],
			);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/other": other },
			);
		});

		it("keeps it and reports the failure, without throwing, when removing it fails", async () => {
			arrangeGone(true);
			mockNukeManifestFiles.mockRejectedValue(
				new Error("EACCES: permission denied"),
			);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result).toEqual({
				changed: false,
				key,
				message:
					"Couldn't remove owner/repo/go: EACCES: permission denied; it stays recorded",
				notes: [],
			});
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("blocked (symlink-escape copy-safety)", () => {
		it("renders the copy-safety message (symlink escape, no type-migration remedy), leaves install intact", async () => {
			const key = "owner/repo";
			const entry = makeEntry({
				type: "skill",
				ref: "v1.0.0",
				files: [".claude/skills/my-skill/"],
			});
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("evil-link");
			expect(result.message.toLowerCase()).toContain("symlink");
			expect(result.message).toContain("unchanged");
			expect(result.message).not.toContain("no longer supports that type");
			expect(result.message).not.toContain("npx agntc remove");
			expect(result.newEntry).toBeUndefined();
			// Install intact: no nuke, no manifest write.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("constraint handling", () => {
		it("strips the constraint from the manifest entry when changing version", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.2.0", constraint: "^1.0" });
			const manifest: Manifest = { [key]: entry };

			mockFetchRemoteTags.mockResolvedValue([
				"v1.0.0",
				"v1.2.0",
				"v1.3.0",
				"v2.0.0",
			]);
			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.ref).toBe("v2.0.0");
			expect(result.newEntry!.constraint).toBeUndefined();
			expect(result.message).toBe("Changed owner/repo to v2.0.0");
		});

		it("leaves a non-constrained entry with no constraint field after change-version", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v2.0.0");
			primeSuccessfulReinstall();

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				projectScope("/fake/project"),
				interactiveUi,
			);

			expect(result.changed).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.constraint).toBeUndefined();
		});
	});
});

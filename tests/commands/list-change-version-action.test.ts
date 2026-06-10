import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../src/manifest.js";
import type { DetectedType } from "../../src/type-detection.js";

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

vi.mock("../../src/config.js", async () => {
	const { mockConfigModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockConfigModule();
});

vi.mock("../../src/type-detection.js", async (importOriginal) => {
	const { mockTypeDetectionModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockTypeDetectionModule(
		importOriginal<typeof import("../../src/type-detection.js")>,
	);
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

vi.mock("../../src/copy-plugin-assets.js", async () => {
	const { mockCopyPluginAssetsModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyPluginAssetsModule();
});

vi.mock("../../src/copy-bare-skill.js", async () => {
	const { mockCopyBareSkillModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockCopyBareSkillModule();
});

vi.mock("../../src/drivers/registry.js", async () => {
	const { mockDriversRegistryModule } = await import(
		"../helpers/list-action-mock-factories.js"
	);
	return mockDriversRegistryModule();
});

// File-specific: change-version always fetches the full remote tag list.
vi.mock("../../src/git-utils.js", () => ({
	fetchRemoteTags: vi.fn(),
}));

import * as p from "@clack/prompts";
import { executeChangeVersionAction } from "../../src/commands/list-change-version-action.js";
import { SymlinkEscapeError } from "../../src/copy-safety.js";
import { fetchRemoteTags } from "../../src/git-utils.js";
import { makeEntry } from "../helpers/factories.js";
import {
	REMOTE_SHA,
	setupListActionMocks,
} from "../helpers/list-action-mocks.js";

const mocks = setupListActionMocks();
const mockWriteManifest = mocks.writeManifest;
const mockAddEntry = mocks.addEntry;
const mockCloneSource = mocks.cloneSource;
const mockCleanupTempDir = mocks.cleanupTempDir;
const mockReadConfig = mocks.readConfig;
const mockDetectType = mocks.detectType;
const mockNukeManifestFiles = mocks.nukeManifestFiles;
const mockCopyBareSkill = mocks.copyBareSkill;
const mockAccess = mocks.access;
const mockScanForEscapingSymlinks = mocks.scanForEscapingSymlinks;
const mockLog = vi.mocked(p.log);
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
	mockReadConfig.mockResolvedValue({ agents: ["claude"] });
	mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
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

			await executeChangeVersionAction(key, entry, manifest, "/fake/project");

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

			await executeChangeVersionAction(key, entry, manifest, "/fake/project");

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
				"/fake/project",
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

			await executeChangeVersionAction(key, entry, manifest, "/fake/project");

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
				"/fake/project",
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
				"/fake/project",
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
				"/fake/project",
			);

			expect(result.changed).toBe(false);
			expect(result.message).toBe("Already on this version");
			expect(mockConfirm).not.toHaveBeenCalled();
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
				"/fake/project",
			);

			expect(result.changed).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.commit).toBe(REMOTE_SHA);
			expect(result.newEntry!.ref).toBe("v2.0.0");
			expect(result.newEntry!.agents).toEqual(["claude"]);
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

			await executeChangeVersionAction(key, entry, manifest, "/fake/project");

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
				"/fake/project",
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("git clone failed");
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("all agents dropped", () => {
		it("returns changed: false, does not nuke", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0", agents: ["codex"] });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// New version only supports claude, entry has codex
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain(
				"no longer supports any of your installed agents",
			);
			expect(result.newEntry).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("agent drop warning", () => {
		it("emits warning for partial drop", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0", agents: ["claude", "codex"] });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			primeSuccessfulReinstall();

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.changed).toBe(true);
			expect(mockLog.warn).toHaveBeenCalledWith(
				expect.stringContaining("codex"),
			);
		});
	});

	describe("temp dir cleanup", () => {
		it("cleans up on success", async () => {
			const key = "owner/repo";
			const entry = makeEntry({ ref: "v1.0.0" });
			const manifest: Manifest = { [key]: entry };

			mockSelect.mockResolvedValue("v1.1.0");
			primeSuccessfulReinstall();

			await executeChangeVersionAction(key, entry, manifest, "/fake/project");

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
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

			await executeChangeVersionAction(key, entry, manifest, "/fake/project");

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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockDetectType.mockResolvedValue({ type: "bare-skill" } as DetectedType);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("npx agntc update owner/repo");
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});
	});

	describe("aborted (derive-before-delete)", () => {
		it("renders the canonical buildAbortMessage with recordedType + remove+add remedy, leaves install intact", async () => {
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			// Recorded skill's SKILL.md is gone in the re-clone → abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
			);

			expect(result.changed).toBe(false);
			expect(result.message).toContain("installed as a skill");
			expect(result.message).toContain("unchanged");
			expect(result.message).toContain("npx agntc remove owner/repo");
			expect(result.message).toContain("npx agntc add owner/repo");
			expect(result.newEntry).toBeUndefined();
			// Install intact: no nuke, no manifest write.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
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
			mockReadConfig.mockResolvedValue({ agents: ["claude"] });
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);

			const result = await executeChangeVersionAction(
				key,
				entry,
				manifest,
				"/fake/project",
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
				"/fake/project",
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
				"/fake/project",
			);

			expect(result.changed).toBe(true);
			expect(result.newEntry).toBeDefined();
			expect(result.newEntry!.constraint).toBeUndefined();
		});
	});
});

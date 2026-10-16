import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Manifest } from "../../src/manifest.js";
import { makeEntry } from "../helpers/factories.js";

vi.mock("../../src/manifest.js", async (importOriginal) => ({
	removeEntry: (await importOriginal<typeof import("../../src/manifest.js")>())
		.removeEntry,
	writeManifest: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

import { executeRemoveAction } from "../../src/commands/list-remove-action.js";
import { writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { globalScope, projectScope } from "../../src/scope.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
let ui: TestUi;

beforeEach(() => {
	vi.clearAllMocks();
	ui = testUi();
	mockWriteManifest.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
});

describe("executeRemoveAction", () => {
	describe("shows file list before confirmation", () => {
		it("displays each file with indent via ui.log.message", async () => {
			const entry = makeEntry({
				files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
			});
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(false);

			await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(ui.log.message).toHaveBeenCalledWith("  .claude/skills/my-skill/");
			expect(ui.log.message).toHaveBeenCalledWith(
				"  .claude/agents/executor.md",
			);
		});
	});

	describe("confirmation prompt", () => {
		it("includes key name and file count", async () => {
			const entry = makeEntry({
				files: [".claude/skills/a/", ".claude/skills/b/", ".claude/hooks/c.sh"],
			});
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(false);

			await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(ui.confirm).toHaveBeenCalledWith({
				message: "Remove owner/repo? 3 file(s) will be deleted.",
			});
		});
	});

	describe("confirmed removal", () => {
		it("removes a global entry's files and record below the home directory", async () => {
			const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
			ui.confirm.mockResolvedValue(true);

			await executeRemoveAction(
				"owner/repo",
				entry,
				{ "owner/repo": entry },
				globalScope("/home/lee"),
				ui,
			);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/home/lee", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/home/lee", {});
		});

		it("nukes files, removes entry from manifest, writes manifest, returns removed true", async () => {
			const entry = makeEntry({
				files: [".claude/skills/my-skill/"],
			});
			const otherEntry = makeEntry({
				files: [".claude/skills/other/"],
			});
			const manifest: Manifest = {
				"owner/repo": entry,
				"other/plugin": otherEntry,
			};
			ui.confirm.mockResolvedValue(true);

			const result = await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(result.removed).toBe(true);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"other/plugin": otherEntry,
			});
		});

		it("succeeds when nuke skips missing files (ENOENT tolerance)", async () => {
			const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [],
				skipped: [".claude/skills/my-skill/"],
			});

			const result = await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(result.removed).toBe(true);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});

		it("keeps the entry recorded and says why when removing its files fails", async () => {
			const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockRejectedValue(
				new Error("EACCES: permission denied"),
			);

			const result = await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(result).toEqual({
				removed: false,
				message:
					"Couldn't remove owner/repo: EACCES: permission denied; it stays recorded",
			});
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("declined removal", () => {
		it("returns removed false, does not nuke, does not write manifest", async () => {
			const entry = makeEntry();
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(false);

			const result = await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(result.removed).toBe(false);
			expect(result.message).toBe("Cancelled");
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("cancel", () => {
		it("returns removed false, does not nuke", async () => {
			const entry = makeEntry();
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(false);

			const result = await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(result.removed).toBe(false);
			expect(result.message).toBe("Cancelled");
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("manifest preserves other entries after removal", () => {
		it("keeps unrelated entries in manifest", async () => {
			const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
			const otherEntry = makeEntry({ files: [".claude/skills/other/"] });
			const thirdEntry = makeEntry({ files: [".claude/skills/third/"] });
			const manifest: Manifest = {
				"owner/repo": entry,
				"other/plugin": otherEntry,
				"third/plugin": thirdEntry,
			};
			ui.confirm.mockResolvedValue(true);

			await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"other/plugin": otherEntry,
				"third/plugin": thirdEntry,
			});
		});
	});

	describe("last plugin removal", () => {
		it("writes empty manifest when last plugin is removed", async () => {
			const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(true);

			await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});
	});

	describe("message on success", () => {
		it("includes key in message", async () => {
			const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(true);

			const result = await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(result.message).toBe("Removed owner/repo");
		});
	});

	describe("message on decline", () => {
		it("says Cancelled", async () => {
			const entry = makeEntry();
			const manifest: Manifest = { "owner/repo": entry };
			ui.confirm.mockResolvedValue(false);

			const result = await executeRemoveAction(
				"owner/repo",
				entry,
				manifest,
				projectScope("/fake/project"),
				ui,
			);

			expect(result.message).toBe("Cancelled");
		});
	});
});

import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { Manifest } from "../../src/manifest.js";

vi.mock("../../src/manifest.js", async (importOriginal) => ({
	removeEntry: (await importOriginal<typeof import("../../src/manifest.js")>())
		.removeEntry,
	readManifest: vi.fn(),
	readManifestOrExit: vi.fn(),
	writeManifest: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

import { removeCommand, runRemove } from "../../src/commands/remove.js";
import { readManifestOrExit, writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import {
	removalRow,
	removedRow,
	removeFailedRow,
} from "../../src/remove-render.js";
import { makeEntry } from "../helpers/factories.js";
import { runMachine } from "../helpers/machine.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const mockReadManifestOrExit = vi.mocked(readManifestOrExit);
const mockWriteManifest = vi.mocked(writeManifest);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const ENTRY = { one: "entry", many: "entries" };
let ui: TestUi;

beforeEach(() => {
	vi.clearAllMocks();
	ui = testUi();
	vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockWriteManifest.mockResolvedValue(undefined);
});

describe("remove command", () => {
	describe("empty manifest", () => {
		it("displays 'No skills or packs installed.' and exits 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await expect(runRemove("owner/repo", {}, ui)).resolves.toBeUndefined();

			expect(ui.rows()).toEqual([
				{ status: "unchanged", subject: "No skills or packs installed." },
			]);
			expect(ui.next).not.toHaveBeenCalled();
			expect(ui.close).toHaveBeenCalledExactlyOnceWith({
				command: "remove",
				counts: {},
			});
		});
	});

	describe("exact key match — standalone plugin", () => {
		it("removes a standalone plugin", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
				".claude/agents/executor.md",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
			expect(ui.rows()).toEqual([
				removedRow("owner/repo", "skill", [
					".claude/skills/my-skill/",
					".claude/agents/executor.md",
				]),
			]);
			expect(ui.close).toHaveBeenCalledExactlyOnceWith({
				command: "remove",
				counts: { removed: 1, failed: 0 },
			});
		});
	});

	describe("exact key match — specific collection plugin", () => {
		it("removes a specific collection plugin", async () => {
			const manifest: Manifest = {
				"owner/repo/go": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				}),
				"owner/repo/python": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/go/"],
				skipped: [],
			});

			await runRemove("owner/repo/go", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"owner/repo/python": manifest["owner/repo/python"],
			});
		});
	});

	describe("legacy multi-agent entry", () => {
		it("deletes every recorded file, whatever its root", async () => {
			const legacyFiles = [
				".claude/skills/go/",
				".agents/skills/go/",
				".cursor/skills/go/",
			];
			const manifest: Manifest = {
				"owner/repo/go": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: legacyFiles,
					cloneUrl: null,
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);

			await runRemove("owner/repo/go", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				legacyFiles,
			);
			const folders = [
				{ label: ".claude/skills/", value: ["go"], noun: "folder" },
				{ label: ".agents/skills/", value: ["go"], noun: "folder" },
				{ label: ".cursor/skills/", value: ["go"], noun: "folder" },
			];
			expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
				{ rows: [expect.objectContaining({ fields: folders })], noun: ENTRY },
				{ message: "Remove it and its 3 folders?" },
			);
			expect(ui.rows()).toEqual([expect.objectContaining({ fields: folders })]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});
	});

	describe("collection prefix match", () => {
		it("removes all collection plugins matching prefix", async () => {
			const manifest: Manifest = {
				"owner/repo/go": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				}),
				"owner/repo/python": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/"],
				}),
				"other/plugin": makeEntry({
					ref: "v1.0",
					commit: "xyz789",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/other/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledTimes(2);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/python/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"other/plugin": manifest["other/plugin"],
			});
		});

		it("shows summary with collection key and total file count", async () => {
			const manifest: Manifest = {
				"owner/repo/go": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				}),
				"owner/repo/python": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/", ".claude/agents/python-agent.md"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo", {}, ui);

			const rows = [
				removalRow("owner/repo/go", "skill", [".claude/skills/go/"]),
				removalRow("owner/repo/python", "skill", [
					".claude/skills/python/",
					".claude/agents/python-agent.md",
				]),
			];
			expect(ui.block).toHaveBeenNthCalledWith(1, rows);
			expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
				{ rows: rows, noun: ENTRY },
				{
					message: "Remove them and their 2 folders and 1 agent?",
				},
			);
			expect(ui.rows()).toEqual([
				removedRow("owner/repo/go", "skill", [".claude/skills/go/"]),
				removedRow("owner/repo/python", "skill", [
					".claude/skills/python/",
					".claude/agents/python-agent.md",
				]),
			]);
			expect(ui.close).toHaveBeenCalledExactlyOnceWith({
				command: "remove",
				counts: { removed: 2, failed: 0 },
			});
		});
	});

	describe("non-existent key", () => {
		it("exits 1 with spec error message", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);

			const err = await runRemove("nonexistent/plugin", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(ui.said("error")).toEqual([
				"nonexistent/plugin is not installed.",
			]);
		});
	});

	describe("confirmation", () => {
		it("shows files that will be deleted in confirmation", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			const row = removalRow("owner/repo", "skill", [
				".claude/skills/my-skill/",
				".claude/agents/executor.md",
			]);
			expect(ui.block).toHaveBeenNthCalledWith(1, [row]);
			expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
				{ rows: [row], noun: ENTRY },
				{
					message: "Remove it and its 1 folder and 1 agent?",
				},
			);
			expect(ui.blocks[0]!.row).not.toHaveBeenCalled();
		});

		it("cancels and exits 0 when user declines", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(false);

			const err = await runRemove("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(ui.cancel).toHaveBeenCalledExactlyOnceWith("Cancelled");
			expect(ui.rows()).toEqual([]);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("cancels and exits 0 when confirm is dismissed (a no)", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
			});
			ui.confirm.mockResolvedValue(false);

			const err = await runRemove("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("files nuked", () => {
		it("calls nukeManifestFiles with project dir and file list", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
					],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [
					".claude/skills/planning/",
					".claude/skills/review/",
					".claude/agents/executor.md",
				],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/planning/",
				".claude/skills/review/",
				".claude/agents/executor.md",
			]);
		});
	});

	describe("ENOENT tolerance", () => {
		it("succeeds even when some files were already missing", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [".claude/agents/executor.md"],
			});

			await expect(runRemove("owner/repo", {}, ui)).resolves.toBeUndefined();

			expect(mockWriteManifest).toHaveBeenCalled();
		});
	});

	describe("manifest updated", () => {
		it("writes manifest without the removed entry", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
				"other/plugin": makeEntry({
					ref: "v2.0",
					commit: "def456",
					installedAt: "2026-01-16T10:00:00.000Z",
					files: [".claude/skills/other/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"other/plugin": manifest["other/plugin"],
			});
		});
	});

	describe("preserves unrelated entries", () => {
		it("keeps unrelated plugins in manifest after removal", async () => {
			const manifest: Manifest = {
				"owner/repo/go": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				}),
				"owner/repo/python": makeEntry({
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/"],
				}),
				"unrelated/plugin": makeEntry({
					ref: "v1.0",
					commit: "xyz789",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/unrelated/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo", {}, ui);

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"unrelated/plugin": manifest["unrelated/plugin"],
			});
		});
	});

	describe("summary", () => {
		it("shows 'Removed {key}' with file count for standalone", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
					],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [
					".claude/skills/planning/",
					".claude/skills/review/",
					".claude/agents/executor.md",
				],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			expect(ui.rows()).toEqual([
				{
					status: "done",
					subject: "owner/repo",
					detail: { label: "removed", aside: "skill" },
					fields: [
						{
							label: ".claude/skills/",
							value: ["planning", "review"],
							noun: "folder",
						},
						{ label: ".claude/agents/", value: ["executor.md"], noun: "agent" },
					],
				},
			]);
		});

		it("shows correct file count for single file plugin", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
				expect.anything(),
				{ message: "Remove it and its folder?" },
			);
		});
	});

	describe("empty parent directories left in place", () => {
		it("does not attempt to remove parent directories after file deletion", async () => {
			const manifest: Manifest = {
				"owner/repo": makeEntry({
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			ui.confirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [],
			});

			await runRemove("owner/repo", {}, ui);

			// nukeManifestFiles only called with the files listed in manifest,
			// no additional calls to remove parent directories
			expect(mockNukeManifestFiles).toHaveBeenCalledTimes(1);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
		});
	});

	describe("readManifest integration", () => {
		it("reads manifest from cwd", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runRemove("owner/repo", {}, ui);

			expect(mockReadManifestOrExit).toHaveBeenCalledWith("/fake/project", ui);
		});
	});

	describe("manifest read error", () => {
		it("throws ExitSignal(1) on read failure", async () => {
			mockReadManifestOrExit.mockRejectedValue(new ExitSignal(1));

			const err = await runRemove("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});
	});

	describe("interactive mode (no-arg)", () => {
		describe("empty manifest", () => {
			it("displays message and returns without showing multiselect", async () => {
				mockReadManifestOrExit.mockResolvedValue({});

				await expect(runRemove(undefined, {}, ui)).resolves.toBeUndefined();

				expect(ui.rows()).toEqual([
					{ status: "unchanged", subject: "No skills or packs installed." },
				]);
				expect(ui.multiselect).not.toHaveBeenCalled();
			});
		});

		describe("multiselect shown", () => {
			it("presents multiselect with all manifest keys", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
					"other/plugin": makeEntry({
						ref: null,
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo"]);
				ui.confirm.mockResolvedValue(true);

				await runRemove(undefined, {}, ui);

				expect(ui.multiselect).toHaveBeenCalledOnce();
				const call = ui.multiselect.mock.calls[0]![0];
				const values = call.options.map((o) => o.value);
				expect(values).toEqual(["owner/repo", "other/plugin"]);
				expect(call.message).toBe("Select what to remove");
			});

			it("opens with the header before the multiselect", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo"]);
				ui.confirm.mockResolvedValue(true);

				await runRemove(undefined, {}, ui);

				expect(ui.header).toHaveBeenCalledOnce();
				expect(ui.header.mock.invocationCallOrder[0]!).toBeLessThan(
					ui.multiselect.mock.invocationCallOrder[0]!,
				);
			});

			it("lines up each entry's kind and ref, dim, beside its key", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
					"other/plugin": makeEntry({
						ref: null,
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo"]);
				ui.confirm.mockResolvedValue(true);

				await runRemove(undefined, {}, ui);

				const call = ui.multiselect.mock.calls[0]![0];
				expect(call.options).toEqual([
					{
						value: "owner/repo",
						label: "owner/repo",
						cells: [
							{ text: "skill", dim: true, drop: 1 },
							{ text: "v1.0", dim: true, drop: 2 },
						],
					},
					{
						value: "other/plugin",
						label: "other/plugin",
						cells: [
							{ text: "skill", dim: true, drop: 1 },
							{ text: "HEAD", dim: true, drop: 2 },
						],
					},
				]);
			});

			it("names a local entry by its folder, shortened against the home folder, and its ref as local", async () => {
				const local = join(homedir(), "src", "kit");
				mockReadManifestOrExit.mockResolvedValue({
					[local]: makeEntry({ type: "pack", commit: null, files: [] }),
				});
				ui.multiselect.mockResolvedValue([local]);
				ui.confirm.mockResolvedValue(false);

				await runRemove(undefined, {}, ui).catch(() => {});

				expect(ui.multiselect.mock.calls[0]![0].options).toEqual([
					{
						value: local,
						label: join("~", "src", "kit"),
						cells: [
							{ text: "pack", dim: true, drop: 1 },
							{ text: "local", dim: true, drop: 2 },
						],
					},
				]);
				expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
					{
						rows: [removalRow(join("~", "src", "kit"), "pack", [])],
						noun: ENTRY,
					},
					{ message: "Remove it?" },
				);
			});

			it("shows single plugin in multiselect", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo"]);
				ui.confirm.mockResolvedValue(true);

				await runRemove(undefined, {}, ui);

				expect(ui.multiselect).toHaveBeenCalledOnce();
				const call = ui.multiselect.mock.calls[0]![0];
				expect(call.options).toHaveLength(1);
				expect(call.options[0]!.value).toBe("owner/repo");
			});
		});

		describe("cancel and zero selection", () => {
			it("exits 0 when the multiselect is dismissed (an empty pick)", async () => {
				mockReadManifestOrExit.mockResolvedValue({
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
				});
				ui.multiselect.mockResolvedValue([]);

				const err = await runRemove(undefined, {}, ui).catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(ui.cancel).toHaveBeenCalledExactlyOnceWith("Cancelled");
				expect(ui.rows()).toEqual([]);
				expect(ui.confirm).not.toHaveBeenCalled();
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			});

			it("exits 0 when zero plugins selected", async () => {
				mockReadManifestOrExit.mockResolvedValue({
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
				});
				ui.multiselect.mockResolvedValue([]);

				const err = await runRemove(undefined, {}, ui).catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(ui.confirm).not.toHaveBeenCalled();
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			});
		});

		describe("selection flows to confirm and remove", () => {
			it("removes single selected plugin after confirmation", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
					}),
					"other/plugin": makeEntry({
						ref: "v2.0",
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo"]);
				ui.confirm.mockResolvedValue(true);
				mockNukeManifestFiles.mockResolvedValue({
					removed: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
					skipped: [],
				});

				await runRemove(undefined, {}, ui);

				expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
					".claude/skills/my-skill/",
					".claude/agents/executor.md",
				]);
				expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
					"other/plugin": manifest["other/plugin"],
				});
			});

			it("removes multiple selected plugins after confirmation", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
					"other/plugin": makeEntry({
						ref: "v2.0",
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					}),
					"keep/this": makeEntry({
						ref: null,
						commit: "xyz789",
						installedAt: "2026-01-17T10:00:00.000Z",
						files: [".claude/skills/keep/"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo", "other/plugin"]);
				ui.confirm.mockResolvedValue(true);

				await runRemove(undefined, {}, ui);

				expect(mockNukeManifestFiles).toHaveBeenCalledTimes(2);
				expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
					".claude/skills/my-skill/",
				]);
				expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
					".claude/skills/other/",
				]);
				expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
					"keep/this": manifest["keep/this"],
				});
			});

			it("does not nuke or write when confirmation declined", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo"]);
				ui.confirm.mockResolvedValue(false);

				const err = await runRemove(undefined, {}, ui).catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});

			it("shows correct nuke args for selected keys", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [
							".claude/skills/planning/",
							".claude/skills/review/",
							".claude/agents/executor.md",
						],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo"]);
				ui.confirm.mockResolvedValue(true);
				mockNukeManifestFiles.mockResolvedValue({
					removed: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
					],
					skipped: [],
				});

				await runRemove(undefined, {}, ui);

				expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
					".claude/skills/planning/",
					".claude/skills/review/",
					".claude/agents/executor.md",
				]);
			});

			it("shows summary with selected count and total files", async () => {
				const manifest: Manifest = {
					"owner/repo": makeEntry({
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					}),
					"other/plugin": makeEntry({
						ref: "v2.0",
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/", ".claude/agents/agent.md"],
					}),
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				ui.multiselect.mockResolvedValue(["owner/repo", "other/plugin"]);
				ui.confirm.mockResolvedValue(true);

				await runRemove(undefined, {}, ui);

				expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
					{
						rows: [
							removalRow("owner/repo", "skill", [".claude/skills/my-skill/"]),
							removalRow("other/plugin", "skill", [
								".claude/skills/other/",
								".claude/agents/agent.md",
							]),
						],
						noun: ENTRY,
					},
					{ message: "Remove them and their 2 folders and 1 agent?" },
				);
				expect(ui.close).toHaveBeenCalledExactlyOnceWith({
					command: "remove",
					counts: { removed: 2, failed: 0 },
				});
			});
		});
	});

	describe("what the question's rows name", () => {
		it("names each asset folder's items under it, a pack's kind with its counts", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/kit": makeEntry({
					type: "pack",
					files: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
						".claude/hooks/pre-commit.sh",
					],
				}),
			});
			ui.confirm.mockResolvedValue(true);

			await runRemove("owner/repo/kit", {}, ui);

			expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
				{
					rows: [
						{
							status: "subject",
							subject: "owner/repo/kit",
							detail: "pack · 2 skills, 1 agent, 1 hook",
							fields: [
								{
									label: ".claude/skills/",
									value: ["planning", "review"],
									noun: "folder",
								},
								{
									label: ".claude/agents/",
									value: ["executor.md"],
									noun: "agent",
								},
								{
									label: ".claude/hooks/",
									value: ["pre-commit.sh"],
									noun: "hook",
								},
							],
						},
					],
					noun: ENTRY,
				},
				{ message: "Remove it and its 2 folders, 1 agent and 1 hook?" },
			);
		});
	});

	describe("-y", () => {
		const manifest: Manifest = {
			"owner/repo/go": {
				ref: "v1.0.0",
				commit: "def456",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/go/"],
				type: "skill",
				cloneUrl: null,
			},
			"other/plugin": {
				ref: null,
				commit: "xyz789",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [".claude/skills/other/"],
				cloneUrl: null,
			},
		};

		beforeEach(() => {
			mockReadManifestOrExit.mockResolvedValue(manifest);
		});

		it("is taken as -y and --yes", () => {
			const option = removeCommand.options.find((o) => o.long === "--yes");
			expect(option?.short).toBe("-y");
		});

		it("removes without asking at a terminal", async () => {
			await runRemove("owner/repo/go", { yes: true }, ui);

			expect(ui.confirm).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(ui.rows()).toEqual([
				removedRow("owner/repo/go", "skill", [".claude/skills/go/"]),
			]);
		});

		it("removes without a terminal, printing one document of what went", async () => {
			const run = await runMachine(removeCommand, ["owner/repo/go", "-y"]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toEqual({
				ok: true,
				command: "remove",
				scope: "project",
				removed: [
					{
						key: "owner/repo/go",
						type: "skill",
						ref: "v1.0.0",
						commit: "def456",
						constraint: null,
						files: [".claude/skills/go/"],
					},
				],
				failed: [],
				warnings: [],
				notes: [],
			});
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"other/plugin": manifest["other/plugin"],
			});
			expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
		});

		it("left off without a terminal, refuses before deleting anything, naming -y", async () => {
			const run = await runMachine(removeCommand, ["owner/repo/go"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toEqual({
				ok: false,
				command: "remove",
				scope: "project",
				error: {
					message: "removing owner/repo/go deletes 1 file(s) — confirm with -y",
					flags: ["-y"],
				},
				warnings: [],
				notes: [],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
		});
	});

	describe("without a terminal", () => {
		it("refuses with no key, naming the key argument, since it can't show the list", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: null,
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
			});

			const run = await runMachine(removeCommand, ["-y"]);

			expect(run.exitCode).toBe(1);
			expect(run.document.error).toEqual({
				message:
					"remove needs the key of what to remove without a terminal: npx agntc remove <key>",
				flags: ["<key>"],
			});
			expect(ui.multiselect).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("prints an error document for a key that isn't installed", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: null,
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				}),
			});

			const run = await runMachine(removeCommand, ["nope/repo", "-y"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toEqual({
				ok: false,
				command: "remove",
				scope: "project",
				error: { message: "nope/repo is not installed." },
				warnings: [],
				notes: [],
			});
		});

		it("reports nothing removed when nothing is installed", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			const run = await runMachine(removeCommand, []);

			expect(run.exitCode).toBe(0);
			expect(run.document).toMatchObject({ ok: true, removed: [], failed: [] });
		});
	});

	describe("a key whose removal fails", () => {
		function installed(skill: string) {
			return {
				ref: null,
				commit: "abc123",
				installedAt: "2026-01-15T10:00:00.000Z",
				files: [`.claude/skills/${skill}/`],
				type: "skill" as const,
				cloneUrl: null,
			};
		}

		const manifest: Manifest = {
			"owner/repo/a": installed("a"),
			"owner/repo/b": installed("b"),
			"owner/repo/c": installed("c"),
			"other/repo": installed("other"),
		};

		function removedJson(key: string, skill: string) {
			return {
				key,
				type: "skill",
				ref: null,
				commit: "abc123",
				constraint: null,
				files: [`.claude/skills/${skill}/`],
			};
		}

		beforeEach(() => {
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockNukeManifestFiles.mockImplementation(async (_, files) => {
				if (files.includes(".claude/skills/b/")) {
					throw new Error("EACCES: permission denied");
				}
				return { removed: files, skipped: [] };
			});
		});

		it("removes the keys around it, keeps it recorded, names it and exits 1", async () => {
			await expect(
				runRemove("owner/repo", { yes: true }, ui),
			).rejects.toMatchObject({ code: 1 });

			expect(mockNukeManifestFiles).toHaveBeenCalledTimes(3);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"owner/repo/b": manifest["owner/repo/b"],
				"other/repo": manifest["other/repo"],
			});
			expect(ui.rows()).toEqual([
				removedRow("owner/repo/a", "skill", [".claude/skills/a/"]),
				removeFailedRow("owner/repo/b", "EACCES: permission denied"),
				removedRow("owner/repo/c", "skill", [".claude/skills/c/"]),
			]);
			expect(ui.close).toHaveBeenCalledExactlyOnceWith({
				command: "remove",
				counts: { removed: 2, failed: 1 },
			});
		});

		it("without a terminal, reports only the keys removed and the failure, with ok false", async () => {
			const run = await runMachine(removeCommand, ["owner/repo", "-y"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toEqual({
				ok: false,
				command: "remove",
				scope: "project",
				removed: [
					removedJson("owner/repo/a", "a"),
					removedJson("owner/repo/c", "c"),
				],
				failed: [
					{
						key: "owner/repo/b",
						type: "skill",
						ref: null,
						commit: "abc123",
						constraint: null,
						reason: "EACCES: permission denied",
					},
				],
				warnings: [],
				notes: [],
			});
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"owner/repo/b": manifest["owner/repo/b"],
				"other/repo": manifest["other/repo"],
			});
		});

		it("alone, removes nothing, keeps it recorded and exits 1", async () => {
			await expect(
				runRemove("owner/repo/b", { yes: true }, ui),
			).rejects.toMatchObject({ code: 1 });

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", manifest);
			expect(ui.rows()).toEqual([
				removeFailedRow("owner/repo/b", "EACCES: permission denied"),
			]);
			expect(ui.close).toHaveBeenCalledExactlyOnceWith({
				command: "remove",
				counts: { removed: 0, failed: 1 },
			});
		});
	});
});

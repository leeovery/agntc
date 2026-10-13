import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { Manifest } from "../../src/manifest.js";

vi.mock("@clack/prompts", () => ({
	intro: vi.fn(),
	outro: vi.fn(),
	log: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		success: vi.fn(),
		message: vi.fn(),
	},
	cancel: vi.fn(),
	confirm: vi.fn(),
	multiselect: vi.fn(),
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
}));

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

import * as p from "@clack/prompts";
import { removeCommand, runRemove } from "../../src/commands/remove.js";
import { readManifestOrExit, writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { interactiveUi } from "../../src/ui.js";
import { clackCalls, runMachine } from "../helpers/machine.js";

const mockReadManifestOrExit = vi.mocked(readManifestOrExit);
const mockWriteManifest = vi.mocked(writeManifest);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockConfirm = vi.mocked(p.confirm);
const mockMultiselect = vi.mocked(p.multiselect);
const mockOutro = vi.mocked(p.outro);
const mockIntro = vi.mocked(p.intro);
const mockLog = vi.mocked(p.log);

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	mockWriteManifest.mockResolvedValue(undefined);
});

describe("remove command", () => {
	describe("empty manifest", () => {
		it("displays 'No skills or packs installed.' and exits 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await expect(runRemove("owner/repo")).resolves.toBeUndefined();

			expect(mockOutro).toHaveBeenCalledWith("No skills or packs installed.");
		});
	});

	describe("exact key match — standalone plugin", () => {
		it("removes a standalone plugin", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				skipped: [],
			});

			await runRemove("owner/repo");

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
				".claude/agents/executor.md",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("Removed owner/repo"),
			);
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("2 file(s)"),
			);
		});
	});

	describe("exact key match — specific collection plugin", () => {
		it("removes a specific collection plugin", async () => {
			const manifest: Manifest = {
				"owner/repo/go": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				},
				"owner/repo/python": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/go/"],
				skipped: [],
			});

			await runRemove("owner/repo/go");

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
			mockConfirm.mockResolvedValue(true);

			await runRemove("owner/repo/go");

			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				legacyFiles,
			);
			for (const file of legacyFiles) {
				expect(mockLog.message).toHaveBeenCalledWith(`  ${file}`);
			}
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("3 file(s)"),
			);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});
	});

	describe("collection prefix match", () => {
		it("removes all collection plugins matching prefix", async () => {
			const manifest: Manifest = {
				"owner/repo/go": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				},
				"owner/repo/python": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/"],
				},
				"other/plugin": {
					ref: "v1.0",
					commit: "xyz789",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/other/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [],
				skipped: [],
			});

			await runRemove("owner/repo");

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
				"owner/repo/go": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				},
				"owner/repo/python": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/", ".claude/agents/python-agent.md"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("Removed owner/repo"),
			);
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("3 file(s)"),
			);
		});
	});

	describe("non-existent key", () => {
		it("exits 1 with spec error message", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);

			const err = await runRemove("nonexistent/plugin").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockLog.error).toHaveBeenCalledWith(
				"nonexistent/plugin is not installed.",
			);
		});
	});

	describe("confirmation", () => {
		it("shows files that will be deleted in confirmation", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				skipped: [],
			});

			await runRemove("owner/repo");

			expect(mockLog.message).toHaveBeenCalledWith(
				expect.stringContaining(".claude/skills/my-skill/"),
			);
			expect(mockLog.message).toHaveBeenCalledWith(
				expect.stringContaining(".claude/agents/executor.md"),
			);
			expect(mockConfirm).toHaveBeenCalled();
		});

		it("cancels and exits 0 when user declines", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(false);

			const err = await runRemove("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("cancels and exits 0 when confirm is cancelled (symbol)", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			});
			mockConfirm.mockResolvedValue(Symbol.for("cancel") as unknown as boolean);

			const err = await runRemove("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(0);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});
	});

	describe("files nuked", () => {
		it("calls nukeManifestFiles with project dir and file list", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
					],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [
					".claude/skills/planning/",
					".claude/skills/review/",
					".claude/agents/executor.md",
				],
				skipped: [],
			});

			await runRemove("owner/repo");

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
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [".claude/agents/executor.md"],
			});

			await expect(runRemove("owner/repo")).resolves.toBeUndefined();

			expect(mockWriteManifest).toHaveBeenCalled();
		});
	});

	describe("manifest updated", () => {
		it("writes manifest without the removed entry", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
				"other/plugin": {
					ref: "v2.0",
					commit: "def456",
					installedAt: "2026-01-16T10:00:00.000Z",
					files: [".claude/skills/other/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [],
			});

			await runRemove("owner/repo");

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"other/plugin": manifest["other/plugin"],
			});
		});
	});

	describe("preserves unrelated entries", () => {
		it("keeps unrelated plugins in manifest after removal", async () => {
			const manifest: Manifest = {
				"owner/repo/go": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				},
				"owner/repo/python": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/"],
				},
				"unrelated/plugin": {
					ref: "v1.0",
					commit: "xyz789",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/unrelated/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo");

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"unrelated/plugin": manifest["unrelated/plugin"],
			});
		});
	});

	describe("summary", () => {
		it("shows 'Removed {key}' with file count for standalone", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
					],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [
					".claude/skills/planning/",
					".claude/skills/review/",
					".claude/agents/executor.md",
				],
				skipped: [],
			});

			await runRemove("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith("Removed owner/repo — 3 file(s)");
		});

		it("shows correct file count for single file plugin", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [],
			});

			await runRemove("owner/repo");

			expect(mockOutro).toHaveBeenCalledWith("Removed owner/repo — 1 file(s)");
		});
	});

	describe("empty parent directories left in place", () => {
		it("does not attempt to remove parent directories after file deletion", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({
				removed: [".claude/skills/my-skill/"],
				skipped: [],
			});

			await runRemove("owner/repo");

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

			await runRemove("owner/repo");

			expect(mockReadManifestOrExit).toHaveBeenCalledWith(
				"/fake/project",
				interactiveUi,
			);
		});
	});

	describe("manifest read error", () => {
		it("throws ExitSignal(1) on read failure", async () => {
			mockReadManifestOrExit.mockRejectedValue(new ExitSignal(1));

			const err = await runRemove("owner/repo").catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});
	});

	describe("interactive mode (no-arg)", () => {
		describe("empty manifest", () => {
			it("displays message and returns without showing multiselect", async () => {
				mockReadManifestOrExit.mockResolvedValue({});

				await expect(runRemove()).resolves.toBeUndefined();

				expect(mockOutro).toHaveBeenCalledWith("No skills or packs installed.");
				expect(mockMultiselect).not.toHaveBeenCalled();
			});
		});

		describe("multiselect shown", () => {
			it("presents multiselect with all manifest keys", async () => {
				const manifest: Manifest = {
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
					"other/plugin": {
						ref: null,
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo"]);
				mockConfirm.mockResolvedValue(true);

				await runRemove();

				expect(mockMultiselect).toHaveBeenCalledOnce();
				const call = mockMultiselect.mock.calls[0]![0];
				const values = call.options.map((o: { value: string }) => o.value);
				expect(values).toEqual(["owner/repo", "other/plugin"]);
				expect(call.message).toBe("Select what to remove");
			});

			it("shows the 'agntc remove' intro before the multiselect", async () => {
				const manifest: Manifest = {
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo"]);
				mockConfirm.mockResolvedValue(true);

				await runRemove();

				expect(mockIntro).toHaveBeenCalledWith("agntc remove");
				expect(mockIntro.mock.invocationCallOrder[0]!).toBeLessThan(
					mockMultiselect.mock.invocationCallOrder[0]!,
				);
			});

			it("shows ref hints on multiselect options", async () => {
				const manifest: Manifest = {
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
					"other/plugin": {
						ref: null,
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo"]);
				mockConfirm.mockResolvedValue(true);

				await runRemove();

				const call = mockMultiselect.mock.calls[0]![0];
				const ownerOption = call.options.find(
					(o: { value: string }) => o.value === "owner/repo",
				);
				expect(ownerOption?.hint).toBe("v1.0");

				const otherOption = call.options.find(
					(o: { value: string }) => o.value === "other/plugin",
				);
				expect(otherOption?.hint).toBe("HEAD");
			});

			it("shows single plugin in multiselect", async () => {
				const manifest: Manifest = {
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo"]);
				mockConfirm.mockResolvedValue(true);

				await runRemove();

				expect(mockMultiselect).toHaveBeenCalledOnce();
				const call = mockMultiselect.mock.calls[0]![0];
				expect(call.options).toHaveLength(1);
				expect(call.options[0]!.value).toBe("owner/repo");
			});
		});

		describe("cancel and zero selection", () => {
			it("exits 0 when multiselect is cancelled", async () => {
				mockReadManifestOrExit.mockResolvedValue({
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
				});
				mockMultiselect.mockResolvedValue(
					Symbol("cancel") as unknown as string[],
				);

				const err = await runRemove().catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(mockConfirm).not.toHaveBeenCalled();
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			});

			it("exits 0 when zero plugins selected", async () => {
				mockReadManifestOrExit.mockResolvedValue({
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
				});
				mockMultiselect.mockResolvedValue([]);

				const err = await runRemove().catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(mockConfirm).not.toHaveBeenCalled();
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			});
		});

		describe("selection flows to confirm and remove", () => {
			it("removes single selected plugin after confirmation", async () => {
				const manifest: Manifest = {
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
					},
					"other/plugin": {
						ref: "v2.0",
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo"]);
				mockConfirm.mockResolvedValue(true);
				mockNukeManifestFiles.mockResolvedValue({
					removed: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
					skipped: [],
				});

				await runRemove();

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
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
					"other/plugin": {
						ref: "v2.0",
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/"],
					},
					"keep/this": {
						ref: null,
						commit: "xyz789",
						installedAt: "2026-01-17T10:00:00.000Z",
						files: [".claude/skills/keep/"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo", "other/plugin"]);
				mockConfirm.mockResolvedValue(true);

				await runRemove();

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
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo"]);
				mockConfirm.mockResolvedValue(false);

				const err = await runRemove().catch((e) => e);

				expect(err).toBeInstanceOf(ExitSignal);
				expect((err as ExitSignal).code).toBe(0);
				expect(mockNukeManifestFiles).not.toHaveBeenCalled();
				expect(mockWriteManifest).not.toHaveBeenCalled();
			});

			it("shows correct nuke args for selected keys", async () => {
				const manifest: Manifest = {
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [
							".claude/skills/planning/",
							".claude/skills/review/",
							".claude/agents/executor.md",
						],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo"]);
				mockConfirm.mockResolvedValue(true);
				mockNukeManifestFiles.mockResolvedValue({
					removed: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
					],
					skipped: [],
				});

				await runRemove();

				expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
					".claude/skills/planning/",
					".claude/skills/review/",
					".claude/agents/executor.md",
				]);
			});

			it("shows summary with selected count and total files", async () => {
				const manifest: Manifest = {
					"owner/repo": {
						ref: "v1.0",
						commit: "abc123",
						installedAt: "2026-01-15T10:00:00.000Z",
						files: [".claude/skills/my-skill/"],
					},
					"other/plugin": {
						ref: "v2.0",
						commit: "def456",
						installedAt: "2026-01-16T10:00:00.000Z",
						files: [".claude/skills/other/", ".claude/agents/agent.md"],
					},
				};
				mockReadManifestOrExit.mockResolvedValue(manifest);
				mockMultiselect.mockResolvedValue(["owner/repo", "other/plugin"]);
				mockConfirm.mockResolvedValue(true);

				await runRemove();

				expect(mockOutro).toHaveBeenCalledWith(
					"Removed 2 install(s) — 3 file(s)",
				);
			});
		});
	});

	describe("file grouping by type in confirmation display", () => {
		it("groups files by type with headers", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [
						".claude/skills/planning/",
						".claude/skills/review/",
						".claude/agents/executor.md",
						".claude/hooks/pre-commit.sh",
					],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo");

			const messageCalls = mockLog.message.mock.calls.map(
				(c) => c[0] as string,
			);
			const skillsHeaderIdx = messageCalls.findIndex((m) =>
				m.includes("Skills"),
			);
			const agentsHeaderIdx = messageCalls.findIndex((m) =>
				m.includes("Agents"),
			);
			const hooksHeaderIdx = messageCalls.findIndex((m) => m.includes("Hooks"));

			expect(skillsHeaderIdx).toBeGreaterThanOrEqual(0);
			expect(agentsHeaderIdx).toBeGreaterThanOrEqual(0);
			expect(hooksHeaderIdx).toBeGreaterThanOrEqual(0);
			expect(skillsHeaderIdx).toBeLessThan(agentsHeaderIdx);
			expect(agentsHeaderIdx).toBeLessThan(hooksHeaderIdx);
		});

		it("only shows headers for types that have files", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo");

			const messageCalls = mockLog.message.mock.calls.map(
				(c) => c[0] as string,
			);
			const hasSkillsHeader = messageCalls.some((m) => m.includes("Skills"));
			const hasAgentsHeader = messageCalls.some((m) => m.includes("Agents"));
			const hasHooksHeader = messageCalls.some((m) => m.includes("Hooks"));

			expect(hasSkillsHeader).toBe(true);
			expect(hasAgentsHeader).toBe(false);
			expect(hasHooksHeader).toBe(false);
		});
	});

	describe("collection remove lists affected plugins", () => {
		it("lists affected plugin names before file list for collection prefix match", async () => {
			const manifest: Manifest = {
				"owner/repo/go": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/go/"],
				},
				"owner/repo/python": {
					ref: null,
					commit: "def456",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/python/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo");

			const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
			const hasGoPlugin = infoCalls.some((m) => m.includes("owner/repo/go"));
			const hasPythonPlugin = infoCalls.some((m) =>
				m.includes("owner/repo/python"),
			);
			expect(hasGoPlugin).toBe(true);
			expect(hasPythonPlugin).toBe(true);
		});

		it("does not list affected plugins for single exact key match", async () => {
			const manifest: Manifest = {
				"owner/repo": {
					ref: "v1.0",
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			};
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockConfirm.mockResolvedValue(true);
			mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

			await runRemove("owner/repo");

			expect(mockLog.info).not.toHaveBeenCalled();
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
			await runRemove("owner/repo/go", { yes: true });

			expect(mockConfirm).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockOutro).toHaveBeenCalledWith(
				"Removed owner/repo/go — 1 file(s)",
			);
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
			expect(clackCalls(p)).toEqual([]);
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
			expect(clackCalls(p)).toEqual([]);
		});
	});

	describe("without a terminal", () => {
		it("refuses with no key, naming the key argument, since it can't show the list", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": {
					ref: null,
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
			});

			const run = await runMachine(removeCommand, ["-y"]);

			expect(run.exitCode).toBe(1);
			expect(run.document.error).toEqual({
				message:
					"remove needs the key of what to remove without a terminal: npx agntc remove <key>",
				flags: ["<key>"],
			});
			expect(mockMultiselect).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		});

		it("prints an error document for a key that isn't installed", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": {
					ref: null,
					commit: "abc123",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: [".claude/skills/my-skill/"],
				},
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
				runRemove("owner/repo", { yes: true }),
			).rejects.toMatchObject({ code: 1 });

			expect(mockNukeManifestFiles).toHaveBeenCalledTimes(3);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
				"owner/repo/b": manifest["owner/repo/b"],
				"other/repo": manifest["other/repo"],
			});
			expect(mockLog.error).toHaveBeenCalledWith(
				"owner/repo/b: failed — EACCES: permission denied; it stays recorded",
			);
			expect(mockOutro).toHaveBeenCalledWith(
				"Removed 2 install(s) — 2 file(s)",
			);
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
				runRemove("owner/repo/b", { yes: true }),
			).rejects.toMatchObject({ code: 1 });

			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", manifest);
			expect(mockLog.error).toHaveBeenCalledWith(
				"owner/repo/b: failed — EACCES: permission denied; it stays recorded",
			);
			expect(mockOutro).toHaveBeenCalledWith("Nothing removed");
		});
	});
});

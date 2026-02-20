import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest } from "../../src/manifest.js";
import { ExitSignal } from "../../src/exit-signal.js";
import type { NukeResult } from "../../src/nuke-files.js";

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

vi.mock("../../src/manifest.js", () => ({
  readManifest: vi.fn(),
  writeManifest: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
  nukeManifestFiles: vi.fn(),
}));

import * as p from "@clack/prompts";
import { readManifest, writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { runRemove } from "../../src/commands/remove.js";

const mockReadManifest = vi.mocked(readManifest);
const mockWriteManifest = vi.mocked(writeManifest);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockConfirm = vi.mocked(p.confirm);
const mockMultiselect = vi.mocked(p.multiselect);
const mockOutro = vi.mocked(p.outro);
const mockCancel = vi.mocked(p.cancel);
const mockLog = vi.mocked(p.log);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
  mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
  mockWriteManifest.mockResolvedValue(undefined);
});

describe("remove command", () => {
  describe("empty manifest", () => {
    it("displays 'No plugins installed.' and exits 0", async () => {
      mockReadManifest.mockResolvedValue({});

      await expect(runRemove("owner/repo")).resolves.toBeUndefined();

      expect(mockOutro).toHaveBeenCalledWith("No plugins installed.");
    });
  });

  describe("exact key match — standalone plugin", () => {
    it("removes a standalone plugin", async () => {
      const manifest: Manifest = {
        "owner/repo": {
          ref: "v1.0",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude", "codex"],
          files: [".claude/skills/go/", ".agents/skills/go/"],
        },
        "owner/repo/python": {
          ref: null,
          commit: "def456",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/python/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockConfirm.mockResolvedValue(true);
      mockNukeManifestFiles.mockResolvedValue({
        removed: [".claude/skills/go/", ".agents/skills/go/"],
        skipped: [],
      });

      await runRemove("owner/repo/go");

      expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
        ".claude/skills/go/",
        ".agents/skills/go/",
      ]);
      expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {
        "owner/repo/python": manifest["owner/repo/python"],
      });
    });
  });

  describe("collection prefix match", () => {
    it("removes all collection plugins matching prefix", async () => {
      const manifest: Manifest = {
        "owner/repo/go": {
          ref: null,
          commit: "def456",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/go/"],
        },
        "owner/repo/python": {
          ref: null,
          commit: "def456",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/python/"],
        },
        "other/plugin": {
          ref: "v1.0",
          commit: "xyz789",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/other/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude"],
          files: [".claude/skills/go/"],
        },
        "owner/repo/python": {
          ref: null,
          commit: "def456",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/python/", ".claude/agents/python-agent.md"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      const err = await runRemove("nonexistent/plugin").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        "Plugin nonexistent/plugin is not installed.",
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
          agents: ["claude"],
          files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockConfirm.mockResolvedValue(false);

      const err = await runRemove("owner/repo").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(0);
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
      expect(mockWriteManifest).not.toHaveBeenCalled();
    });

    it("cancels and exits 0 when confirm is cancelled (symbol)", async () => {
      mockReadManifest.mockResolvedValue({
        "owner/repo": {
          ref: "v1.0",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
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
          agents: ["claude"],
          files: [
            ".claude/skills/planning/",
            ".claude/skills/review/",
            ".claude/agents/executor.md",
          ],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude"],
          files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
        "other/plugin": {
          ref: "v2.0",
          commit: "def456",
          installedAt: "2026-01-16T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/other/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude"],
          files: [".claude/skills/go/"],
        },
        "owner/repo/python": {
          ref: null,
          commit: "def456",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/python/"],
        },
        "unrelated/plugin": {
          ref: "v1.0",
          commit: "xyz789",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/unrelated/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
          agents: ["claude"],
          files: [
            ".claude/skills/planning/",
            ".claude/skills/review/",
            ".claude/agents/executor.md",
          ],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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

      expect(mockOutro).toHaveBeenCalledWith(
        "Removed owner/repo — 3 file(s)",
      );
    });

    it("shows correct file count for single file plugin", async () => {
      const manifest: Manifest = {
        "owner/repo": {
          ref: "v1.0",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockConfirm.mockResolvedValue(true);
      mockNukeManifestFiles.mockResolvedValue({
        removed: [".claude/skills/my-skill/"],
        skipped: [],
      });

      await runRemove("owner/repo");

      expect(mockOutro).toHaveBeenCalledWith(
        "Removed owner/repo — 1 file(s)",
      );
    });
  });

  describe("empty parent directories left in place", () => {
    it("does not attempt to remove parent directories after file deletion", async () => {
      const manifest: Manifest = {
        "owner/repo": {
          ref: "v1.0",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
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
      mockReadManifest.mockResolvedValue({});

      await runRemove("owner/repo");

      expect(mockReadManifest).toHaveBeenCalledWith("/fake/project");
    });
  });

  describe("manifest read error", () => {
    it("throws ExitSignal(1) on read failure", async () => {
      mockReadManifest.mockRejectedValue(new Error("Permission denied"));

      const err = await runRemove("owner/repo").catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read manifest:"),
      );
    });
  });

  describe("interactive mode (no-arg)", () => {
    describe("empty manifest", () => {
      it("displays message and returns without showing multiselect", async () => {
        mockReadManifest.mockResolvedValue({});

        await expect(runRemove()).resolves.toBeUndefined();

        expect(mockOutro).toHaveBeenCalledWith("No plugins installed.");
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
            agents: ["claude"],
            files: [".claude/skills/my-skill/"],
          },
          "other/plugin": {
            ref: null,
            commit: "def456",
            installedAt: "2026-01-16T10:00:00.000Z",
            agents: ["claude", "codex"],
            files: [".claude/skills/other/"],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
        mockMultiselect.mockResolvedValue(["owner/repo"]);
        mockConfirm.mockResolvedValue(true);

        await runRemove();

        expect(mockMultiselect).toHaveBeenCalledOnce();
        const call = mockMultiselect.mock.calls[0]![0];
        const values = call.options.map(
          (o: { value: string }) => o.value,
        );
        expect(values).toEqual(["owner/repo", "other/plugin"]);
      });

      it("shows ref hints on multiselect options", async () => {
        const manifest: Manifest = {
          "owner/repo": {
            ref: "v1.0",
            commit: "abc123",
            installedAt: "2026-01-15T10:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/my-skill/"],
          },
          "other/plugin": {
            ref: null,
            commit: "def456",
            installedAt: "2026-01-16T10:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/other/"],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
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
            agents: ["claude"],
            files: [".claude/skills/my-skill/"],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
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
        mockReadManifest.mockResolvedValue({
          "owner/repo": {
            ref: "v1.0",
            commit: "abc123",
            installedAt: "2026-01-15T10:00:00.000Z",
            agents: ["claude"],
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
        mockReadManifest.mockResolvedValue({
          "owner/repo": {
            ref: "v1.0",
            commit: "abc123",
            installedAt: "2026-01-15T10:00:00.000Z",
            agents: ["claude"],
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
            agents: ["claude"],
            files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
          },
          "other/plugin": {
            ref: "v2.0",
            commit: "def456",
            installedAt: "2026-01-16T10:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/other/"],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
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
            agents: ["claude"],
            files: [".claude/skills/my-skill/"],
          },
          "other/plugin": {
            ref: "v2.0",
            commit: "def456",
            installedAt: "2026-01-16T10:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/other/"],
          },
          "keep/this": {
            ref: null,
            commit: "xyz789",
            installedAt: "2026-01-17T10:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/keep/"],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
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
            agents: ["claude"],
            files: [".claude/skills/my-skill/"],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
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
            agents: ["claude"],
            files: [
              ".claude/skills/planning/",
              ".claude/skills/review/",
              ".claude/agents/executor.md",
            ],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
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
            agents: ["claude"],
            files: [".claude/skills/my-skill/"],
          },
          "other/plugin": {
            ref: "v2.0",
            commit: "def456",
            installedAt: "2026-01-16T10:00:00.000Z",
            agents: ["claude"],
            files: [".claude/skills/other/", ".claude/agents/agent.md"],
          },
        };
        mockReadManifest.mockResolvedValue(manifest);
        mockMultiselect.mockResolvedValue(["owner/repo", "other/plugin"]);
        mockConfirm.mockResolvedValue(true);

        await runRemove();

        expect(mockOutro).toHaveBeenCalledWith(
          "Removed 2 plugin(s) — 3 file(s)",
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
          agents: ["claude"],
          files: [
            ".claude/skills/planning/",
            ".claude/skills/review/",
            ".claude/agents/executor.md",
            ".claude/hooks/pre-commit.sh",
          ],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockConfirm.mockResolvedValue(true);
      mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

      await runRemove("owner/repo");

      const messageCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const skillsHeaderIdx = messageCalls.findIndex((m) => m.includes("Skills"));
      const agentsHeaderIdx = messageCalls.findIndex((m) => m.includes("Agents"));
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
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockConfirm.mockResolvedValue(true);
      mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

      await runRemove("owner/repo");

      const messageCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
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
          agents: ["claude"],
          files: [".claude/skills/go/"],
        },
        "owner/repo/python": {
          ref: null,
          commit: "def456",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/python/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockConfirm.mockResolvedValue(true);
      mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

      await runRemove("owner/repo");

      const infoCalls = mockLog.info.mock.calls.map((c) => c[0] as string);
      const hasGoPlugin = infoCalls.some((m) => m.includes("owner/repo/go"));
      const hasPythonPlugin = infoCalls.some((m) => m.includes("owner/repo/python"));
      expect(hasGoPlugin).toBe(true);
      expect(hasPythonPlugin).toBe(true);
    });

    it("does not list affected plugins for single exact key match", async () => {
      const manifest: Manifest = {
        "owner/repo": {
          ref: "v1.0",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockConfirm.mockResolvedValue(true);
      mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });

      await runRemove("owner/repo");

      expect(mockLog.info).not.toHaveBeenCalled();
    });
  });
});

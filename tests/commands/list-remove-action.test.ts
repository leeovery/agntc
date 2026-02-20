import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";

vi.mock("@clack/prompts", () => ({
  confirm: vi.fn(),
  isCancel: (value: unknown): value is symbol => typeof value === "symbol",
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    message: vi.fn(),
  },
}));

vi.mock("../../src/manifest.js", () => ({
  writeManifest: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
  nukeManifestFiles: vi.fn(),
}));

import * as p from "@clack/prompts";
import { writeManifest } from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { executeRemoveAction } from "../../src/commands/list-remove-action.js";

const mockWriteManifest = vi.mocked(writeManifest);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockConfirm = vi.mocked(p.confirm);
const mockLog = vi.mocked(p.log);

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
  return {
    ref: "v1.0",
    commit: "abc123",
    installedAt: "2026-01-15T10:00:00.000Z",
    agents: ["claude"],
    files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
    cloneUrl: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteManifest.mockResolvedValue(undefined);
  mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
});

describe("executeRemoveAction", () => {
  describe("shows file list before confirmation", () => {
    it("displays each file with indent via p.log.message", async () => {
      const entry = makeEntry({
        files: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
      });
      const manifest: Manifest = { "owner/repo": entry };
      mockConfirm.mockResolvedValue(false);

      await executeRemoveAction("owner/repo", entry, manifest, "/fake/project");

      expect(mockLog.message).toHaveBeenCalledWith(
        "  .claude/skills/my-skill/",
      );
      expect(mockLog.message).toHaveBeenCalledWith(
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
      mockConfirm.mockResolvedValue(false);

      await executeRemoveAction("owner/repo", entry, manifest, "/fake/project");

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Remove owner/repo? 3 file(s) will be deleted.",
      });
    });
  });

  describe("confirmed removal", () => {
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
      mockConfirm.mockResolvedValue(true);

      const result = await executeRemoveAction(
        "owner/repo",
        entry,
        manifest,
        "/fake/project",
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
      mockConfirm.mockResolvedValue(true);
      mockNukeManifestFiles.mockResolvedValue({
        removed: [],
        skipped: [".claude/skills/my-skill/"],
      });

      const result = await executeRemoveAction(
        "owner/repo",
        entry,
        manifest,
        "/fake/project",
      );

      expect(result.removed).toBe(true);
      expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
    });
  });

  describe("declined removal", () => {
    it("returns removed false, does not nuke, does not write manifest", async () => {
      const entry = makeEntry();
      const manifest: Manifest = { "owner/repo": entry };
      mockConfirm.mockResolvedValue(false);

      const result = await executeRemoveAction(
        "owner/repo",
        entry,
        manifest,
        "/fake/project",
      );

      expect(result.removed).toBe(false);
      expect(result.message).toBe("Cancelled");
      expect(mockNukeManifestFiles).not.toHaveBeenCalled();
      expect(mockWriteManifest).not.toHaveBeenCalled();
    });
  });

  describe("cancel (isCancel)", () => {
    it("returns removed false, does not nuke", async () => {
      const entry = makeEntry();
      const manifest: Manifest = { "owner/repo": entry };
      mockConfirm.mockResolvedValue(
        Symbol.for("cancel") as unknown as boolean,
      );

      const result = await executeRemoveAction(
        "owner/repo",
        entry,
        manifest,
        "/fake/project",
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
      mockConfirm.mockResolvedValue(true);

      await executeRemoveAction("owner/repo", entry, manifest, "/fake/project");

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
      mockConfirm.mockResolvedValue(true);

      await executeRemoveAction("owner/repo", entry, manifest, "/fake/project");

      expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
    });
  });

  describe("message on success", () => {
    it("includes key in message", async () => {
      const entry = makeEntry({ files: [".claude/skills/my-skill/"] });
      const manifest: Manifest = { "owner/repo": entry };
      mockConfirm.mockResolvedValue(true);

      const result = await executeRemoveAction(
        "owner/repo",
        entry,
        manifest,
        "/fake/project",
      );

      expect(result.message).toBe("Removed owner/repo");
    });
  });

  describe("message on decline", () => {
    it("says Cancelled", async () => {
      const entry = makeEntry();
      const manifest: Manifest = { "owner/repo": entry };
      mockConfirm.mockResolvedValue(false);

      const result = await executeRemoveAction(
        "owner/repo",
        entry,
        manifest,
        "/fake/project",
      );

      expect(result.message).toBe("Cancelled");
    });
  });
});

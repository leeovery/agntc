import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { UpdateCheckResult } from "../../src/update-check.js";
import { ExitSignal } from "../../src/exit-signal.js";

vi.mock("@clack/prompts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clack/prompts")>();
  return {
    ...actual,
    outro: vi.fn(),
    spinner: vi.fn(() => ({
      start: vi.fn(),
      stop: vi.fn(),
      message: vi.fn(),
    })),
    select: vi.fn(),
    isCancel: vi.fn((value: unknown) => typeof value === "symbol"),
    log: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      success: vi.fn(),
      message: vi.fn(),
    },
  };
});

vi.mock("../../src/manifest.js", () => ({
  readManifest: vi.fn(),
  readManifestOrExit: vi.fn(),
  writeManifest: vi.fn(),
  addEntry: vi.fn(),
}));

vi.mock("../../src/update-check-all.js", () => ({
  checkAllForUpdates: vi.fn(),
}));

vi.mock("../../src/update-check.js", () => ({
  checkForUpdate: vi.fn(),
}));

vi.mock("../../src/commands/list-detail.js", () => ({
  renderDetailView: vi.fn(),
}));

vi.mock("../../src/commands/list-update-action.js", () => ({
  executeUpdateAction: vi.fn(),
}));

vi.mock("../../src/commands/list-remove-action.js", () => ({
  executeRemoveAction: vi.fn(),
}));

vi.mock("../../src/commands/list-change-version-action.js", () => ({
  executeChangeVersionAction: vi.fn(),
}));

import * as p from "@clack/prompts";
import { readManifest, readManifestOrExit } from "../../src/manifest.js";
import { checkAllForUpdates } from "../../src/update-check-all.js";
import { checkForUpdate } from "../../src/update-check.js";
import { renderDetailView } from "../../src/commands/list-detail.js";
import { executeUpdateAction } from "../../src/commands/list-update-action.js";
import { executeRemoveAction } from "../../src/commands/list-remove-action.js";
import { executeChangeVersionAction } from "../../src/commands/list-change-version-action.js";
import { runListLoop } from "../../src/commands/list.js";

const mockReadManifest = vi.mocked(readManifest);
const mockReadManifestOrExit = vi.mocked(readManifestOrExit);
const mockCheckAll = vi.mocked(checkAllForUpdates);
const mockCheckForUpdate = vi.mocked(checkForUpdate);
const mockSelect = vi.mocked(p.select);
const mockSpinner = vi.mocked(p.spinner);
const mockOutro = vi.mocked(p.outro);
const mockLog = vi.mocked(p.log);
const mockRenderDetailView = vi.mocked(renderDetailView);
const mockExecuteUpdateAction = vi.mocked(executeUpdateAction);
const mockExecuteRemoveAction = vi.mocked(executeRemoveAction);
const mockExecuteChangeVersionAction = vi.mocked(executeChangeVersionAction);

function makeEntry(
  overrides: Partial<ManifestEntry> = {},
): ManifestEntry {
  return {
    ref: null,
    commit: "abc123",
    installedAt: "2026-01-15T10:00:00.000Z",
    agents: ["claude"],
    files: [],
    cloneUrl: null,
    ...overrides,
  };
}

function makeManifest(keys: string[]): Manifest {
  const manifest: Manifest = {};
  for (const key of keys) {
    manifest[key] = makeEntry();
  }
  return manifest;
}

function setupCheckResults(
  keys: string[],
  status: UpdateCheckResult["status"] = "up-to-date",
): Map<string, UpdateCheckResult> {
  const map = new Map<string, UpdateCheckResult>();
  for (const key of keys) {
    if (status === "up-to-date") {
      map.set(key, { status: "up-to-date" });
    } else if (status === "check-failed") {
      map.set(key, { status: "check-failed", reason: "unknown" });
    }
  }
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
});

describe("runListLoop", () => {
  describe("empty manifest", () => {
    it("shows empty message and exits loop", async () => {
      mockReadManifestOrExit.mockResolvedValue({});

      await runListLoop();

      expect(mockOutro).toHaveBeenCalledWith(
        "No plugins installed. Run npx agntc add owner/repo to get started.",
      );
      expect(mockSelect).not.toHaveBeenCalled();
    });
  });

  describe("Done selection", () => {
    it("exits loop when user selects Done", async () => {
      const manifest = makeManifest(["owner/skill"]);
      mockReadManifestOrExit.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runListLoop();

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockRenderDetailView).not.toHaveBeenCalled();
    });
  });

  describe("cancel", () => {
    it("exits loop when user cancels", async () => {
      const manifest = makeManifest(["owner/skill"]);
      mockReadManifestOrExit.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValue(Symbol("cancel"));

      await runListLoop();

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockRenderDetailView).not.toHaveBeenCalled();
    });
  });

  describe("back from detail", () => {
    it("returns to list when detail view returns back", async () => {
      const manifest = makeManifest(["owner/skill"]);
      mockReadManifestOrExit.mockResolvedValue(manifest);
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        setupCheckResults(["owner/skill"]),
      );
      mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" as const });

      // First iteration: select plugin
      mockSelect.mockResolvedValueOnce("owner/skill");
      // Inner loop reads fresh manifest + checkForUpdate, detail returns "back"
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Second iteration: user selects Done
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockSelect).toHaveBeenCalledTimes(2);
      expect(mockRenderDetailView).toHaveBeenCalledTimes(1);
      // readManifestOrExit: 2 outer, readManifest: 1 inner
      expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
      expect(mockReadManifest).toHaveBeenCalledTimes(1);
    });
  });

  describe("remove action", () => {
    it("returns to list without removed plugin", async () => {
      const fullManifest = makeManifest(["owner/skill-a", "owner/skill-b"]);
      const reducedManifest = makeManifest(["owner/skill-b"]);

      // First outer iteration: full manifest
      mockReadManifestOrExit.mockResolvedValueOnce(fullManifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill-a", "owner/skill-b"]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill-a");

      // Inner loop: re-read manifest, checkForUpdate, render detail -> remove
      mockReadManifest.mockResolvedValueOnce(fullManifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("remove");
      mockExecuteRemoveAction.mockResolvedValueOnce({
        removed: true,
        message: "Removed owner/skill-a",
      });

      // Second outer iteration: reduced manifest
      mockReadManifestOrExit.mockResolvedValueOnce(reducedManifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill-b"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockExecuteRemoveAction).toHaveBeenCalledTimes(1);
      expect(mockLog.success).toHaveBeenCalledWith("Removed owner/skill-a");
      // readManifestOrExit: 2 outer, readManifest: 1 inner
      expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
      expect(mockReadManifest).toHaveBeenCalledTimes(1);
      expect(mockSelect).toHaveBeenCalledTimes(2);
    });
  });

  describe("remove last plugin", () => {
    it("shows empty state message after removing last plugin", async () => {
      const manifest = makeManifest(["owner/only-skill"]);

      // First outer iteration: one plugin
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/only-skill"]),
      );
      mockSelect.mockResolvedValueOnce("owner/only-skill");

      // Inner loop: re-read manifest, checkForUpdate, render detail -> remove
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("remove");
      mockExecuteRemoveAction.mockResolvedValueOnce({
        removed: true,
        message: "Removed owner/only-skill",
      });

      // Second outer iteration: empty manifest
      mockReadManifestOrExit.mockResolvedValueOnce({});

      await runListLoop();

      expect(mockLog.success).toHaveBeenCalledWith("Removed owner/only-skill");
      expect(mockOutro).toHaveBeenCalledWith(
        "No plugins installed. Run npx agntc add owner/repo to get started.",
      );
    });
  });

  describe("update action", () => {
    it("remains in detail view after successful update", async () => {
      const manifest = makeManifest(["owner/skill"]);
      const updatedEntry = makeEntry({ commit: "def456" });
      const updatedManifest: Manifest = { "owner/skill": updatedEntry };

      // Outer loop iteration 1: select plugin
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        new Map([
          ["owner/skill", { status: "update-available" as const, remoteCommit: "def456" }],
        ]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner detail loop iteration 1: re-read manifest, checkForUpdate, render detail -> "update"
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "update-available" as const, remoteCommit: "def456" });
      mockRenderDetailView.mockResolvedValueOnce("update");
      mockExecuteUpdateAction.mockResolvedValueOnce({
        success: true,
        message: "Updated owner/skill",
      });

      // Inner detail loop iteration 2: re-read manifest returns updated entry, user picks "back"
      mockReadManifest.mockResolvedValueOnce(updatedManifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Outer loop iteration 2: Done
      mockReadManifestOrExit.mockResolvedValueOnce(updatedManifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockExecuteUpdateAction).toHaveBeenCalledTimes(1);
      expect(mockLog.success).toHaveBeenCalledWith("Updated owner/skill");
      // Detail view rendered twice (once before update, once after)
      expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
      // readManifestOrExit: 2 outer, readManifest: 2 inner
      expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
      expect(mockReadManifest).toHaveBeenCalledTimes(2);
      expect(mockSelect).toHaveBeenCalledTimes(2);
    });
  });

  describe("change version action", () => {
    it("remains in detail view after successful version change", async () => {
      const entry = makeEntry({ ref: "v1.0.0" });
      const manifest: Manifest = { "owner/skill": entry };
      const updatedEntry = makeEntry({ ref: "v1.1.0", commit: "new123" });
      const updatedManifest: Manifest = { "owner/skill": updatedEntry };

      const updateStatus: UpdateCheckResult = {
        status: "newer-tags",
        tags: ["v1.1.0"],
      };

      // Outer loop iteration 1: select plugin
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        new Map([["owner/skill", updateStatus]]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner detail loop iteration 1: re-read manifest, checkForUpdate, render detail -> "change-version"
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce(updateStatus);
      mockRenderDetailView.mockResolvedValueOnce("change-version");
      mockExecuteChangeVersionAction.mockResolvedValueOnce({
        changed: true,
        message: "Changed owner/skill to v1.1.0",
      });

      // Inner detail loop iteration 2: re-read manifest, user picks "back"
      mockReadManifest.mockResolvedValueOnce(updatedManifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Outer loop iteration 2: Done
      mockReadManifestOrExit.mockResolvedValueOnce(updatedManifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockExecuteChangeVersionAction).toHaveBeenCalledTimes(1);
      expect(mockLog.success).toHaveBeenCalledWith("Changed owner/skill to v1.1.0");
      // Detail view rendered twice (before change, after change)
      expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
      // readManifestOrExit: 2 outer, readManifest: 2 inner
      expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
      expect(mockReadManifest).toHaveBeenCalledTimes(2);
      expect(mockSelect).toHaveBeenCalledTimes(2);
    });
  });

  describe("successive actions", () => {
    it("handles select-back-select-remove-empty flow", async () => {
      const manifest = makeManifest(["owner/skill"]);

      // Outer iteration 1: select plugin
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");
      // Inner loop: re-read manifest, checkForUpdate, back
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Outer iteration 2: select plugin
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");
      // Inner loop: re-read manifest, checkForUpdate, remove
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("remove");
      mockExecuteRemoveAction.mockResolvedValueOnce({
        removed: true,
        message: "Removed owner/skill",
      });

      // Outer iteration 3: empty manifest
      mockReadManifestOrExit.mockResolvedValueOnce({});

      await runListLoop();

      expect(mockSelect).toHaveBeenCalledTimes(2);
      expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
      expect(mockExecuteRemoveAction).toHaveBeenCalledTimes(1);
      expect(mockOutro).toHaveBeenCalledWith(
        "No plugins installed. Run npx agntc add owner/repo to get started.",
      );
    });
  });

  describe("update failure", () => {
    it("remains in detail view on update failure and shows error", async () => {
      const manifest = makeManifest(["owner/skill"]);

      // Outer loop iteration 1: select plugin
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        new Map([
          ["owner/skill", { status: "update-available" as const, remoteCommit: "def456" }],
        ]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner detail loop iteration 1: re-read manifest, checkForUpdate, update fails
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "update-available" as const, remoteCommit: "def456" });
      mockRenderDetailView.mockResolvedValueOnce("update");
      mockExecuteUpdateAction.mockResolvedValueOnce({
        success: false,
        message: "Clone failed",
      });

      // Inner detail loop iteration 2: re-read manifest, user picks "back"
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "update-available" as const, remoteCommit: "def456" });
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Outer loop iteration 2: Done
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockExecuteUpdateAction).toHaveBeenCalledTimes(1);
      expect(mockLog.error).toHaveBeenCalledWith("Clone failed");
      // Detail view rendered twice (before update, after failure)
      expect(mockRenderDetailView).toHaveBeenCalledTimes(2);
      // readManifestOrExit: 2 outer, readManifest: 2 inner
      expect(mockReadManifestOrExit).toHaveBeenCalledTimes(2);
      expect(mockReadManifest).toHaveBeenCalledTimes(2);
      expect(mockSelect).toHaveBeenCalledTimes(2);
    });
  });

  describe("detail view receives correct input", () => {
    it("passes entry and update status from checkForUpdate to detail view", async () => {
      const entry = makeEntry({ ref: "main", commit: "abc123" });
      const manifest: Manifest = { "owner/skill": entry };
      const updateStatus: UpdateCheckResult = {
        status: "update-available",
        remoteCommit: "def456",
      };

      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        new Map([["owner/skill", updateStatus]]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner loop: re-read manifest, checkForUpdate for single plugin, then "back"
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce(updateStatus);
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Second outer iteration: Done
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        new Map([["owner/skill", updateStatus]]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockRenderDetailView).toHaveBeenCalledWith({
        key: "owner/skill",
        entry,
        updateStatus,
      });
    });
  });

  describe("action functions receive correct arguments", () => {
    it("passes fresh entry and manifest to executeUpdateAction", async () => {
      const entry = makeEntry({ commit: "abc123" });
      const manifest: Manifest = { "owner/skill": entry };
      const updateStatus: UpdateCheckResult = {
        status: "update-available",
        remoteCommit: "def456",
      };

      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        new Map([["owner/skill", updateStatus]]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner loop iteration 1: re-read manifest, checkForUpdate, render detail -> update
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce(updateStatus);
      mockRenderDetailView.mockResolvedValueOnce("update");
      mockExecuteUpdateAction.mockResolvedValueOnce({
        success: true,
        message: "Updated owner/skill",
      });

      // Inner loop iteration 2: re-read, back
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Second outer iteration: Done
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockExecuteUpdateAction).toHaveBeenCalledWith(
        "owner/skill",
        entry,
        manifest,
        "/fake/project",
      );
    });

    it("passes fresh entry and manifest to executeRemoveAction", async () => {
      const entry = makeEntry();
      const manifest: Manifest = { "owner/skill": entry };

      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner loop: re-read manifest, checkForUpdate, render detail -> remove
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("remove");
      mockExecuteRemoveAction.mockResolvedValueOnce({
        removed: true,
        message: "Removed owner/skill",
      });

      // Second outer iteration: empty
      mockReadManifestOrExit.mockResolvedValueOnce({});

      await runListLoop();

      expect(mockExecuteRemoveAction).toHaveBeenCalledWith(
        "owner/skill",
        entry,
        manifest,
        "/fake/project",
      );
    });
  });

  describe("spinner behavior", () => {
    it("shows spinner during update checks each outer iteration", async () => {
      const manifest = makeManifest(["owner/skill"]);

      const spinStart = vi.fn();
      const spinStop = vi.fn();
      mockSpinner.mockReturnValue({
        start: spinStart,
        stop: spinStop,
        message: vi.fn(),
      });

      // First outer iteration: back
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");
      // Inner loop: re-read manifest, checkForUpdate, back
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Second outer iteration: Done
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(spinStart).toHaveBeenCalledTimes(2);
      expect(spinStop).toHaveBeenCalledTimes(2);
    });
  });

  describe("label and hint formatting", () => {
    it("shows key@ref when ref is set", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry({ ref: "v2.1.6" }),
      };
      mockReadManifestOrExit.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" as const }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runListLoop();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{
        value: string;
        label: string;
        hint: string;
      }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.label).toBe("owner/skill@v2.1.6");
    });

    it("shows just key when ref is null", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry({ ref: null }),
      };
      mockReadManifestOrExit.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" as const }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runListLoop();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{
        value: string;
        label: string;
        hint: string;
      }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.label).toBe("owner/skill");
    });

    it("shows correct status hints", async () => {
      const manifest: Manifest = {
        "owner/a": makeEntry(),
        "owner/b": makeEntry(),
        "owner/c": makeEntry({ ref: "v1.0.0" }),
        "owner/d": makeEntry(),
        "owner/e": makeEntry({ ref: null, commit: null }),
      };
      mockReadManifestOrExit.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map<string, UpdateCheckResult>([
          ["owner/a", { status: "up-to-date" }],
          ["owner/b", { status: "update-available", remoteCommit: "x" }],
          ["owner/c", { status: "newer-tags", tags: ["v1.1.0"] }],
          ["owner/d", { status: "check-failed", reason: "timeout" }],
          ["owner/e", { status: "local" }],
        ]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runListLoop();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{
        value: string;
        label: string;
        hint: string;
      }>;

      expect(options.find((o) => o.value === "owner/a")!.hint).toBe(
        "\u2713 Up to date",
      );
      expect(options.find((o) => o.value === "owner/b")!.hint).toBe(
        "\u2191 Update available",
      );
      expect(options.find((o) => o.value === "owner/c")!.hint).toBe(
        "\u2691 Newer tags available",
      );
      expect(options.find((o) => o.value === "owner/d")!.hint).toBe(
        "\u2717 Check failed",
      );
      expect(options.find((o) => o.value === "owner/e")!.hint).toBe(
        "\u25CF Local",
      );
    });
  });

  describe("error handling", () => {
    it("throws ExitSignal on manifest read failure", async () => {
      mockReadManifestOrExit.mockRejectedValue(new ExitSignal(1));

      const err = await runListLoop().catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
    });
  });

  describe("update refreshes detail view with new data", () => {
    it("passes updated entry to detail view after successful update", async () => {
      const originalEntry = makeEntry({ commit: "abc123", ref: "main" });
      const manifest: Manifest = { "owner/skill": originalEntry };
      const updatedEntry = makeEntry({ commit: "def456", ref: "main" });
      const updatedManifest: Manifest = { "owner/skill": updatedEntry };

      // Outer loop iteration 1
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        new Map([
          ["owner/skill", { status: "update-available" as const, remoteCommit: "def456" }],
        ]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner detail loop iteration 1: re-read manifest (returns original), checkForUpdate, update
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "update-available" as const, remoteCommit: "def456" });
      mockRenderDetailView.mockResolvedValueOnce("update");
      mockExecuteUpdateAction.mockResolvedValueOnce({
        success: true,
        message: "Updated owner/skill",
      });

      // Inner detail loop iteration 2: re-read manifest (returns updated), checkForUpdate, back
      mockReadManifest.mockResolvedValueOnce(updatedManifest);
      const newUpdateStatus: UpdateCheckResult = { status: "up-to-date" };
      mockCheckForUpdate.mockResolvedValueOnce(newUpdateStatus);
      mockRenderDetailView.mockResolvedValueOnce("back");

      // Outer loop iteration 2: Done
      mockReadManifestOrExit.mockResolvedValueOnce(updatedManifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      // First detail render: original entry with update-available status
      expect(mockRenderDetailView).toHaveBeenNthCalledWith(1, {
        key: "owner/skill",
        entry: originalEntry,
        updateStatus: { status: "update-available", remoteCommit: "def456" },
      });

      // Second detail render: updated entry with fresh status
      expect(mockRenderDetailView).toHaveBeenNthCalledWith(2, {
        key: "owner/skill",
        entry: updatedEntry,
        updateStatus: newUpdateStatus,
      });
    });
  });

  describe("remove cancelled does not show success", () => {
    it("does not show success message when remove is cancelled", async () => {
      const manifest = makeManifest(["owner/skill"]);

      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("owner/skill");

      // Inner loop: re-read manifest, checkForUpdate, render detail -> remove (cancelled)
      mockReadManifest.mockResolvedValueOnce(manifest);
      mockCheckForUpdate.mockResolvedValueOnce({ status: "up-to-date" as const });
      mockRenderDetailView.mockResolvedValueOnce("remove");
      mockExecuteRemoveAction.mockResolvedValueOnce({
        removed: false,
        message: "Cancelled",
      });

      // Remove cancelled -> breaks inner loop, returns to outer list
      // Second outer iteration: Done
      mockReadManifestOrExit.mockResolvedValueOnce(manifest);
      mockCheckAll.mockResolvedValueOnce(
        setupCheckResults(["owner/skill"]),
      );
      mockSelect.mockResolvedValueOnce("__done__");

      await runListLoop();

      expect(mockLog.success).not.toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest } from "../../src/manifest.js";
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
}));

vi.mock("../../src/update-check-all.js", () => ({
  checkAllForUpdates: vi.fn(),
}));

import * as p from "@clack/prompts";
import { readManifest } from "../../src/manifest.js";
import { checkAllForUpdates } from "../../src/update-check-all.js";
import { runList } from "../../src/commands/list.js";

const mockReadManifest = vi.mocked(readManifest);
const mockCheckAll = vi.mocked(checkAllForUpdates);
const mockSelect = vi.mocked(p.select);
const mockSpinner = vi.mocked(p.spinner);
const mockOutro = vi.mocked(p.outro);
const mockLog = vi.mocked(p.log);

function makeEntry(overrides: Partial<import("../../src/manifest.js").ManifestEntry> = {}): import("../../src/manifest.js").ManifestEntry {
  return {
    ref: null,
    commit: "abc123",
    installedAt: "2026-01-15T10:00:00.000Z",
    agents: ["claude"],
    files: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
});

describe("list command", () => {
  describe("empty state", () => {
    it("shows empty message and returns null for empty manifest", async () => {
      mockReadManifest.mockResolvedValue({});

      const result = await runList();

      expect(mockOutro).toHaveBeenCalledWith(
        "No plugins installed. Run npx agntc add owner/repo to get started.",
      );
      expect(result).toBeNull();
    });
  });

  describe("spinner", () => {
    it("shows spinner during update checks", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      const spinStart = vi.fn();
      const spinStop = vi.fn();
      mockSpinner.mockReturnValue({
        start: spinStart,
        stop: spinStop,
        message: vi.fn(),
      });

      await runList();

      expect(spinStart).toHaveBeenCalledWith("Checking for updates...");
      expect(spinStop).toHaveBeenCalledWith("Update checks complete.");
    });
  });

  describe("status indicators", () => {
    it("shows up-to-date hint", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry({ ref: "main" }),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.hint).toBe("\u2713 Up to date");
    });

    it("shows update-available hint", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([
          [
            "owner/skill",
            { status: "update-available", remoteCommit: "def456" },
          ],
        ]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.hint).toBe("\u2191 Update available");
    });

    it("shows newer-tags hint", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry({ ref: "v1.0.0" }),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([
          ["owner/skill", { status: "newer-tags", tags: ["v1.1.0"] }],
        ]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.hint).toBe("\u2691 Newer tags available");
    });

    it("shows check-failed hint", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([
          ["owner/skill", { status: "check-failed", reason: "timeout" }],
        ]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.hint).toBe("\u2717 Check failed");
    });

    it("shows local hint", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry({ ref: null, commit: null }),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "local" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.hint).toBe("\u25CF Local");
    });
  });

  describe("label formatting", () => {
    it("shows key@ref when ref is set (tag-pinned)", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry({ ref: "v2.1.6" }),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.label).toBe("owner/skill@v2.1.6");
    });

    it("shows just key when ref is null (HEAD-tracking)", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry({ ref: null }),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.label).toBe("owner/skill");
    });
  });

  describe("Done option", () => {
    it("Done option is at the bottom of the list", async () => {
      const manifest: Manifest = {
        "owner/skill-a": makeEntry(),
        "owner/skill-b": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([
          ["owner/skill-a", { status: "up-to-date" }],
          ["owner/skill-b", { status: "up-to-date" }],
        ]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const lastOption = options[options.length - 1];
      expect(lastOption!.value).toBe("__done__");
      expect(lastOption!.label).toBe("Done");
    });

    it("selecting Done returns null", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      const result = await runList();

      expect(result).toBeNull();
    });
  });

  describe("cancel", () => {
    it("cancel returns null", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue(Symbol("cancel"));

      const result = await runList();

      expect(result).toBeNull();
    });
  });

  describe("selection", () => {
    it("selecting a plugin returns its key", async () => {
      const manifest: Manifest = {
        "owner/skill-a": makeEntry(),
        "owner/skill-b": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([
          ["owner/skill-a", { status: "up-to-date" }],
          ["owner/skill-b", { status: "up-to-date" }],
        ]),
      );
      mockSelect.mockResolvedValue("owner/skill-b");

      const result = await runList();

      expect(result).toBe("owner/skill-b");
    });
  });

  describe("single plugin", () => {
    it("single plugin still shows full list with Done", async () => {
      const manifest: Manifest = {
        "owner/only-skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/only-skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      expect(options).toHaveLength(2);
      expect(options[0]!.value).toBe("owner/only-skill");
      expect(options[1]!.value).toBe("__done__");
    });
  });

  describe("all-local plugins", () => {
    it("all-local plugins show local hint for each", async () => {
      const manifest: Manifest = {
        "owner/local-a": makeEntry({ ref: null, commit: null }),
        "owner/local-b": makeEntry({ ref: null, commit: null }),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([
          ["owner/local-a", { status: "local" }],
          ["owner/local-b", { status: "local" }],
        ]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOptions = options.filter((o) => o.value !== "__done__");
      for (const opt of pluginOptions) {
        expect(opt.hint).toBe("\u25CF Local");
      }
    });
  });

  describe("error handling", () => {
    it("shows error and throws ExitSignal on manifest read failure", async () => {
      mockReadManifest.mockRejectedValue(new SyntaxError("Unexpected token"));

      const err = await runList().catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read manifest:"),
      );
    });
  });

  describe("fallback for missing check result", () => {
    it("uses check-failed when result missing from map", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(new Map());
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      const options = selectCall.options as Array<{ value: string; label: string; hint: string }>;
      const pluginOption = options.find((o) => o.value === "owner/skill");
      expect(pluginOption!.hint).toBe("\u2717 Check failed");
    });
  });

  describe("integration", () => {
    it("calls readManifest with cwd", async () => {
      mockReadManifest.mockResolvedValue({});

      await runList();

      expect(mockReadManifest).toHaveBeenCalledWith("/fake/project");
    });

    it("passes manifest to checkAllForUpdates", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      expect(mockCheckAll).toHaveBeenCalledWith(manifest);
    });

    it("select message is correct", async () => {
      const manifest: Manifest = {
        "owner/skill": makeEntry(),
      };
      mockReadManifest.mockResolvedValue(manifest);
      mockCheckAll.mockResolvedValue(
        new Map([["owner/skill", { status: "up-to-date" }]]),
      );
      mockSelect.mockResolvedValue("__done__");

      await runList();

      const selectCall = mockSelect.mock.calls[0]![0];
      expect(selectCall.message).toBe("Select a plugin to manage");
    });
  });
});

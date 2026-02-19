import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest } from "../../src/manifest.js";
import { ExitSignal } from "../../src/exit-signal.js";

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
}));

vi.mock("../../src/manifest.js", () => ({
  readManifest: vi.fn(),
}));

import * as p from "@clack/prompts";
import { readManifest } from "../../src/manifest.js";
import { runList } from "../../src/commands/list.js";

const mockReadManifest = vi.mocked(readManifest);
const mockIntro = vi.mocked(p.intro);
const mockOutro = vi.mocked(p.outro);
const mockLog = vi.mocked(p.log);

let mockCwd: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockCwd = vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
});

describe("list command", () => {
  describe("empty state", () => {
    it("shows empty message for empty manifest", async () => {
      mockReadManifest.mockResolvedValue({});

      await runList().catch(() => {});

      expect(mockOutro).toHaveBeenCalledWith(
        "No plugins installed. Run npx agntc add owner/repo to get started.",
      );
    });

    it("shows empty message for missing manifest", async () => {
      mockReadManifest.mockResolvedValue({});

      await runList().catch(() => {});

      expect(mockOutro).toHaveBeenCalledWith(
        "No plugins installed. Run npx agntc add owner/repo to get started.",
      );
    });

    it("exits 0 on empty manifest", async () => {
      mockReadManifest.mockResolvedValue({});

      await expect(runList()).resolves.toBeUndefined();
    });
  });

  describe("single plugin display", () => {
    it("displays plugin with key, ref, agents, and date", async () => {
      const manifest: Manifest = {
        "owner/my-skill": {
          ref: "v2.1.6",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/my-skill/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const pluginLine = logCalls.find((line) =>
        line.includes("owner/my-skill"),
      );
      expect(pluginLine).toBeDefined();
      expect(pluginLine).toContain("@v2.1.6");
      expect(pluginLine).toContain("claude");
      expect(pluginLine).toContain("2026-01-15");
    });
  });

  describe("multiple plugins display", () => {
    it("displays all plugins", async () => {
      const manifest: Manifest = {
        "owner/skill-a": {
          ref: "main",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [".claude/skills/skill-a/"],
        },
        "owner/skill-b": {
          ref: "v1.0.0",
          commit: "def456",
          installedAt: "2026-01-16T10:00:00.000Z",
          agents: ["codex"],
          files: [".codex/skills/skill-b/"],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      expect(logCalls.some((line) => line.includes("owner/skill-a"))).toBe(
        true,
      );
      expect(logCalls.some((line) => line.includes("owner/skill-b"))).toBe(
        true,
      );
    });
  });

  describe("version display", () => {
    it("shows ref as tag (@v2.1.6)", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: "v2.1.6",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const pluginLine = logCalls.find((line) => line.includes("owner/skill"));
      expect(pluginLine).toContain("@v2.1.6");
    });

    it("shows ref as branch (@main)", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: "main",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const pluginLine = logCalls.find((line) => line.includes("owner/skill"));
      expect(pluginLine).toContain("@main");
    });

    it("shows HEAD when ref null and commit exists", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: null,
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const pluginLine = logCalls.find((line) => line.includes("owner/skill"));
      expect(pluginLine).toContain("HEAD");
    });

    it("shows local when both ref and commit are absent", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: null,
          commit: "",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const pluginLine = logCalls.find((line) => line.includes("owner/skill"));
      expect(pluginLine).toContain("local");
    });
  });

  describe("agents display", () => {
    it("shows comma-separated agents", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: "main",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude", "codex"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const pluginLine = logCalls.find((line) => line.includes("owner/skill"));
      expect(pluginLine).toContain("claude, codex");
    });

    it("shows single agent without comma", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: "main",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      const logCalls = mockLog.message.mock.calls.map((c) => c[0] as string);
      const pluginLine = logCalls.find((line) => line.includes("owner/skill"));
      expect(pluginLine).toContain("claude");
      expect(pluginLine).not.toContain(",");
    });
  });

  describe("error handling", () => {
    it("shows error on malformed JSON", async () => {
      mockReadManifest.mockRejectedValue(new SyntaxError("Unexpected token"));

      const err = await runList().catch((e) => e);

      expect(err).toBeInstanceOf(ExitSignal);
      expect((err as ExitSignal).code).toBe(1);
      expect(mockLog.error).toHaveBeenCalledWith(
        expect.stringContaining("Failed to read manifest:"),
      );
    });
  });

  describe("integration", () => {
    it("calls readManifest with cwd", async () => {
      mockReadManifest.mockResolvedValue({});

      await runList().catch(() => {});

      expect(mockReadManifest).toHaveBeenCalledWith("/fake/project");
    });

    it("uses clack intro", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: "main",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      expect(mockIntro).toHaveBeenCalledWith("Installed plugins");
    });

    it("uses clack outro on success", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: "main",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await runList().catch(() => {});

      expect(mockOutro).toHaveBeenCalled();
    });

    it("exits 0 on success with plugins", async () => {
      const manifest: Manifest = {
        "owner/skill": {
          ref: "main",
          commit: "abc123",
          installedAt: "2026-01-15T10:00:00.000Z",
          agents: ["claude"],
          files: [],
        },
      };
      mockReadManifest.mockResolvedValue(manifest);

      await expect(runList()).resolves.toBeUndefined();
    });
  });
});

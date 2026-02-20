import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/drivers/registry.js", () => ({
  getDriver: vi.fn(),
}));

import { getDriver } from "../src/drivers/registry.js";
import type { AgentId, AssetType } from "../src/drivers/types.js";
import type { AssetCounts } from "../src/copy-plugin-assets.js";
import {
  formatRefLabel,
  formatPluginSummary,
  formatBareSkillSummary,
  renderAddSummary,
  renderCollectionAddSummary,
  renderGitUpdateSummary,
  renderLocalUpdateSummary,
  renderUpdateOutcomeSummary,
  renderRemoveSummary,
} from "../src/summary.js";

const mockGetDriver = vi.mocked(getDriver);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetDriver.mockImplementation((id: AgentId) => ({
    detect: vi.fn(),
    getTargetDir: (assetType: AssetType) => {
      if (id === "claude") return `.claude/${assetType}/`;
      if (id === "codex") return `.codex/${assetType}/`;
      return null;
    },
  }));
});

describe("formatRefLabel", () => {
  it("returns ref when ref is not null", () => {
    expect(formatRefLabel("v2.1.6", "abc1234")).toBe("v2.1.6");
  });

  it("returns 'local' when ref is null and commit is null", () => {
    expect(formatRefLabel(null, null)).toBe("local");
  });

  it("returns 'HEAD' when ref is null and commit is present", () => {
    expect(formatRefLabel(null, "abc1234def5678")).toBe("HEAD");
  });
});

describe("formatPluginSummary", () => {
  it("formats per-agent asset counts", () => {
    const assetCounts: Partial<Record<AgentId, AssetCounts>> = {
      claude: { skills: 12, agents: 3, hooks: 2 },
      codex: { skills: 12 },
    };
    const result = formatPluginSummary(
      ["claude", "codex"],
      assetCounts,
    );
    expect(result).toBe(
      "claude: 12 skill(s), 3 agent(s), 2 hook(s), codex: 12 skill(s)",
    );
  });

  it("omits zero-count asset types", () => {
    const assetCounts: Partial<Record<AgentId, AssetCounts>> = {
      claude: { skills: 5, agents: 0, hooks: 0 },
    };
    const result = formatPluginSummary(
      ["claude"],
      assetCounts,
    );
    expect(result).toBe("claude: 5 skill(s)");
  });

  it("omits agents with no non-zero counts", () => {
    const assetCounts: Partial<Record<AgentId, AssetCounts>> = {
      claude: { skills: 3 },
      codex: { skills: 0, agents: 0 },
    };
    const result = formatPluginSummary(
      ["claude", "codex"],
      assetCounts,
    );
    expect(result).toBe("claude: 3 skill(s)");
  });

  it("omits agents not in assetCountsByAgent", () => {
    const assetCounts: Partial<Record<AgentId, AssetCounts>> = {
      claude: { skills: 2 },
    };
    const result = formatPluginSummary(
      ["claude", "codex"],
      assetCounts,
    );
    expect(result).toBe("claude: 2 skill(s)");
  });
});

describe("formatBareSkillSummary", () => {
  it("counts files per agent based on target dir prefix", () => {
    const copiedFiles = [
      ".claude/skills/my-skill/file1.md",
      ".claude/skills/my-skill/file2.md",
      ".codex/skills/my-skill/file1.md",
    ];
    const result = formatBareSkillSummary(
      ["claude", "codex"],
      copiedFiles,
    );
    expect(result).toBe("claude: 2 skill(s), codex: 1 skill(s)");
  });

  it("shows zero for agent with no matching files", () => {
    const copiedFiles = [".claude/skills/my-skill/file1.md"];
    const result = formatBareSkillSummary(
      ["claude", "codex"],
      copiedFiles,
    );
    expect(result).toBe("claude: 1 skill(s), codex: 0 skill(s)");
  });
});

describe("renderAddSummary", () => {
  it("formats standalone plugin add with key, ref, and agent counts", () => {
    const assetCounts: Partial<Record<AgentId, AssetCounts>> = {
      claude: { skills: 12, agents: 3, hooks: 2 },
      codex: { skills: 12 },
    };
    const result = renderAddSummary({
      manifestKey: "leeovery/claude-technical-workflows",
      ref: "v2.1.6",
      commit: "abc1234",
      detectedType: "plugin",
      selectedAgents: ["claude", "codex"],
      assetCountsByAgent: assetCounts,
      copiedFiles: [],
    });
    expect(result).toBe(
      "Installed leeovery/claude-technical-workflows@v2.1.6 — claude: 12 skill(s), 3 agent(s), 2 hook(s), codex: 12 skill(s)",
    );
  });

  it("formats bare skill add with per-agent file counts", () => {
    const result = renderAddSummary({
      manifestKey: "owner/my-skill",
      ref: "main",
      commit: "abc123def456",
      detectedType: "bare-skill",
      selectedAgents: ["claude"],
      copiedFiles: [".claude/skills/my-skill/file1.md"],
    });
    expect(result).toBe(
      "Installed owner/my-skill@main — claude: 1 skill(s)",
    );
  });

  it("uses HEAD label when ref is null with commit", () => {
    const result = renderAddSummary({
      manifestKey: "owner/my-skill",
      ref: null,
      commit: "abc123",
      detectedType: "bare-skill",
      selectedAgents: ["claude"],
      copiedFiles: [".claude/skills/my-skill/file1.md"],
    });
    expect(result).toContain("owner/my-skill@HEAD");
  });

  it("uses local label when ref and commit are null", () => {
    const result = renderAddSummary({
      manifestKey: "owner/my-skill",
      ref: null,
      commit: null,
      detectedType: "bare-skill",
      selectedAgents: ["claude"],
      copiedFiles: [".claude/skills/my-skill/file1.md"],
    });
    expect(result).toContain("owner/my-skill@local");
  });
});

describe("renderCollectionAddSummary", () => {
  it("shows per-plugin summaries for installed plugins", () => {
    const results = [
      {
        pluginName: "pluginA",
        status: "installed" as const,
        copiedFiles: [".claude/skills/pluginA/file1.md"],
        detectedType: { type: "bare-skill" as const },
      },
      {
        pluginName: "pluginB",
        status: "installed" as const,
        copiedFiles: [
          ".claude/skills/pluginB/file1.md",
          ".codex/skills/pluginB/file1.md",
        ],
        detectedType: { type: "bare-skill" as const },
      },
    ];
    const result = renderCollectionAddSummary({
      manifestKey: "owner/my-collection",
      ref: "main",
      commit: "abc123",
      selectedAgents: ["claude", "codex"],
      results,
    });
    expect(result).toContain("pluginA");
    expect(result).toContain("pluginB");
    expect(result).toContain("Installed owner/my-collection@main");
  });

  it("notes skipped plugins", () => {
    const results = [
      {
        pluginName: "pluginA",
        status: "installed" as const,
        copiedFiles: [".claude/skills/pluginA/file1.md"],
        detectedType: { type: "bare-skill" as const },
      },
      {
        pluginName: "pluginB",
        status: "skipped" as const,
        copiedFiles: [],
      },
    ];
    const result = renderCollectionAddSummary({
      manifestKey: "owner/my-collection",
      ref: "main",
      commit: "abc123",
      selectedAgents: ["claude"],
      results,
    });
    expect(result).toMatch(/1 skipped/);
  });

  it("notes failed plugins with error messages", () => {
    const results = [
      {
        pluginName: "pluginA",
        status: "failed" as const,
        copiedFiles: [],
        errorMessage: "permission denied",
      },
    ];
    const result = renderCollectionAddSummary({
      manifestKey: "owner/my-collection",
      ref: "main",
      commit: "abc123",
      selectedAgents: ["claude"],
      results,
    });
    expect(result).toMatch(/pluginA: failed — permission denied/);
  });

  it("handles mixed outcomes: installed, skipped, and failed", () => {
    const results = [
      {
        pluginName: "pluginA",
        status: "installed" as const,
        copiedFiles: [".claude/skills/pluginA/file1.md"],
        detectedType: { type: "bare-skill" as const },
      },
      {
        pluginName: "pluginB",
        status: "skipped" as const,
        copiedFiles: [],
      },
      {
        pluginName: "pluginC",
        status: "failed" as const,
        copiedFiles: [],
        errorMessage: "disk full",
      },
    ];
    const result = renderCollectionAddSummary({
      manifestKey: "owner/my-collection",
      ref: "v1.0",
      commit: "abc123",
      selectedAgents: ["claude"],
      results,
    });
    expect(result).toContain("pluginA");
    expect(result).toMatch(/1 skipped/);
    expect(result).toMatch(/pluginC: failed — disk full/);
  });

  it("shows plugin summary for plugin-type results with asset counts", () => {
    const results = [
      {
        pluginName: "pluginA",
        status: "installed" as const,
        copiedFiles: [],
        assetCountsByAgent: {
          claude: { skills: 5, agents: 2 },
        } as Partial<Record<AgentId, AssetCounts>>,
        detectedType: { type: "plugin" as const },
      },
    ];
    const result = renderCollectionAddSummary({
      manifestKey: "owner/my-collection",
      ref: "main",
      commit: "abc123",
      selectedAgents: ["claude"],
      results,
    });
    expect(result).toContain("pluginA: claude: 5 skill(s), 2 agent(s)");
  });
});

describe("renderGitUpdateSummary", () => {
  it("shows commit transition and file count", () => {
    const result = renderGitUpdateSummary({
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      copiedFiles: [".claude/skills/my-skill/file1.md"],
      effectiveAgents: ["claude"],
      droppedAgents: [],
    });
    expect(result).toBe(
      "Updated owner/repo: abc1234 -> def4567 — 1 file(s) for claude",
    );
  });

  it("includes dropped agent info when agents are dropped", () => {
    const result = renderGitUpdateSummary({
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      copiedFiles: [".claude/skills/my-skill/file1.md"],
      effectiveAgents: ["claude"],
      droppedAgents: ["codex"],
    });
    expect(result).toContain(
      "codex support removed by plugin author.",
    );
  });

  it("uses 'unknown' when old commit is null", () => {
    const result = renderGitUpdateSummary({
      key: "owner/repo",
      oldCommit: null,
      newCommit: "def4567890abc",
      copiedFiles: [],
      effectiveAgents: ["claude"],
      droppedAgents: [],
    });
    expect(result).toContain("unknown -> def4567");
  });

  it("shows multiple effective agents joined", () => {
    const result = renderGitUpdateSummary({
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      copiedFiles: [".claude/skills/x", ".codex/skills/x"],
      effectiveAgents: ["claude", "codex"],
      droppedAgents: [],
    });
    expect(result).toContain("2 file(s) for claude, codex");
  });
});

describe("renderLocalUpdateSummary", () => {
  it("shows refreshed with file count and agents", () => {
    const result = renderLocalUpdateSummary({
      key: "/path/to/plugin",
      copiedFiles: [".claude/skills/my-skill/file1.md", ".claude/skills/my-skill/file2.md"],
      effectiveAgents: ["claude"],
      droppedAgents: [],
    });
    expect(result).toBe(
      "Refreshed /path/to/plugin — 2 file(s) for claude",
    );
  });

  it("includes dropped agent info", () => {
    const result = renderLocalUpdateSummary({
      key: "/path/to/plugin",
      copiedFiles: [".claude/skills/my-skill/file1.md"],
      effectiveAgents: ["claude"],
      droppedAgents: ["codex"],
    });
    expect(result).toContain(
      "codex support removed by plugin author.",
    );
  });
});

describe("renderUpdateOutcomeSummary", () => {
  it("formats git update outcome with commit transition", () => {
    const result = renderUpdateOutcomeSummary({
      type: "git-update",
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      droppedAgents: [],
    });
    expect(result).toBe("owner/repo: Updated abc1234 -> def4567");
  });

  it("includes dropped agents in git update outcome", () => {
    const result = renderUpdateOutcomeSummary({
      type: "git-update",
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      droppedAgents: ["codex"],
    });
    expect(result).toContain(
      "codex support removed by plugin author",
    );
  });

  it("formats local update outcome", () => {
    const result = renderUpdateOutcomeSummary({
      type: "local-update",
      key: "/path/to/plugin",
      droppedAgents: [],
    });
    expect(result).toBe(
      "/path/to/plugin: Refreshed from local path",
    );
  });

  it("includes dropped agents in local update outcome", () => {
    const result = renderUpdateOutcomeSummary({
      type: "local-update",
      key: "/path/to/plugin",
      droppedAgents: ["codex"],
    });
    expect(result).toContain(
      "codex support removed by plugin author",
    );
  });
});

describe("renderRemoveSummary", () => {
  it("shows key and file count", () => {
    const result = renderRemoveSummary({
      summaryLabel: "owner/repo",
      fileCount: 5,
    });
    expect(result).toBe("Removed owner/repo — 5 file(s)");
  });

  it("shows count label for multiple plugins", () => {
    const result = renderRemoveSummary({
      summaryLabel: "3 plugin(s)",
      fileCount: 12,
    });
    expect(result).toBe("Removed 3 plugin(s) — 12 file(s)");
  });

  it("handles zero files", () => {
    const result = renderRemoveSummary({
      summaryLabel: "owner/repo",
      fileCount: 0,
    });
    expect(result).toBe("Removed owner/repo — 0 file(s)");
  });
});

describe("edge cases", () => {
  it("single plugin in collection produces concise summary", () => {
    const results = [
      {
        pluginName: "myPlugin",
        status: "installed" as const,
        copiedFiles: [".claude/skills/myPlugin/file1.md"],
        detectedType: { type: "bare-skill" as const },
      },
    ];
    const result = renderCollectionAddSummary({
      manifestKey: "owner/my-collection",
      ref: "main",
      commit: "abc123",
      selectedAgents: ["claude"],
      results,
    });
    expect(result).toContain("myPlugin");
    // Should be a single concise string, not spread across many parts
    expect(result).toMatch(/^Installed /);
  });

  it("all up-to-date produces no crashed output from outcome formatter", () => {
    // This tests that we can call the outcome formatter with various statuses
    // without crashes; the actual "all up to date" message is in the command layer
    const gitResult = renderUpdateOutcomeSummary({
      type: "git-update",
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      droppedAgents: [],
    });
    expect(gitResult).toBeTruthy();
  });

  it("multiple dropped agents listed in git update summary", () => {
    const result = renderGitUpdateSummary({
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      copiedFiles: [],
      effectiveAgents: ["claude"],
      droppedAgents: ["codex", "cursor"],
    });
    expect(result).toContain("codex, cursor support removed by plugin author.");
  });

  it("multiple dropped agents listed in outcome summary", () => {
    const result = renderUpdateOutcomeSummary({
      type: "git-update",
      key: "owner/repo",
      oldCommit: "abc1234567890",
      newCommit: "def4567890abc",
      droppedAgents: ["codex", "cursor"],
    });
    expect(result).toContain("codex, cursor support removed by plugin author");
  });
});

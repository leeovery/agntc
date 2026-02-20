import { describe, it, expect } from "vitest";
import { identifyFileOwnership } from "../../src/drivers/identify.js";

describe("identifyFileOwnership", () => {
  it("identifies .claude/skills/foo as claude skills", () => {
    const result = identifyFileOwnership(".claude/skills/foo");

    expect(result).toEqual({ agentId: "claude", assetType: "skills" });
  });

  it("identifies .claude/skills/foo/SKILL.md as claude skills", () => {
    const result = identifyFileOwnership(".claude/skills/foo/SKILL.md");

    expect(result).toEqual({ agentId: "claude", assetType: "skills" });
  });

  it("identifies .claude/agents/executor.md as claude agents", () => {
    const result = identifyFileOwnership(".claude/agents/executor.md");

    expect(result).toEqual({ agentId: "claude", assetType: "agents" });
  });

  it("identifies .claude/hooks/pre-commit.sh as claude hooks", () => {
    const result = identifyFileOwnership(".claude/hooks/pre-commit.sh");

    expect(result).toEqual({ agentId: "claude", assetType: "hooks" });
  });

  it("identifies .agents/skills/foo/SKILL.md as codex skills", () => {
    const result = identifyFileOwnership(".agents/skills/foo/SKILL.md");

    expect(result).toEqual({ agentId: "codex", assetType: "skills" });
  });

  it("returns null for an unrecognized path", () => {
    const result = identifyFileOwnership("some/random/file.txt");

    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = identifyFileOwnership("");

    expect(result).toBeNull();
  });

  it("uses startsWith matching not substring includes", () => {
    // A path like "foo/.claude/skills/bar" should NOT match
    // because it doesn't start with the target dir
    const result = identifyFileOwnership("foo/.claude/skills/bar");

    expect(result).toBeNull();
  });
});

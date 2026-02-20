import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs/promises";
import { copyBareSkill } from "../src/copy-bare-skill.js";
import type { AgentDriver } from "../src/drivers/types.js";

vi.mock("node:fs/promises");
vi.mock("../src/copy-rollback.js");

const mockedFs = vi.mocked(fs);

import { rollbackCopiedFiles } from "../src/copy-rollback.js";

const mockedRollback = vi.mocked(rollbackCopiedFiles);

function makeDriver(targetDir: string | null): AgentDriver {
  return {
    detect: async () => true,
    getTargetDir: () => targetDir,
  };
}

describe("copyBareSkill rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFs.mkdir.mockResolvedValue(undefined);
    mockedFs.cp.mockResolvedValue(undefined);
    mockedFs.access.mockRejectedValue(new Error("ENOENT")); // agntc.json doesn't exist
    mockedFs.rm.mockResolvedValue(undefined);
    mockedRollback.mockResolvedValue(undefined);
  });

  it("rolls back already-copied files when cp fails on second agent", async () => {
    const copyError = new Error("disk full");
    mockedFs.cp
      .mockResolvedValueOnce(undefined) // first agent succeeds
      .mockRejectedValueOnce(copyError); // second agent fails

    await expect(
      copyBareSkill({
        sourceDir: "/source/my-skill",
        projectDir: "/project",
        agents: [
          { id: "claude", driver: makeDriver(".claude/skills") },
          { id: "codex", driver: makeDriver(".codex/skills") },
        ],
      }),
    ).rejects.toThrow("disk full");

    expect(mockedRollback).toHaveBeenCalledOnce();
    expect(mockedRollback).toHaveBeenCalledWith(
      [".claude/skills/my-skill/"],
      "/project",
    );
  });

  it("re-throws the original error after rollback", async () => {
    const originalError = new Error("copy failed");
    mockedFs.cp.mockRejectedValueOnce(originalError);

    const thrownError = await copyBareSkill({
      sourceDir: "/source/my-skill",
      projectDir: "/project",
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    }).catch((e) => e);

    expect(thrownError).toBe(originalError);
  });

  it("does not call rollback on success", async () => {
    await copyBareSkill({
      sourceDir: "/source/my-skill",
      projectDir: "/project",
      agents: [{ id: "claude", driver: makeDriver(".claude/skills") }],
    });

    expect(mockedRollback).not.toHaveBeenCalled();
  });
});

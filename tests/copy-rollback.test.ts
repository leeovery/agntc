import { describe, it, expect, vi, beforeEach } from "vitest";
import { rm } from "node:fs/promises";
import { rollbackCopiedFiles } from "../src/copy-rollback.js";

vi.mock("node:fs/promises", () => ({
  rm: vi.fn(),
}));

const mockedRm = vi.mocked(rm);

describe("rollbackCopiedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes each file in the list using rm with recursive+force", async () => {
    mockedRm.mockResolvedValue(undefined);

    await rollbackCopiedFiles(
      [".claude/skills/my-skill/", ".codex/skills/my-skill/"],
      "/project",
    );

    expect(mockedRm).toHaveBeenCalledTimes(2);
    expect(mockedRm).toHaveBeenCalledWith("/project/.claude/skills/my-skill/", {
      recursive: true,
      force: true,
    });
    expect(mockedRm).toHaveBeenCalledWith("/project/.codex/skills/my-skill/", {
      recursive: true,
      force: true,
    });
  });

  it("handles empty file list without error", async () => {
    await rollbackCopiedFiles([], "/project");

    expect(mockedRm).not.toHaveBeenCalled();
  });

  it("continues deleting remaining files when one rm fails", async () => {
    mockedRm
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce(undefined);

    await rollbackCopiedFiles(
      ["file-a", "file-b"],
      "/project",
    );

    expect(mockedRm).toHaveBeenCalledTimes(2);
    expect(mockedRm).toHaveBeenCalledWith("/project/file-b", {
      recursive: true,
      force: true,
    });
  });

  it("calls onWarn callback for non-ENOENT rm errors", async () => {
    mockedRm.mockRejectedValueOnce(new Error("permission denied"));
    const onWarn = vi.fn();

    await rollbackCopiedFiles(["fail-file"], "/project", onWarn);

    expect(onWarn).toHaveBeenCalledOnce();
    expect(onWarn).toHaveBeenCalledWith(
      "Rollback: failed to delete fail-file: permission denied",
    );
  });

  it("calls onWarn with stringified error for non-Error throws", async () => {
    mockedRm.mockRejectedValueOnce("string-error");
    const onWarn = vi.fn();

    await rollbackCopiedFiles(["fail-file"], "/project", onWarn);

    expect(onWarn).toHaveBeenCalledWith(
      "Rollback: failed to delete fail-file: string-error",
    );
  });

  it("does not call onWarn when no callback provided", async () => {
    mockedRm.mockRejectedValueOnce(new Error("some error"));

    // Should not throw — silently swallows error when no callback
    await expect(
      rollbackCopiedFiles(["fail-file"], "/project"),
    ).resolves.toBeUndefined();
  });
});

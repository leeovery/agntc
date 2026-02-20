import { describe, it, expect, vi, beforeEach } from "vitest";
import { CodexDriver } from "../../src/drivers/codex-driver.js";
import * as fs from "node:fs/promises";
import * as childProcess from "node:child_process";
import { join } from "node:path";

vi.mock("node:fs/promises");
vi.mock("node:child_process");

describe("CodexDriver", () => {
  let driver: CodexDriver;

  beforeEach(() => {
    vi.restoreAllMocks();
    driver = new CodexDriver();
  });

  describe("detect", () => {
    it("returns true when .agents/ exists in project", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      const result = await driver.detect("/my/project");

      expect(result).toBe(true);
      expect(fs.access).toHaveBeenCalledWith(join("/my/project", ".agents"));
    });

    it("skips system fallback on project match", async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined);

      await driver.detect("/my/project");

      expect(childProcess.execFile).not.toHaveBeenCalled();
      expect(fs.access).toHaveBeenCalledTimes(1);
    });

    it("returns true when which codex succeeds", async () => {
      // Project-level .agents/ fails
      vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

      // which codex succeeds
      vi.mocked(childProcess.execFile).mockImplementationOnce(
        (_cmd, _args, _opts, callback) => {
          (callback as Function)(null, "/usr/local/bin/codex", "");
          return {} as ReturnType<typeof childProcess.execFile>;
        },
      );

      const result = await driver.detect("/my/project");

      expect(result).toBe(true);
      expect(childProcess.execFile).toHaveBeenCalledWith(
        "which",
        ["codex"],
        {},
        expect.any(Function),
      );
    });

    it("returns false when both checks fail", async () => {
      // Project-level .agents/ fails
      vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

      // which codex fails
      vi.mocked(childProcess.execFile).mockImplementationOnce(
        (_cmd, _args, _opts, callback) => {
          (callback as Function)(new Error("not found"), "", "");
          return {} as ReturnType<typeof childProcess.execFile>;
        },
      );

      const result = await driver.detect("/my/project");

      expect(result).toBe(false);
    });

    it("does not throw on check failures", async () => {
      vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
      vi.mocked(childProcess.execFile).mockImplementation(
        (_cmd, _args, _opts, callback) => {
          (callback as Function)(new Error("not found"), "", "");
          return {} as ReturnType<typeof childProcess.execFile>;
        },
      );

      await expect(driver.detect("/my/project")).resolves.toBe(false);
    });

    it("does not check home directory", async () => {
      // Project-level .agents/ fails
      vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

      // which codex fails
      vi.mocked(childProcess.execFile).mockImplementationOnce(
        (_cmd, _args, _opts, callback) => {
          (callback as Function)(new Error("not found"), "", "");
          return {} as ReturnType<typeof childProcess.execFile>;
        },
      );

      await driver.detect("/my/project");

      // Only one fs.access call (project check), no home dir check
      expect(fs.access).toHaveBeenCalledTimes(1);
      expect(fs.access).toHaveBeenCalledWith(join("/my/project", ".agents"));
    });
  });

  describe("getTargetDir", () => {
    it("returns .agents/skills for skills asset type", () => {
      expect(driver.getTargetDir("skills")).toBe(".agents/skills");
    });

    it("returns null for agents asset type", () => {
      expect(driver.getTargetDir("agents")).toBeNull();
    });

    it("returns null for hooks asset type", () => {
      expect(driver.getTargetDir("hooks")).toBeNull();
    });

    it("returns null for unknown asset type", () => {
      expect(driver.getTargetDir("unknown")).toBeNull();
    });
  });
});

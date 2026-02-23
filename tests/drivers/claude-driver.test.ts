import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClaudeDriver } from "../../src/drivers/claude-driver.js";

vi.mock("node:fs/promises");
vi.mock("node:child_process");

describe("ClaudeDriver", () => {
	let driver: ClaudeDriver;

	beforeEach(() => {
		vi.restoreAllMocks();
		driver = new ClaudeDriver();
	});

	describe("detect", () => {
		it("returns true when .claude/ exists in project", async () => {
			vi.mocked(fs.access).mockResolvedValueOnce(undefined);

			const result = await driver.detect("/my/project");

			expect(result).toBe(true);
			expect(fs.access).toHaveBeenCalledWith(join("/my/project", ".claude"));
		});

		it("skips system fallback on project match", async () => {
			vi.mocked(fs.access).mockResolvedValueOnce(undefined);

			await driver.detect("/my/project");

			expect(childProcess.execFile).not.toHaveBeenCalled();
			// Only one fs.access call — the project-level check
			expect(fs.access).toHaveBeenCalledTimes(1);
		});

		it("returns true when which claude succeeds", async () => {
			// Project-level .claude/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			// which claude succeeds
			vi.mocked(childProcess.execFile).mockImplementationOnce(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(null, "/usr/local/bin/claude", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			const result = await driver.detect("/my/project");

			expect(result).toBe(true);
		});

		it("returns true when ~/.claude/ exists", async () => {
			// Project-level .claude/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			// which claude fails
			vi.mocked(childProcess.execFile).mockImplementationOnce(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(new Error("not found"), "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			// ~/.claude/ succeeds
			vi.mocked(fs.access).mockResolvedValueOnce(undefined);

			const result = await driver.detect("/my/project");

			expect(result).toBe(true);
			expect(fs.access).toHaveBeenCalledWith(join(homedir(), ".claude"));
		});

		it("returns false when all checks fail", async () => {
			// Project-level .claude/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			// which claude fails
			vi.mocked(childProcess.execFile).mockImplementationOnce(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(new Error("not found"), "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			// ~/.claude/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			const result = await driver.detect("/my/project");

			expect(result).toBe(false);
		});

		it("does not throw on check failures", async () => {
			// All checks fail
			vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));
			vi.mocked(childProcess.execFile).mockImplementation(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(new Error("not found"), "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			await expect(driver.detect("/my/project")).resolves.toBe(false);
		});
	});

	describe("getTargetDir", () => {
		it("returns .claude/skills for skills asset type", () => {
			expect(driver.getTargetDir("skills")).toBe(".claude/skills");
		});

		it("returns .claude/agents for agents asset type", () => {
			expect(driver.getTargetDir("agents")).toBe(".claude/agents");
		});

		it("returns .claude/hooks for hooks asset type", () => {
			expect(driver.getTargetDir("hooks")).toBe(".claude/hooks");
		});

		it("returns null for unknown asset type", () => {
			expect(driver.getTargetDir("unknown")).toBeNull();
		});
	});
});

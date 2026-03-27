import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CursorDriver } from "../../src/drivers/cursor-driver.js";

vi.mock("node:fs/promises");
vi.mock("node:child_process");

describe("CursorDriver", () => {
	let driver: CursorDriver;

	beforeEach(() => {
		vi.restoreAllMocks();
		driver = new CursorDriver();
	});

	describe("detect", () => {
		it("returns true when .cursor/ exists in project", async () => {
			vi.mocked(fs.access).mockResolvedValueOnce(undefined);

			const result = await driver.detect("/my/project");

			expect(result).toBe(true);
			expect(fs.access).toHaveBeenCalledWith(join("/my/project", ".cursor"));
		});

		it("skips system fallback on project match", async () => {
			vi.mocked(fs.access).mockResolvedValueOnce(undefined);

			await driver.detect("/my/project");

			expect(childProcess.execFile).not.toHaveBeenCalled();
			// Only one fs.access call — the project-level check
			expect(fs.access).toHaveBeenCalledTimes(1);
		});

		it("returns true when which cursor succeeds", async () => {
			// Project-level .cursor/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			// which cursor succeeds
			vi.mocked(childProcess.execFile).mockImplementationOnce(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(null, "/usr/local/bin/cursor", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			const result = await driver.detect("/my/project");

			expect(result).toBe(true);
		});

		it("returns true when ~/.cursor/ exists", async () => {
			// Project-level .cursor/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			// which cursor fails
			vi.mocked(childProcess.execFile).mockImplementationOnce(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(new Error("not found"), "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			// ~/.cursor/ succeeds
			vi.mocked(fs.access).mockResolvedValueOnce(undefined);

			const result = await driver.detect("/my/project");

			expect(result).toBe(true);
			expect(fs.access).toHaveBeenCalledWith(join(homedir(), ".cursor"));
		});

		it("returns false when all checks fail", async () => {
			// Project-level .cursor/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			// which cursor fails
			vi.mocked(childProcess.execFile).mockImplementationOnce(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(new Error("not found"), "", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			// ~/.cursor/ fails
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

		it("does not check home directory when which succeeds", async () => {
			// Project-level .cursor/ fails
			vi.mocked(fs.access).mockRejectedValueOnce(new Error("ENOENT"));

			// which cursor succeeds
			vi.mocked(childProcess.execFile).mockImplementationOnce(
				(_cmd, _args, _opts, callback) => {
					(callback as Function)(null, "/usr/local/bin/cursor", "");
					return {} as ReturnType<typeof childProcess.execFile>;
				},
			);

			await driver.detect("/my/project");

			// Only one fs.access call (project check), no home dir check
			expect(fs.access).toHaveBeenCalledTimes(1);
			expect(fs.access).toHaveBeenCalledWith(join("/my/project", ".cursor"));
		});
	});

	describe("getTargetDir", () => {
		it("returns .cursor/skills for skills asset type", () => {
			expect(driver.getTargetDir("skills")).toBe(".cursor/skills");
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

import * as childProcess from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execGit, fetchRemoteTags } from "../src/git-utils.js";

vi.mock("node:child_process");

function mockExecFileSuccess(stdout = "output\n", stderr = ""): void {
	vi.mocked(childProcess.execFile).mockImplementation(
		(_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
			if (typeof _opts === "function") {
				cb = _opts;
			}
			if (cb) {
				cb(null, stdout, stderr);
			}
			return {} as ReturnType<typeof childProcess.execFile>;
		},
	);
}

function mockExecFileFailure(stderr: string): void {
	vi.mocked(childProcess.execFile).mockImplementation(
		(_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
			if (typeof _opts === "function") {
				cb = _opts;
			}
			const err = Object.assign(new Error(stderr), { stderr });
			if (cb) {
				cb(err, "", stderr);
			}
			return {} as ReturnType<typeof childProcess.execFile>;
		},
	);
}

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("execGit", () => {
	it("calls git with provided args", async () => {
		mockExecFileSuccess();

		await execGit(["status"]);

		const execFileMock = vi.mocked(childProcess.execFile);
		expect(execFileMock).toHaveBeenCalledTimes(1);
		const call = execFileMock.mock.calls[0]!;
		expect(call[0]).toBe("git");
		expect(call[1]).toEqual(["status"]);
	});

	it("returns stdout string on success", async () => {
		mockExecFileSuccess("hello world\n");

		const result = await execGit(["log"]);

		expect(result).toEqual({ stdout: "hello world\n", stderr: "" });
	});

	it("uses default timeout of 30_000 when no options provided", async () => {
		mockExecFileSuccess();

		await execGit(["status"]);

		const execFileMock = vi.mocked(childProcess.execFile);
		const call = execFileMock.mock.calls[0]!;
		const opts = call[2] as { timeout: number };
		expect(opts.timeout).toBe(30_000);
	});

	it("uses custom timeout when provided", async () => {
		mockExecFileSuccess();

		await execGit(["clone", "url"], { timeout: 60_000 });

		const execFileMock = vi.mocked(childProcess.execFile);
		const call = execFileMock.mock.calls[0]!;
		const opts = call[2] as { timeout: number };
		expect(opts.timeout).toBe(60_000);
	});

	it("passes cwd option to execFile", async () => {
		mockExecFileSuccess();

		await execGit(["rev-parse", "HEAD"], { cwd: "/some/dir" });

		const execFileMock = vi.mocked(childProcess.execFile);
		const call = execFileMock.mock.calls[0]!;
		const opts = call[2] as { cwd: string };
		expect(opts.cwd).toBe("/some/dir");
	});

	it("rejects with error containing stderr on failure", async () => {
		mockExecFileFailure("fatal: not a git repository");

		await expect(execGit(["status"])).rejects.toThrow(
			"fatal: not a git repository",
		);
	});

	it("attaches stderr property to rejection error", async () => {
		mockExecFileFailure("fatal: bad ref");

		try {
			await execGit(["checkout", "bad"]);
			expect.fail("should have thrown");
		} catch (err: unknown) {
			expect((err as { stderr: string }).stderr).toBe("fatal: bad ref");
		}
	});

	it("uses error.message as fallback when stderr is empty", async () => {
		vi.mocked(childProcess.execFile).mockImplementation(
			(_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
				if (typeof _opts === "function") {
					cb = _opts;
				}
				const err = new Error("spawn ENOENT");
				if (cb) {
					cb(err, "", "");
				}
				return {} as ReturnType<typeof childProcess.execFile>;
			},
		);

		await expect(execGit(["status"])).rejects.toThrow("spawn ENOENT");
	});
});

describe("fetchRemoteTags", () => {
	it("parses ls-remote output into tag names", async () => {
		const lsRemoteOutput = [
			"abc123\trefs/tags/v1.0.0",
			"def456\trefs/tags/v1.1.0",
			"ghi789\trefs/tags/v2.0.0",
		].join("\n");
		mockExecFileSuccess(lsRemoteOutput);

		const tags = await fetchRemoteTags("https://github.com/owner/repo.git");

		expect(tags).toEqual(["v1.0.0", "v1.1.0", "v2.0.0"]);
	});

	it("filters out ^{} annotated tag refs", async () => {
		const lsRemoteOutput = [
			"abc123\trefs/tags/v1.0.0",
			"abc124\trefs/tags/v1.0.0^{}",
			"def456\trefs/tags/v2.0.0",
			"def457\trefs/tags/v2.0.0^{}",
		].join("\n");
		mockExecFileSuccess(lsRemoteOutput);

		const tags = await fetchRemoteTags("https://github.com/owner/repo.git");

		expect(tags).toEqual(["v1.0.0", "v2.0.0"]);
	});

	it("returns empty array when no tags exist", async () => {
		mockExecFileSuccess("");

		const tags = await fetchRemoteTags("https://github.com/owner/repo.git");

		expect(tags).toEqual([]);
	});

	it("calls git ls-remote --tags with correct url", async () => {
		mockExecFileSuccess("");

		await fetchRemoteTags("https://github.com/owner/repo.git");

		const execFileMock = vi.mocked(childProcess.execFile);
		const call = execFileMock.mock.calls[0]!;
		expect(call[0]).toBe("git");
		expect(call[1]).toEqual([
			"ls-remote",
			"--tags",
			"https://github.com/owner/repo.git",
		]);
	});
});

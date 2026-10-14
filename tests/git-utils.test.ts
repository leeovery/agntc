import * as childProcess from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	execGit,
	fetchDefaultBranch,
	fetchRemoteTagRefs,
	fetchRemoteTags,
	GIT_ATTEMPTS,
	lsRemote,
	withGitRetry,
} from "../src/git-utils.js";
import {
	mockExecFileFailingFirst,
	SSH_REFUSAL,
	settle,
} from "./helpers/git-mocks.js";

vi.mock("node:child_process");

function mockExecFileSuccess(stdout = "output\n", stderr = ""): void {
	vi.mocked(childProcess.execFile).mockImplementation(
		(_cmd: string, _args: unknown, _opts: unknown, cb?: Function | null) => {
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
		(_cmd: string, _args: unknown, _opts: unknown, cb?: Function | null) => {
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

function execFileCalls(): unknown[][] {
	return vi.mocked(childProcess.execFile).mock.calls;
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
			(_cmd: string, _args: unknown, _opts: unknown, cb?: Function | null) => {
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

describe("fetchRemoteTagRefs", () => {
	it("returns full TagRef objects from ls-remote output", async () => {
		const lsRemoteOutput = [
			"abc123\trefs/tags/v1.0.0",
			"def456\trefs/tags/v1.1.0",
			"ghi789\trefs/tags/v2.0.0",
		].join("\n");
		mockExecFileSuccess(lsRemoteOutput);

		const refs = await fetchRemoteTagRefs("https://github.com/owner/repo.git");

		expect(refs).toEqual([
			{ tag: "v1.0.0", sha: "abc123" },
			{ tag: "v1.1.0", sha: "def456" },
			{ tag: "v2.0.0", sha: "ghi789" },
		]);
	});

	it("gives annotated tags the commit from their peeled ^{} line", async () => {
		const lsRemoteOutput = [
			"abc123\trefs/tags/v1.0.0",
			"abc124\trefs/tags/v1.0.0^{}",
			"def456\trefs/tags/v2.0.0",
			"def457\trefs/tags/v2.0.0^{}",
		].join("\n");
		mockExecFileSuccess(lsRemoteOutput);

		const refs = await fetchRemoteTagRefs("https://github.com/owner/repo.git");

		expect(refs).toEqual([
			{ tag: "v1.0.0", sha: "abc124" },
			{ tag: "v2.0.0", sha: "def457" },
		]);
	});

	it("returns empty array when no tags exist", async () => {
		mockExecFileSuccess("");

		const refs = await fetchRemoteTagRefs("https://github.com/owner/repo.git");

		expect(refs).toEqual([]);
	});

	it("calls git ls-remote --tags with correct url", async () => {
		mockExecFileSuccess("");

		await fetchRemoteTagRefs("https://github.com/owner/repo.git");

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

	it("lists each annotated tag once, without its ^{} line", async () => {
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

describe("fetchDefaultBranch", () => {
	it("reads the branch HEAD points at from ls-remote --symref", async () => {
		mockExecFileSuccess(
			`ref: refs/heads/trunk\tHEAD\n${"a".repeat(40)}\tHEAD\n`,
		);

		const branch = await fetchDefaultBranch("https://github.com/o/r.git");

		expect(branch).toBe("trunk");
		const call = vi.mocked(childProcess.execFile).mock.calls[0]!;
		expect(call[1]).toEqual([
			"ls-remote",
			"--symref",
			"https://github.com/o/r.git",
			"HEAD",
		]);
	});

	it("keeps a branch name with a slash whole", async () => {
		mockExecFileSuccess("ref: refs/heads/release/v2\tHEAD\n");

		expect(await fetchDefaultBranch("https://github.com/o/r.git")).toBe(
			"release/v2",
		);
	});

	it("is null when the remote names no branch for HEAD", async () => {
		mockExecFileSuccess(`${"a".repeat(40)}\tHEAD\n`);

		expect(await fetchDefaultBranch("https://github.com/o/r.git")).toBeNull();
	});
});

describe("remote reads retry", () => {
	const URL = "https://github.com/o/r.git";

	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("passes when a refused read succeeds on its second attempt", async () => {
		mockExecFileFailingFirst(1, SSH_REFUSAL, "abc123\trefs/tags/v1.0.0\n");

		const tags = await settle(fetchRemoteTags(URL));

		expect(tags).toEqual(["v1.0.0"]);
		expect(execFileCalls()).toHaveLength(2);
	});

	it("tries GIT_ATTEMPTS times, then fails with git's error as it was", async () => {
		mockExecFileFailingFirst(Number.POSITIVE_INFINITY, SSH_REFUSAL);

		const err = await settle(lsRemote(["--tags", URL]));

		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe(SSH_REFUSAL);
		expect((err as Error & { stderr: string }).stderr).toBe(SSH_REFUSAL);
		expect(execFileCalls()).toHaveLength(GIT_ATTEMPTS);
		expect(GIT_ATTEMPTS).toBe(3);
	});

	it("waits 500ms before the second attempt and 1000ms before the third", async () => {
		mockExecFileFailingFirst(Number.POSITIVE_INFINITY, SSH_REFUSAL);

		const done = lsRemote([URL, "HEAD"]).catch((err: Error) => err);
		await vi.advanceTimersByTimeAsync(499);
		expect(execFileCalls()).toHaveLength(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(execFileCalls()).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(999);
		expect(execFileCalls()).toHaveLength(2);
		await vi.advanceTimersByTimeAsync(1);
		expect(execFileCalls()).toHaveLength(3);
		await done;
	});

	it("gives every attempt the read's own 15s timeout", async () => {
		mockExecFileFailingFirst(2, SSH_REFUSAL);

		await settle(lsRemote([URL, "HEAD"]));

		const timeouts = execFileCalls().map(
			(call) => (call[2] as { timeout: number }).timeout,
		);
		expect(timeouts).toEqual([15_000, 15_000, 15_000]);
	});

	it("retries the tag refs an update check reads", async () => {
		mockExecFileFailingFirst(2, SSH_REFUSAL, "abc123\trefs/tags/v1.0.0\n");

		const refs = await settle(fetchRemoteTagRefs(URL));

		expect(refs).toEqual([{ tag: "v1.0.0", sha: "abc123" }]);
		expect(execFileCalls()).toHaveLength(3);
	});

	it("retries the default branch read", async () => {
		mockExecFileFailingFirst(1, SSH_REFUSAL, "ref: refs/heads/trunk\tHEAD\n");

		expect(await settle(fetchDefaultBranch(URL))).toBe("trunk");
		expect(execFileCalls()).toHaveLength(2);
	});
});

describe("withGitRetry", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("stops at a failure isFinal says no retry can mend", async () => {
		const failure = new Error("Authentication failed");
		const run = vi.fn(async () => {
			throw failure;
		});

		const err = await settle(withGitRetry(run, (e) => e === failure));

		expect(err).toBe(failure);
		expect(run).toHaveBeenCalledTimes(1);
	});
});

import * as childProcess from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ManifestEntry } from "../src/manifest.js";
import { checkForUpdate } from "../src/update-check.js";

vi.mock("node:child_process");

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);

function makeEntry(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
	return {
		ref: null,
		commit: INSTALLED_SHA,
		installedAt: "2026-02-01T00:00:00.000Z",
		agents: ["claude"],
		files: [".claude/skills/my-skill/"],
		cloneUrl: null,
		...overrides,
	};
}

function mockExecFile(
	impl: (
		cmd: string,
		args: readonly string[],
		opts: object,
		cb: (err: Error | null, stdout: string, stderr: string) => void,
	) => void,
): void {
	vi.mocked(childProcess.execFile).mockImplementation(
		(_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
			if (typeof _opts === "function") {
				cb = _opts;
				_opts = {};
			}
			impl(
				_cmd as string,
				_args as readonly string[],
				_opts as object,
				cb as (err: Error | null, stdout: string, stderr: string) => void,
			);
			return {} as ReturnType<typeof childProcess.execFile>;
		},
	);
}

function mockLsRemoteSuccess(sha: string): void {
	mockExecFile((_cmd, _args, _opts, cb) => {
		cb(null, `${sha}\tHEAD\n`, "");
	});
}

function mockLsRemoteFailure(stderr: string): void {
	mockExecFile((_cmd, _args, _opts, cb) => {
		const err = Object.assign(new Error(stderr), { stderr });
		cb(err, "", stderr);
	});
}

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("checkForUpdate", () => {
	describe("local installs", () => {
		it("returns local status when ref and commit are both null", async () => {
			const entry = makeEntry({ ref: null, commit: null });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "local" });
		});

		it("does not call git ls-remote for local installs", async () => {
			const entry = makeEntry({ ref: null, commit: null });

			await checkForUpdate("owner/repo", entry);

			expect(childProcess.execFile).not.toHaveBeenCalled();
		});
	});

	describe("clone URL derivation", () => {
		it("derives clone URL from owner/repo key when cloneUrl is null", async () => {
			mockLsRemoteSuccess(INSTALLED_SHA);
			const entry = makeEntry({ cloneUrl: null });

			await checkForUpdate("alice/my-skills", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("https://github.com/alice/my-skills.git");
		});

		it("derives clone URL from owner/repo/plugin key when cloneUrl is null (collection)", async () => {
			mockLsRemoteSuccess(INSTALLED_SHA);
			const entry = makeEntry({ cloneUrl: null });

			await checkForUpdate("alice/my-skills/go", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("https://github.com/alice/my-skills.git");
		});

		it("uses entry.cloneUrl when available instead of deriving from key", async () => {
			mockLsRemoteSuccess(INSTALLED_SHA);
			const entry = makeEntry({
				cloneUrl: "https://gitlab.com/alice/my-skills.git",
			});

			await checkForUpdate("alice/my-skills", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("https://gitlab.com/alice/my-skills.git");
		});

		it("uses SSH cloneUrl for update check", async () => {
			mockLsRemoteSuccess(INSTALLED_SHA);
			const entry = makeEntry({
				cloneUrl: "git@github.com:alice/my-skills.git",
			});

			await checkForUpdate("alice/my-skills", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("git@github.com:alice/my-skills.git");
		});
	});

	describe("HEAD tracking (ref=null, commit!=null)", () => {
		it("returns update-available when remote SHA differs", async () => {
			mockLsRemoteSuccess(REMOTE_SHA);
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
		});

		it("returns up-to-date when remote SHA matches", async () => {
			mockLsRemoteSuccess(INSTALLED_SHA);
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("runs git ls-remote with HEAD ref", async () => {
			mockLsRemoteSuccess(INSTALLED_SHA);
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toEqual([
				"ls-remote",
				"https://github.com/owner/repo.git",
				"HEAD",
			]);
		});
	});

	describe("branch tracking", () => {
		it("returns update-available when branch tip differs", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${REMOTE_SHA}\trefs/heads/dev\n`, "");
			});
			const entry = makeEntry({ ref: "dev", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
		});

		it("returns up-to-date when branch tip matches", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${INSTALLED_SHA}\trefs/heads/main\n`, "");
			});
			const entry = makeEntry({ ref: "main", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("runs git ls-remote with refs/heads/{branch}", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${INSTALLED_SHA}\trefs/heads/dev\n`, "");
			});
			const entry = makeEntry({ ref: "dev", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toEqual([
				"ls-remote",
				"https://github.com/owner/repo.git",
				"refs/heads/dev",
			]);
		});

		it("returns check-failed when branch is gone (empty ls-remote output)", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, "", "");
			});
			const entry = makeEntry({ ref: "deleted-branch", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "Branch 'deleted-branch' not found on remote",
			});
		});
	});

	describe("tag tracking", () => {
		it("returns up-to-date when tag exists on remote", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${INSTALLED_SHA}\trefs/tags/v2.0\n`, "");
			});
			const entry = makeEntry({ ref: "v2.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("returns newer-tags when newer tags exist", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(
					null,
					[
						`${"c".repeat(40)}\trefs/tags/v1.0`,
						`${INSTALLED_SHA}\trefs/tags/v2.0`,
						`${"d".repeat(40)}\trefs/tags/v3.0`,
						`${"e".repeat(40)}\trefs/tags/v3.1`,
					].join("\n") + "\n",
					"",
				);
			});
			const entry = makeEntry({ ref: "v2.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "newer-tags",
				tags: ["v3.0", "v3.1"],
			});
		});

		it("makes a single ls-remote --tags call", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${INSTALLED_SHA}\trefs/tags/v2.0\n`, "");
			});
			const entry = makeEntry({ ref: "v2.0", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			expect(execFileMock).toHaveBeenCalledTimes(1);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toEqual([
				"ls-remote",
				"--tags",
				"https://github.com/owner/repo.git",
			]);
		});

		it("returns check-failed when installed tag is not in remote tags", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(
					null,
					[
						`${"c".repeat(40)}\trefs/tags/v1.0`,
						`${"d".repeat(40)}\trefs/tags/v3.0`,
					].join("\n") + "\n",
					"",
				);
			});
			const entry = makeEntry({ ref: "v2.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "Tag 'v2.0' not found on remote",
			});
		});

		it("filters out dereferenced tag entries (^{})", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(
					null,
					[
						`${INSTALLED_SHA}\trefs/tags/v1.0`,
						`${INSTALLED_SHA}\trefs/tags/v1.0^{}`,
						`${"d".repeat(40)}\trefs/tags/v2.0`,
						`${"d".repeat(40)}\trefs/tags/v2.0^{}`,
					].join("\n") + "\n",
					"",
				);
			});
			const entry = makeEntry({ ref: "v1.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "newer-tags",
				tags: ["v2.0"],
			});
		});
	});

	describe("ls-remote failure", () => {
		it("returns check-failed when ls-remote errors", async () => {
			mockLsRemoteFailure("fatal: could not read from remote repository");
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "fatal: could not read from remote repository",
			});
		});

		it("returns check-failed on timeout", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				const err = Object.assign(new Error("Command timed out"), {
					killed: true,
					signal: "SIGTERM",
					stderr: "",
				});
				cb(err, "", "");
			});
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "Command timed out",
			});
		});

		it("returns check-failed when tag ls-remote fails", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				const err = Object.assign(new Error("network error"), {
					stderr: "network error",
				});
				cb(err, "", "network error");
			});
			const entry = makeEntry({ ref: "v2.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "network error",
			});
		});
	});

	describe("ls-remote output parsing", () => {
		it("parses SHA from tab-separated ls-remote output", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${REMOTE_SHA}\tHEAD\n`, "");
			});
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
		});

		it("handles trailing whitespace in ls-remote output", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${INSTALLED_SHA}\tHEAD  \n  `, "");
			});
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("handles empty ls-remote output for HEAD", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, "", "");
			});
			const entry = makeEntry({ ref: null, commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "No HEAD ref found on remote",
			});
		});
	});

	describe("ref type detection", () => {
		it("treats ref starting with 'v' followed by digit as a tag", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${INSTALLED_SHA}\trefs/tags/v1.2.3\n`, "");
			});
			const entry = makeEntry({ ref: "v1.2.3", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			// Should use ls-remote --tags (tag path), not refs/heads/ (branch path)
			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("--tags");
		});

		it("treats numeric-prefixed ref as a tag", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${INSTALLED_SHA}\trefs/tags/1.0.0\n`, "");
			});
			const entry = makeEntry({ ref: "1.0.0", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("--tags");
		});
	});
});

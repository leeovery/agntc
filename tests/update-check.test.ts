import * as childProcess from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "../src/update-check.js";
import { makeEntry } from "./helpers/factories.js";
import {
	buildRefProbeOutput,
	buildTagsOutput,
	mockExecFile,
} from "./helpers/git-mocks.js";

vi.mock("node:child_process");

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);
const OTHER_SHA = "c".repeat(40);

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

// Routes ls-remote invocations by their args so a single test can serve both
// the combined heads+tags probe and the follow-up `--tags` list call with
// distinct, realistic payloads (see spec "Mock harness note").
function mockLsRemote(routes: { probe?: string; tags?: string }): void {
	mockExecFile((_cmd, args, _opts, cb) => {
		if (args.includes("--tags")) {
			cb(null, routes.tags ?? "", "");
			return;
		}
		cb(null, routes.probe ?? "", "");
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

	describe("remote-truth ref classification — branch refs", () => {
		it("classifies a branch that looks like a tag (v4) and returns update-available when the tip differs", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({ head: { ref: "v4", sha: REMOTE_SHA } }),
			});
			const entry = makeEntry({ ref: "v4", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
		});

		it("classifies a branch that looks like a tag (v4) and returns up-to-date when the tip matches", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({ head: { ref: "v4", sha: INSTALLED_SHA } }),
			});
			const entry = makeEntry({ ref: "v4", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("never reports 'Tag v4 not found on remote' for a v4 branch (regression guard)", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({ head: { ref: "v4", sha: REMOTE_SHA } }),
			});
			const entry = makeEntry({ ref: "v4", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result.status).not.toBe("check-failed");
		});

		it("classifies a plain branch (main)", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({ head: { ref: "main", sha: REMOTE_SHA } }),
			});
			const entry = makeEntry({ ref: "main", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
		});

		it("reuses the probed head sha and issues no second refs/heads lookup for a branch", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({ head: { ref: "dev", sha: REMOTE_SHA } }),
			});
			const entry = makeEntry({ ref: "dev", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			expect(execFileMock).toHaveBeenCalledTimes(1);
			const args = execFileMock.mock.calls[0]![1] as string[];
			expect(args).toEqual([
				"ls-remote",
				"https://github.com/owner/repo.git",
				"refs/heads/dev",
				"refs/tags/dev",
			]);
		});
	});

	describe("remote-truth ref classification — tag refs", () => {
		it("classifies a real semver tag (v4.9.0) and returns newer-tags when later tags exist", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({
					tag: { ref: "v4.9.0", sha: INSTALLED_SHA },
				}),
				tags: buildTagsOutput([
					{ sha: INSTALLED_SHA, tag: "v4.9.0" },
					{ sha: OTHER_SHA, tag: "v4.10.0" },
				]),
			});
			const entry = makeEntry({ ref: "v4.9.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "newer-tags", tags: ["v4.10.0"] });
		});

		it("classifies a real semver tag (v4.9.0) and returns up-to-date at the latest tag", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({
					tag: { ref: "v4.9.0", sha: INSTALLED_SHA },
				}),
				tags: buildTagsOutput([{ sha: INSTALLED_SHA, tag: "v4.9.0" }]),
			});
			const entry = makeEntry({ ref: "v4.9.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("classifies a tag whose name does not match /^v?\\d/ (release-1.0) as a tag, not a missing branch", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({
					tag: { ref: "release-1.0", sha: INSTALLED_SHA },
				}),
				tags: buildTagsOutput([
					{ sha: INSTALLED_SHA, tag: "release-1.0" },
					{ sha: OTHER_SHA, tag: "release-2.0" },
				]),
			});
			const entry = makeEntry({ ref: "release-1.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "newer-tags", tags: ["release-2.0"] });
		});

		it("issues the probe first, then a single ls-remote --tags call, for a tag ref", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({
					tag: { ref: "v2.0", sha: INSTALLED_SHA },
				}),
				tags: buildTagsOutput([{ sha: INSTALLED_SHA, tag: "v2.0" }]),
			});
			const entry = makeEntry({ ref: "v2.0", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			expect(execFileMock).toHaveBeenCalledTimes(2);
			const firstArgs = execFileMock.mock.calls[0]![1] as string[];
			expect(firstArgs).toEqual([
				"ls-remote",
				"https://github.com/owner/repo.git",
				"refs/heads/v2.0",
				"refs/tags/v2.0",
			]);
			const secondArgs = execFileMock.mock.calls[1]![1] as string[];
			expect(secondArgs).toEqual([
				"ls-remote",
				"--tags",
				"https://github.com/owner/repo.git",
			]);
		});

		it("filters out dereferenced tag entries (^{}) on the tag path", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({
					tag: { ref: "v1.0", sha: INSTALLED_SHA },
				}),
				tags:
					[
						`${INSTALLED_SHA}\trefs/tags/v1.0`,
						`${INSTALLED_SHA}\trefs/tags/v1.0^{}`,
						`${OTHER_SHA}\trefs/tags/v2.0`,
						`${OTHER_SHA}\trefs/tags/v2.0^{}`,
					].join("\n") + "\n",
			});
			const entry = makeEntry({ ref: "v1.0", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "newer-tags", tags: ["v2.0"] });
		});
	});

	describe("remote-truth ref classification — tiebreak, not-found, errors", () => {
		it("resolves to the tag when both a branch and a tag named {ref} exist (tiebreak)", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({
					head: { ref: "v4", sha: REMOTE_SHA },
					tag: { ref: "v4", sha: INSTALLED_SHA },
				}),
				tags: buildTagsOutput([
					{ sha: INSTALLED_SHA, tag: "v4" },
					{ sha: OTHER_SHA, tag: "v5" },
				]),
			});
			const entry = makeEntry({ ref: "v4", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			// Tag path result (newer-tags), NOT a branch-tip comparison
			// (which would be update-available with remoteCommit REMOTE_SHA).
			expect(result).toEqual({ status: "newer-tags", tags: ["v5"] });
		});

		it("runs the --tags call on the tag path when both branch and tag exist", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({
					head: { ref: "v4", sha: REMOTE_SHA },
					tag: { ref: "v4", sha: INSTALLED_SHA },
				}),
				tags: buildTagsOutput([{ sha: INSTALLED_SHA, tag: "v4" }]),
			});
			const entry = makeEntry({ ref: "v4", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const tagsCall = execFileMock.mock.calls.find((call) =>
				(call[1] as string[]).includes("--tags"),
			);
			expect(tagsCall).toBeDefined();
		});

		it("returns check-failed with the unified reason when the ref exists as neither branch nor tag", async () => {
			mockLsRemote({ probe: "" });
			const entry = makeEntry({ ref: "gone", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "Ref 'gone' not found on remote as a branch or tag",
			});
		});

		it("does not fall back to the installed commit when the ref is gone (terminal)", async () => {
			mockLsRemote({ probe: "" });
			const entry = makeEntry({ ref: "deleted-branch", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "Ref 'deleted-branch' not found on remote as a branch or tag",
			});
		});

		it("returns check-failed carrying the underlying message when the probe errors", async () => {
			mockLsRemoteFailure("fatal: could not read from remote repository");
			const entry = makeEntry({ ref: "v4", commit: INSTALLED_SHA });

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "fatal: could not read from remote repository",
			});
		});

		it("issues the probe with a 15s timeout (not execGit's 30s default)", async () => {
			mockLsRemote({
				probe: buildRefProbeOutput({ head: { ref: "v4", sha: REMOTE_SHA } }),
			});
			const entry = makeEntry({ ref: "v4", commit: INSTALLED_SHA });

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const opts = execFileMock.mock.calls[0]![2] as { timeout?: number };
			expect(opts.timeout).toBe(15_000);
		});
	});

	describe("ls-remote failure (HEAD path)", () => {
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
	});

	describe("ls-remote output parsing (HEAD path)", () => {
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
});

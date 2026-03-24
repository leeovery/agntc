import * as childProcess from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "../src/update-check.js";
import * as versionResolve from "../src/version-resolve.js";
import { makeEntry } from "./helpers/factories.js";

vi.mock("node:child_process");

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

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

function buildTagsOutput(tags: Array<{ sha: string; tag: string }>): string {
	return (
		tags.map(({ sha, tag }) => `${sha}\trefs/tags/${tag}`).join("\n") + "\n"
	);
}

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("checkForUpdate — non-constrained entries bypass constrained path", () => {
	describe("tag ref without constraint uses old newer-tags logic", () => {
		it("returns newer-tags (not constrained-update-available) when newer tags exist", async () => {
			const tagsOutput = buildTagsOutput([
				{ sha: SHA_A, tag: "v1.0.0" },
				{ sha: SHA_B, tag: "v1.1.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_A,
				// no constraint
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "newer-tags",
				tags: ["v1.1.0"],
			});
		});

		it("returns up-to-date (not constrained-up-to-date) when at latest tag", async () => {
			const tagsOutput = buildTagsOutput([{ sha: SHA_A, tag: "v1.0.0" }]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_A,
				// no constraint
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("does not call resolveVersion for tag ref without constraint", async () => {
			const resolveVersionSpy = vi.spyOn(versionResolve, "resolveVersion");
			const resolveLatestSpy = vi.spyOn(versionResolve, "resolveLatestVersion");

			const tagsOutput = buildTagsOutput([
				{ sha: SHA_A, tag: "v1.0.0" },
				{ sha: SHA_B, tag: "v1.1.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_A,
			});

			await checkForUpdate("owner/repo", entry);

			expect(resolveVersionSpy).not.toHaveBeenCalled();
			expect(resolveLatestSpy).not.toHaveBeenCalled();
		});
	});

	describe("branch ref without constraint uses old branch logic", () => {
		it("returns update-available when branch tip differs", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${SHA_B}\trefs/heads/main\n`, "");
			});

			const entry = makeEntry({
				ref: "main",
				commit: SHA_A,
				// no constraint
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: SHA_B,
			});
		});

		it("queries refs/heads/{branch} not ls-remote --tags", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${SHA_A}\trefs/heads/develop\n`, "");
			});

			const entry = makeEntry({
				ref: "develop",
				commit: SHA_A,
			});

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("refs/heads/develop");
			expect(args).not.toContain("--tags");
		});

		it("does not call resolveVersion for branch ref without constraint", async () => {
			const resolveVersionSpy = vi.spyOn(versionResolve, "resolveVersion");
			const resolveLatestSpy = vi.spyOn(versionResolve, "resolveLatestVersion");

			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${SHA_B}\trefs/heads/main\n`, "");
			});

			const entry = makeEntry({
				ref: "main",
				commit: SHA_A,
			});

			await checkForUpdate("owner/repo", entry);

			expect(resolveVersionSpy).not.toHaveBeenCalled();
			expect(resolveLatestSpy).not.toHaveBeenCalled();
		});
	});

	describe("HEAD-tracking entry without constraint uses old HEAD logic", () => {
		it("returns update-available when remote HEAD differs", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${SHA_B}\tHEAD\n`, "");
			});

			const entry = makeEntry({
				ref: null,
				commit: SHA_A,
				// no constraint
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: SHA_B,
			});
		});

		it("queries HEAD ref not ls-remote --tags", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${SHA_A}\tHEAD\n`, "");
			});

			const entry = makeEntry({
				ref: null,
				commit: SHA_A,
			});

			await checkForUpdate("owner/repo", entry);

			const execFileMock = vi.mocked(childProcess.execFile);
			const firstCall = execFileMock.mock.calls[0]!;
			const args = firstCall[1] as string[];
			expect(args).toContain("HEAD");
			expect(args).not.toContain("--tags");
		});

		it("does not call resolveVersion for HEAD-tracking entry", async () => {
			const resolveVersionSpy = vi.spyOn(versionResolve, "resolveVersion");
			const resolveLatestSpy = vi.spyOn(versionResolve, "resolveLatestVersion");

			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${SHA_B}\tHEAD\n`, "");
			});

			const entry = makeEntry({
				ref: null,
				commit: SHA_A,
			});

			await checkForUpdate("owner/repo", entry);

			expect(resolveVersionSpy).not.toHaveBeenCalled();
			expect(resolveLatestSpy).not.toHaveBeenCalled();
		});
	});

	describe("local entry without constraint is unaffected", () => {
		it("returns local status immediately", async () => {
			const entry = makeEntry({
				ref: null,
				commit: null,
				// no constraint
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "local" });
		});

		it("does not call git or resolveVersion for local entries", async () => {
			const resolveVersionSpy = vi.spyOn(versionResolve, "resolveVersion");
			const resolveLatestSpy = vi.spyOn(versionResolve, "resolveLatestVersion");

			const entry = makeEntry({
				ref: null,
				commit: null,
			});

			await checkForUpdate("owner/repo", entry);

			expect(childProcess.execFile).not.toHaveBeenCalled();
			expect(resolveVersionSpy).not.toHaveBeenCalled();
			expect(resolveLatestSpy).not.toHaveBeenCalled();
		});
	});
});

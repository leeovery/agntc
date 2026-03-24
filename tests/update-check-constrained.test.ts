import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkForUpdate } from "../src/update-check.js";
import { makeEntry } from "./helpers/factories.js";
import { buildTagsOutput, mockExecFile } from "./helpers/git-mocks.js";

vi.mock("node:child_process");

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);
const SHA_C = "c".repeat(40);
const SHA_D = "d".repeat(40);
const SHA_E = "e".repeat(40);

beforeEach(() => {
	vi.restoreAllMocks();
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("checkForUpdate — constrained entries", () => {
	describe("constrained-update-available", () => {
		it("returns constrained-update-available when newer tag exists within constraint bounds", async () => {
			const tagsOutput = buildTagsOutput([
				{ sha: SHA_B, tag: "v1.0.0" },
				{ sha: SHA_C, tag: "v1.1.0" },
				{ sha: SHA_D, tag: "v1.2.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_B,
				constraint: "^1.0",
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "constrained-update-available",
				tag: "v1.2.0",
				commit: SHA_D,
				latestOverall: null,
			});
		});

		it("includes latestOverall when absolute latest exceeds within-constraint best", async () => {
			const tagsOutput = buildTagsOutput([
				{ sha: SHA_B, tag: "v1.0.0" },
				{ sha: SHA_C, tag: "v1.1.0" },
				{ sha: SHA_D, tag: "v2.0.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_B,
				constraint: "^1.0",
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "constrained-update-available",
				tag: "v1.1.0",
				commit: SHA_C,
				latestOverall: "v2.0.0",
			});
		});
	});

	describe("constrained-up-to-date", () => {
		it("returns constrained-up-to-date when current ref is best within constraint", async () => {
			const tagsOutput = buildTagsOutput([
				{ sha: SHA_B, tag: "v1.0.0" },
				{ sha: SHA_C, tag: "v1.1.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.1.0",
				commit: SHA_C,
				constraint: "^1.0",
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "constrained-up-to-date",
				latestOverall: null,
			});
		});

		it("includes latestOverall when up-to-date but newer version outside constraint", async () => {
			const tagsOutput = buildTagsOutput([
				{ sha: SHA_B, tag: "v1.0.0" },
				{ sha: SHA_C, tag: "v1.1.0" },
				{ sha: SHA_D, tag: "v2.0.0" },
				{ sha: SHA_E, tag: "v3.0.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.1.0",
				commit: SHA_C,
				constraint: "^1.0",
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "constrained-up-to-date",
				latestOverall: "v3.0.0",
			});
		});
	});

	describe("constrained-no-match", () => {
		it("returns constrained-no-match when no tags satisfy constraint", async () => {
			const tagsOutput = buildTagsOutput([
				{ sha: SHA_B, tag: "v1.0.0" },
				{ sha: SHA_C, tag: "v1.1.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_B,
				constraint: "^3.0",
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "constrained-no-match",
			});
		});
	});

	describe("pre-1.0 caret semantics", () => {
		it("correctly handles ^0.2.3 (minor is breaking boundary)", async () => {
			const tagsOutput = buildTagsOutput([
				{ sha: SHA_B, tag: "v0.2.3" },
				{ sha: SHA_C, tag: "v0.2.5" },
				{ sha: SHA_D, tag: "v0.3.0" },
			]);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, tagsOutput, "");
			});

			const entry = makeEntry({
				ref: "v0.2.3",
				commit: SHA_B,
				constraint: "^0.2.3",
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "constrained-update-available",
				tag: "v0.2.5",
				commit: SHA_C,
				latestOverall: "v0.3.0",
			});
		});
	});

	describe("non-constrained entries unaffected", () => {
		it("routes tag ref without constraint through existing tag check", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${SHA_B}\trefs/tags/v1.0.0\n`, "");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_B,
				// no constraint field
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({ status: "up-to-date" });
		});

		it("routes branch ref without constraint through existing branch check", async () => {
			const remoteSha = "b".repeat(40);
			mockExecFile((_cmd, _args, _opts, cb) => {
				cb(null, `${remoteSha}\trefs/heads/main\n`, "");
			});

			const entry = makeEntry({
				ref: "main",
				commit: SHA_A,
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "update-available",
				remoteCommit: remoteSha,
			});
		});
	});

	describe("error handling", () => {
		it("returns check-failed when ls-remote errors for constrained entry", async () => {
			mockExecFile((_cmd, _args, _opts, cb) => {
				const err = Object.assign(new Error("network error"), {
					stderr: "network error",
				});
				cb(err, "", "network error");
			});

			const entry = makeEntry({
				ref: "v1.0.0",
				commit: SHA_B,
				constraint: "^1.0",
			});

			const result = await checkForUpdate("owner/repo", entry);

			expect(result).toEqual({
				status: "check-failed",
				reason: "network error",
			});
		});
	});
});

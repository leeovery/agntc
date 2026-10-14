import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanupTempDir, cloneSource } from "../src/git-clone.js";
import type { ParsedSource } from "../src/source-parser.js";
import { mockExecFile } from "./helpers/git-mocks.js";

vi.mock("node:child_process");

const SHA = "a".repeat(40);
const PARSED: ParsedSource = {
	type: "github-shorthand",
	owner: "acme",
	repo: "skills",
	ref: null,
	constraint: null,
	manifestKey: "acme/skills",
	cloneUrl: "https://github.com/acme/skills.git",
};

/**
 * git as it behaves on disk: a clone into a folder holding files is refused,
 * and the first `breaks` clones leave a partial checkout behind and fail.
 */
function mockGitOnDisk(breaks: number): void {
	let clones = 0;
	mockExecFile((_cmd, args, _opts, cb) => {
		if (!args.includes("clone")) {
			cb(null, `${SHA}\n`, "");
			return;
		}
		const dir = args.at(-1) ?? "";
		if (existsSync(dir) && readdirSync(dir).length > 0) {
			const stderr = `fatal: destination path '${dir}' already exists and is not an empty directory.\n`;
			cb(Object.assign(new Error(stderr), { stderr }), "", stderr);
			return;
		}
		clones++;
		mkdirSync(dir, { recursive: true });
		if (clones <= breaks) {
			writeFileSync(join(dir, "partial"), "");
			const stderr = "error: RPC failed\nfatal: early EOF\n";
			cb(Object.assign(new Error(stderr), { stderr }), "", stderr);
			return;
		}
		writeFileSync(join(dir, "SKILL.md"), "");
		cb(null, "", "");
	});
}

/** Runs `promise` to its end, passing each retry's wait without sleeping. */
async function settle<T>(promise: Promise<T>): Promise<T | Error> {
	let done = false;
	const settled = promise
		.catch((err: Error) => err)
		.finally(() => {
			done = true;
		});
	while (!done) {
		await new Promise((resolve) => setImmediate(resolve));
		vi.advanceTimersByTime(100);
	}
	return settled;
}

describe("cloneSource after a partial clone", () => {
	let tempDir: string | undefined;

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setTimeout"] });
	});

	afterEach(async () => {
		vi.useRealTimers();
		if (tempDir !== undefined) await cleanupTempDir(tempDir);
	});

	it("retries into an emptied folder and succeeds", async () => {
		mockGitOnDisk(1);

		const result = await settle(cloneSource(PARSED));

		expect(result).not.toBeInstanceOf(Error);
		const clone = result as { tempDir: string; commit: string };
		tempDir = clone.tempDir;
		expect(clone.commit).toBe(SHA);
		expect(readdirSync(clone.tempDir)).toEqual(["SKILL.md"]);
	});

	it("reports the real cause when every attempt breaks", async () => {
		mockGitOnDisk(Number.POSITIVE_INFINITY);

		const err = await settle(cloneSource(PARSED));

		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toBe(
			"git clone failed after 3 attempts: error: RPC failed\nfatal: early EOF\n",
		);
	});
});

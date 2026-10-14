import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { errorMessage } from "./errors.js";
import {
	execGit,
	GIT_ATTEMPTS,
	isFinalGitError,
	withGitRetry,
} from "./git-utils.js";
import type { ParsedSource } from "./source-parser.js";
import { resolveCloneUrl } from "./source-parser.js";

export interface CloneResult {
	tempDir: string;
	commit: string;
}

const CLONE_TIMEOUT = 60_000;

/**
 * One clone attempt, into an emptied `tempDir`: git refuses a folder a
 * failed attempt left files in, and that refusal would hide the real cause.
 */
async function cloneInto(
	cloneArgs: string[],
	tempDir: string,
): Promise<CloneResult> {
	await rm(tempDir, { recursive: true, force: true });
	await mkdir(tempDir, { mode: 0o700 });
	await execGit(cloneArgs, { timeout: CLONE_TIMEOUT });
	const { stdout } = await execGit(["-C", tempDir, "rev-parse", "HEAD"], {
		timeout: CLONE_TIMEOUT,
	});
	return { tempDir, commit: stdout.trim() };
}

function cloneError(err: unknown): Error {
	if (isFinalGitError(err)) {
		return new Error(`git clone failed: ${errorMessage(err)}`);
	}
	return new Error(
		`git clone failed after ${GIT_ATTEMPTS} attempts: ${errorMessage(err)}`,
	);
}

export async function cloneSource(parsed: ParsedSource): Promise<CloneResult> {
	const url = resolveCloneUrl(parsed);
	const tempDir = await mkdtemp(tmpdir() + "/agntc-");

	const cloneArgs = ["clone", "--depth", "1"];
	if (parsed.ref !== null) {
		cloneArgs.push("--branch", parsed.ref);
	}
	cloneArgs.push(url, tempDir);

	try {
		return await withGitRetry(
			() => cloneInto(cloneArgs, tempDir),
			isFinalGitError,
		);
	} catch (err: unknown) {
		await rm(tempDir, { recursive: true, force: true });
		throw cloneError(err);
	}
}

export async function cleanupTempDir(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}

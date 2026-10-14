import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { errorMessage } from "./errors.js";
import { execGit, GIT_ATTEMPTS, withGitRetry } from "./git-utils.js";
import type { ParsedSource } from "./source-parser.js";
import { resolveCloneUrl } from "./source-parser.js";

export interface CloneResult {
	tempDir: string;
	commit: string;
}

const CLONE_TIMEOUT = 60_000;

const AUTH_ERROR_PATTERNS = [
	"Authentication",
	"Permission denied",
	"could not read Username",
	"could not read Password",
];

function stderrOf(err: unknown): string {
	return (err as { stderr?: string }).stderr ?? "";
}

function isAuthError(err: unknown): boolean {
	const stderr = stderrOf(err);
	return AUTH_ERROR_PATTERNS.some((pattern) => stderr.includes(pattern));
}

async function cloneInto(
	cloneArgs: string[],
	tempDir: string,
): Promise<CloneResult> {
	await execGit(cloneArgs, { timeout: CLONE_TIMEOUT });
	const { stdout } = await execGit(["-C", tempDir, "rev-parse", "HEAD"], {
		timeout: CLONE_TIMEOUT,
	});
	return { tempDir, commit: stdout.trim() };
}

function cloneError(err: unknown): Error {
	if (isAuthError(err)) {
		return new Error(`git clone failed: ${stderrOf(err) || errorMessage(err)}`);
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
		return await withGitRetry(() => cloneInto(cloneArgs, tempDir), isAuthError);
	} catch (err: unknown) {
		await rm(tempDir, { recursive: true, force: true });
		throw cloneError(err);
	}
}

export async function cleanupTempDir(path: string): Promise<void> {
	await rm(path, { recursive: true, force: true });
}

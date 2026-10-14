import { execFile } from "node:child_process";

export interface ExecGitOptions {
	timeout?: number;
	cwd?: string;
}

const DEFAULT_TIMEOUT = 30_000;
const LS_REMOTE_TIMEOUT = 15_000;

/** The wait before each retry of a remote git operation. */
const RETRY_DELAYS = [500, 1000];

/** How many times a remote git operation is tried. */
export const GIT_ATTEMPTS = RETRY_DELAYS.length + 1;

/** A failed git command: what it wrote to stderr, and whether its timeout killed it. */
export interface GitError extends Error {
	stderr: string;
	timedOut: boolean;
}

/**
 * A timed-out command's message opens with the timeout, so a terminal line
 * taken from its first line says so; Node's own message, with the command
 * and any stderr, follows it.
 */
function gitError(
	args: string[],
	timeout: number,
	error: Error & { killed?: boolean },
	stderr: string,
): GitError {
	const timedOut = error.killed === true;
	const message = timedOut
		? `git ${args[0]} timed out after ${timeout / 1000}s\n${error.message}`
		: stderr || error.message;
	return Object.assign(new Error(message), { stderr, timedOut });
}

export function execGit(
	args: string[],
	options?: ExecGitOptions,
): Promise<{ stdout: string; stderr: string }> {
	const { timeout = DEFAULT_TIMEOUT, cwd } = options ?? {};
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd, timeout }, (error, stdout, stderr) => {
			if (error) {
				reject(gitError(args, timeout, error, stderr || ""));
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

// HTTPS credential failures. An SSH "Permission denied" is left out: a key
// refused once can be accepted on the next attempt.
const CREDENTIAL_FAILURES = [
	"Authentication",
	"could not read Username",
	"could not read Password",
];

/**
 * A git failure no retry can mend: a credential failure, which would prompt
 * again at a terminal, or a timeout, which would wait out the timeout again.
 */
export function isFinalGitError(err: unknown): boolean {
	const { stderr = "", timedOut = false } = (err ?? {}) as Partial<GitError>;
	return (
		timedOut || CREDENTIAL_FAILURES.some((pattern) => stderr.includes(pattern))
	);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs a remote git operation up to {@link GIT_ATTEMPTS} times. The last
 * failure, or one `isFinal` says no retry can mend, is thrown as it was.
 */
export async function withGitRetry<T>(
	run: () => Promise<T>,
	isFinal: (err: unknown) => boolean = () => false,
): Promise<T> {
	for (const wait of RETRY_DELAYS) {
		try {
			return await run();
		} catch (err: unknown) {
			if (isFinal(err)) throw err;
		}
		await delay(wait);
	}
	return run();
}

/** `git ls-remote <args>`: every read of a remote that doesn't clone it. */
export function lsRemote(
	args: string[],
): Promise<{ stdout: string; stderr: string }> {
	return withGitRetry(
		() => execGit(["ls-remote", ...args], { timeout: LS_REMOTE_TIMEOUT }),
		isFinalGitError,
	);
}

export interface TagRef {
	tag: string;
	sha: string;
}

const PEELED = "^{}";

/**
 * `ls-remote --tags` output as tags with the commit each points at. An
 * annotated tag's own sha is the tag object; its peeled `^{}` line, when
 * listed, gives the commit. A lightweight tag's sha is the commit already.
 */
export function parseTagRefs(stdout: string): TagRef[] {
	const shas = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const [sha = "", ref = ""] = line.split("\t").map((part) => part.trim());
		if (sha === "" || ref === "") continue;
		const peeled = ref.endsWith(PEELED);
		const tag = ref.replace("refs/tags/", "").replace(PEELED, "");
		if (peeled || !shas.has(tag)) {
			shas.set(tag, sha);
		}
	}
	return [...shas].map(([tag, sha]) => ({ tag, sha }));
}

export async function fetchRemoteTagRefs(url: string): Promise<TagRef[]> {
	const { stdout } = await lsRemote(["--tags", url]);
	return parseTagRefs(stdout);
}

export async function fetchRemoteTags(url: string): Promise<string[]> {
	const refs = await fetchRemoteTagRefs(url);
	return refs.map((r) => r.tag);
}

/** The branch `ls-remote --symref <url> HEAD` says HEAD points at, if any. */
function parseDefaultBranch(stdout: string): string | null {
	return /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(stdout)?.[1] ?? null;
}

/** A remote's default branch, asked of the remote without cloning it. */
export async function fetchDefaultBranch(url: string): Promise<string | null> {
	const { stdout } = await lsRemote(["--symref", url, "HEAD"]);
	return parseDefaultBranch(stdout);
}

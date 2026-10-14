import * as childProcess from "node:child_process";
import { vi } from "vitest";

export function mockExecFile(
	impl: (
		cmd: string,
		args: readonly string[],
		opts: object,
		cb: (err: Error | null, stdout: string, stderr: string) => void,
	) => void,
): void {
	vi.mocked(childProcess.execFile).mockImplementation(
		// biome-ignore lint/complexity/noBannedTypes: vitest mock callback type requires loose Function
		(_cmd: string, _args: unknown, _opts: unknown, cb?: Function | null) => {
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

/**
 * Fails the first `failures` git calls with `stderr`, then answers each with
 * `stdout`, or with what `stdout` gives for its args.
 */
export function mockExecFileFailingFirst(
	failures: number,
	stderr: string,
	stdout: string | ((args: readonly string[]) => string) = "",
): void {
	let calls = 0;
	mockExecFile((_cmd, args, _opts, cb) => {
		calls++;
		if (calls <= failures) {
			cb(Object.assign(new Error(stderr), { stderr }), "", stderr);
			return;
		}
		cb(null, typeof stdout === "string" ? stdout : stdout(args), "");
	});
}

// Taken before any test fakes the timers, so it always yields to real I/O.
const realSetImmediate = setImmediate;

/**
 * Settles `promise` while fake timers run, so a retry's waits pass at once.
 * Between rounds it lets real I/O finish, as a wait a retry schedules after
 * real file work isn't pending until that work is done.
 */
export async function settle<T>(promise: Promise<T>): Promise<T | Error> {
	let done = false;
	const caught = promise
		.catch((err: Error) => err)
		.finally(() => {
			done = true;
		});
	while (!done) {
		await vi.runAllTimersAsync();
		if (!done) {
			await new Promise((resolve) => realSetImmediate(resolve));
		}
	}
	return caught;
}

/** git's stderr when an SSH remote refuses the key: the cause, then git's advice. */
export const SSH_REFUSAL = [
	"git@github.com: Permission denied (publickey).",
	"fatal: Could not read from remote repository.",
	"",
	"Please make sure you have the correct access rights",
	"and the repository exists.",
	"",
].join("\n");

export function buildTagsOutput(
	tags: Array<{ sha: string; tag: string }>,
): string {
	return `${tags.map(({ sha, tag }) => `${sha}\trefs/tags/${tag}`).join("\n")}\n`;
}

// Builds a realistic `ls-remote <url> refs/heads/{ref} refs/tags/{ref}` probe
// payload. Emits a refs/heads line, a refs/tags line, and/or a peeled
// refs/tags^{} line as requested — mirroring buildTagsOutput for the classifier
// probe. Returns "" when no lines are requested (ref advertised as neither).
export function buildRefProbeOutput(opts: {
	head?: { ref: string; sha: string };
	tag?: { ref: string; sha: string };
	peeledTag?: { ref: string; sha: string };
}): string {
	const lines: string[] = [];
	if (opts.head) lines.push(`${opts.head.sha}\trefs/heads/${opts.head.ref}`);
	if (opts.tag) lines.push(`${opts.tag.sha}\trefs/tags/${opts.tag.ref}`);
	if (opts.peeledTag) {
		lines.push(`${opts.peeledTag.sha}\trefs/tags/${opts.peeledTag.ref}^{}`);
	}
	return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

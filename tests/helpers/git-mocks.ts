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

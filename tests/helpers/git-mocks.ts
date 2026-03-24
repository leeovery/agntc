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

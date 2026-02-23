import { execFile } from "node:child_process";

export interface ExecGitOptions {
	timeout?: number;
	cwd?: string;
}

const DEFAULT_TIMEOUT = 30_000;

export function execGit(
	args: string[],
	options?: ExecGitOptions,
): Promise<{ stdout: string; stderr: string }> {
	const { timeout = DEFAULT_TIMEOUT, cwd } = options ?? {};
	return new Promise((resolve, reject) => {
		execFile("git", args, { cwd, timeout }, (error, stdout, stderr) => {
			if (error) {
				const gitError = Object.assign(new Error(stderr || error.message), {
					stderr: stderr || "",
				});
				reject(gitError);
				return;
			}
			resolve({ stdout, stderr });
		});
	});
}

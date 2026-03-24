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

export async function fetchRemoteTags(url: string): Promise<string[]> {
	const { stdout } = await execGit(["ls-remote", "--tags", url], {
		timeout: 15_000,
	});
	const trimmed = stdout.trim();
	if (trimmed === "") return [];
	return trimmed
		.split("\n")
		.filter((line) => line.trim() !== "")
		.filter((line) => !line.includes("^{}"))
		.map((line) => {
			const ref = line.split("\t")[1]?.trim() ?? "";
			return ref.replace("refs/tags/", "");
		});
}

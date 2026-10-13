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
	const { stdout } = await execGit(["ls-remote", "--tags", url], {
		timeout: 15_000,
	});
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
	const { stdout } = await execGit(["ls-remote", "--symref", url, "HEAD"], {
		timeout: 15_000,
	});
	return parseDefaultBranch(stdout);
}

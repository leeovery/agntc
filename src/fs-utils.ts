import { access, readdir, stat } from "node:fs/promises";
import { posix, relative, sep } from "node:path";

export interface DirEntry {
	name: string;
	isDirectory: boolean;
}

export type LocalSourcePathResult =
	| { valid: true }
	| { valid: false; reason: string };

export async function validateLocalSourcePath(
	path: string,
): Promise<LocalSourcePathResult> {
	try {
		const stats = await stat(path);
		if (!stats.isDirectory()) {
			return { valid: false, reason: "path is not a directory" };
		}
		return { valid: true };
	} catch {
		return { valid: false, reason: "path does not exist" };
	}
}

/** The path from `from` to `to` with `/` separators, as manifests record paths. */
export function relativePosix(from: string, to: string): string {
	return relative(from, to).split(sep).join(posix.sep);
}

/** Resolves to true when `path` exists (file or dir), false otherwise. */
export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

export async function readDirEntries(dirPath: string): Promise<DirEntry[]> {
	try {
		const entries = await readdir(dirPath, { withFileTypes: true });
		return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
	} catch {
		return [];
	}
}

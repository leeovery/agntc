import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathExists } from "../fs-utils.js";

export interface ScaffoldFile {
	/** `/`-joined, relative to the folder being scaffolded. */
	path: string;
	content: string;
	mode?: number;
}

export interface ScaffoldResult {
	created: string[];
	skipped: string[];
}

/** What one init type writes, and what it says about the folder afterwards. */
export interface Scaffold {
	files(targetDir: string): ScaffoldFile[];
	/** Why the scaffolded folder isn't what this type promises, if it isn't. */
	warnings(targetDir: string): Promise<string[]>;
}

/** The files of the scaffold already in `targetDir`, which writing it leaves as they are. */
export async function existingFiles(
	targetDir: string,
	files: readonly ScaffoldFile[],
): Promise<string[]> {
	const found: string[] = [];
	for (const { path } of files) {
		if (await pathExists(join(targetDir, path))) {
			found.push(path);
		}
	}
	return found;
}

/** Writes each file that doesn't exist yet; one that does is left as it is. */
export async function writeScaffold(
	targetDir: string,
	files: ScaffoldFile[],
): Promise<ScaffoldResult> {
	const result: ScaffoldResult = { created: [], skipped: [] };
	for (const { path, content, mode } of files) {
		const dest = join(targetDir, path);
		if (await pathExists(dest)) {
			result.skipped.push(path);
			continue;
		}
		await mkdir(dirname(dest), { recursive: true });
		await writeFile(dest, content, { encoding: "utf-8", mode });
		result.created.push(path);
	}
	return result;
}

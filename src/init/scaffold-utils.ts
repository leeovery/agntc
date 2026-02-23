import { access } from "node:fs/promises";

export interface ScaffoldResult {
	created: string[];
	skipped: string[];
	overwritten: string[];
}

export async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

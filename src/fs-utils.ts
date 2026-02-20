import { readdir, stat } from "node:fs/promises";

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

export async function readDirEntries(dirPath: string): Promise<DirEntry[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  } catch {
    return [];
  }
}

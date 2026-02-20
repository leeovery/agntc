import { readdir } from "node:fs/promises";

export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export async function readDirEntries(dirPath: string): Promise<DirEntry[]> {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, isDirectory: e.isDirectory() }));
  } catch {
    return [];
  }
}

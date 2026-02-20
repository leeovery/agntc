import { rm } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage } from "./errors.js";

export async function rollbackCopiedFiles(
  files: string[],
  projectDir: string,
  onWarn?: (message: string) => void,
): Promise<void> {
  for (const file of files) {
    const fullPath = join(projectDir, file);
    try {
      await rm(fullPath, { recursive: true, force: true });
    } catch (err) {
      if (onWarn) {
        onWarn(`Rollback: failed to delete ${file}: ${errorMessage(err)}`);
      }
    }
  }
}

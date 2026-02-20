import { rm } from "node:fs/promises";
import { join } from "node:path";

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
        const message = err instanceof Error ? err.message : String(err);
        onWarn(`Rollback: failed to delete ${file}: ${message}`);
      }
    }
  }
}

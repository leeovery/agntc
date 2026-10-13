import { errorMessage } from "./errors.js";
import { removeInstallPath } from "./nuke-files.js";

export async function rollbackCopiedFiles(
	files: string[],
	installRoot: string,
	onWarn?: (message: string) => void,
): Promise<void> {
	for (const file of files) {
		try {
			await removeInstallPath(installRoot, file);
		} catch (err) {
			if (onWarn) {
				onWarn(`Rollback: failed to delete ${file}: ${errorMessage(err)}`);
			}
		}
	}
}

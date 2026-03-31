export const FILE_LIST_MAX = 10;

/**
 * Formats an array of file paths as indented bullet lines.
 * Lists exceeding FILE_LIST_MAX entries are truncated with a summary line.
 */
export function formatFileList(files: string[]): string {
	const displayed = files.slice(0, FILE_LIST_MAX);
	const lines = displayed.map((f) => `  - ${f}`);

	const remaining = files.length - FILE_LIST_MAX;
	if (remaining > 0) {
		const noun = remaining === 1 ? "file" : "files";
		lines.push(`  ...and ${remaining} more ${noun}`);
	}

	return lines.join("\n");
}

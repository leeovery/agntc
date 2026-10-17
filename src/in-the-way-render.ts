import type { Row } from "./terminal/types.js";

/**
 * Another entry whose files are in an install's way, as the question about
 * removing it asks: the entry, then the files, dim.
 */
export function collisionRow(subject: string, files: readonly string[]): Row {
	return inTheWayRow(subject, "its files are in the way", files);
}

/**
 * An item whose way files agntc didn't install stand in, as the question
 * about replacing them asks: the item, then the files, dim.
 */
export function unmanagedRow(subject: string, files: readonly string[]): Row {
	return inTheWayRow(
		subject,
		"files agntc didn't install are in its way",
		files,
	);
}

function inTheWayRow(
	subject: string,
	detail: string,
	files: readonly string[],
): Row {
	return {
		status: "attention",
		subject,
		detail,
		children: files.map((name) => ({ name, dim: true })),
	};
}

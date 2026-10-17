import { homedir } from "node:os";
import { homeShortened } from "./scope.js";
import type { Row } from "./terminal/types.js";

/**
 * Another entry whose files are in an install's way, as the question about
 * removing it asks: its key, then the files, dim.
 */
export function collisionRow(key: string, files: readonly string[]): Row {
	return inTheWayRow(key, "its files are in the way", files);
}

/**
 * An item whose way files agntc didn't install stand in, as the question
 * about replacing them asks: its key, then the files, dim.
 */
export function unmanagedRow(key: string, files: readonly string[]): Row {
	return inTheWayRow(key, "files agntc didn't install are in its way", files);
}

/** A local key shortened against the home folder, as every row names one. */
function inTheWayRow(
	key: string,
	detail: string,
	files: readonly string[],
): Row {
	return {
		status: "attention",
		subject: homeShortened(key, homedir()),
		detail,
		children: files.map((name) => ({ name, dim: true })),
	};
}

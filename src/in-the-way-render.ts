import type { EntryHead } from "./entry-head.js";
import type { Child, Row } from "./terminal/types.js";

/**
 * Another entry whose files are in an install's way, as the question about
 * removing it asks: the entry, then the files, dim.
 */
export function collisionRow(head: EntryHead, files: readonly string[]): Row {
	return inTheWayRow(head, "its files are in the way", files);
}

/**
 * An item whose way files agntc didn't install stand in, as the question
 * about replacing them asks: the item, then the files, dim.
 */
export function unmanagedRow(head: EntryHead, files: readonly string[]): Row {
	return inTheWayRow(head, "files agntc didn't install are in its way", files);
}

function inTheWayRow(
	head: EntryHead,
	detail: string,
	files: readonly string[],
): Row {
	return {
		status: "attention",
		...head,
		detail,
		children: files.map(fileChild),
	};
}

/** A path in the way, dim, a folder by its trailing slash, which a cut row counts it by. */
function fileChild(name: string): Child {
	return { name, dim: true, noun: name.endsWith("/") ? "folder" : "file" };
}

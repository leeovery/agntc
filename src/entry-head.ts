import { homeShortened } from "./scope.js";
import type { Row, RowHead } from "./terminal/types.js";

/** How a row names an entry or an item: its subject, and a local one's meta. */
export type EntryHead = Pick<Row, "subject" | "meta">;

/** A local entry's row: its folder, shortened against the home folder. */
export function localHead(key: string, home: string): RowHead {
	return { subject: homeShortened(key, home), meta: "local" };
}

/** How a question's row names what `key` is: a local one as {@link localHead} does, a remote one by its key. */
export function entryHead(
	key: string,
	local: boolean,
	home: string,
): EntryHead {
	return local ? localHead(key, home) : { subject: key };
}

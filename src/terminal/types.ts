import type { Remedy } from "../message.js";

/** What happened to a row's subject; it picks the glyph and its colour. */
export type Status =
	| "done"
	| "unchanged"
	| "attention"
	| "failed"
	| "subject"
	| "newer"
	| "note";

export interface Move {
	from: string;
	to: string;
}

/**
 * A row's detail: plain text, a version move, or a label in the row's own
 * colour with a dim aside after it (`not checked · <cause>`).
 */
export type Detail =
	| string
	| { move: Move; note?: string }
	| { label: string; aside?: string };

export interface Row {
	status: Status;
	subject: string;
	meta?: string;
	detail?: Detail;
	children?: Child[];
}

export interface Child {
	name: string;
	/** Set by the caller when the child's own outcome is worth a glyph. */
	status?: Status;
	detail?: string;
}

export interface TallyItem {
	count: number;
	label: string;
	status: Status;
}

export interface NextItem {
	subject: string;
	remedy: Remedy;
}

export interface Header {
	command: string;
	where?: string;
	version?: string;
}

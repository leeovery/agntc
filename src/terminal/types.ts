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

/** A row's subject and its dim meta: a repo and the intent it tracks, or a local entry's folder. */
export type RowHead = Required<Pick<Row, "subject" | "meta">>;

export interface Child {
	name: string;
	/** Set by the caller when the child's own outcome is worth a glyph. */
	status?: Status;
	detail?: string;
}

/**
 * What a block's columns are measured from: each row's subject and meta, and
 * its children's names, a child with a status given a glyph's room.
 */
export type BlockSubject = Pick<Row, "subject" | "meta"> & {
	children?: readonly Pick<Child, "name" | "status">[];
};

/** A step still running: the row it will settle into, when it has one, and what it's doing. */
export interface Progress {
	subject?: string;
	meta?: string;
	/** Dim, as `updating to v0.2.5…`. */
	text: string;
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

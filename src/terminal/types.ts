import type { Remedy } from "../message.js";

/** What happened to a row's subject; it picks the glyph and its colour. */
export type Status =
	| "done"
	| "unchanged"
	| "attention"
	| "failed"
	| "subject"
	| "newer"
	| "note"
	| "local";

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
	/** Labelled lines under the row's own, above its children. */
	fields?: Field[];
	children?: Child[];
}

/** A labelled line under a row: its label dim, in a column as wide as the row's widest. */
export interface Field {
	label: string;
	/** Words wrapped beside the label, or items two spaces apart, wrapping between them. */
	value: string | readonly string[];
	/** Paints the value in the status's colour, as a failed check's reason does; plain without. */
	status?: Status;
	/** What one of its items is, as `folder`: a row cut short counts them by it. */
	noun?: string;
}

/** A row's subject and its dim meta: a repo and the intent it tracks, or a local entry's folder. */
export type RowHead = Required<Pick<Row, "subject" | "meta">>;

export interface Child {
	name: string;
	/** Dim after the name, a space on, as a path telling two children of one name apart. */
	aside?: string;
	/** Set by the caller when the child's own outcome is worth a glyph. */
	status?: Status;
	detail?: string;
	/** Drawn dim whole, as a line standing in for children left out. */
	dim?: boolean;
	/** How many levels it hangs below the row, under the child before it one level up: 0 unless given. */
	depth?: number;
	/** What it is, as `file`: a row cut short counts the children left out by it. */
	noun?: string;
}

/** What one of something is, and several. */
export interface Noun {
	one: string;
	many: string;
}

/** Rows fitted together, as a question asks about them, and what one is, for counting those a cut leaves out. */
export interface Rows {
	rows: readonly Row[];
	noun: Noun;
}

/**
 * What a block's columns are measured from: each row's subject and meta, and
 * its children's names, a child with a status given a glyph's room.
 */
export type BlockSubject = Pick<Row, "subject" | "meta"> & {
	children?: readonly Pick<Child, "name" | "status" | "depth">[];
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

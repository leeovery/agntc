/**
 * What a warning, note or error says. A string is plain text; a rich message
 * carries a cause and a remedy the terminal lays out, and the exact sentence
 * machine mode prints.
 */
export type Message = string | RichMessage;

export interface RichMessage {
	text: string;
	/** Shown dim on its own line, as an error's git cause. */
	cause?: string;
	remedy?: Remedy;
	/** The exact machine-mode sentence; the terminal renderer never reads it. */
	plain: string;
}

/**
 * A message about one subject, an entry or a repo, that a row or a Next item
 * names apart from what's said of it.
 */
export interface SubjectMessage extends RichMessage {
	subject: string;
	/** What the text says of the subject, without naming it. */
	detail: string;
}

/** A message about a subject that always says what can be done. */
export type Advice = SubjectMessage & { remedy: Remedy };

/** A remedy on its own, with the sentence machine mode prints for it. */
export interface WordedRemedy {
	remedy: Remedy;
	/** The remedy as machine mode words it. */
	plain: string;
}

export interface Remedy {
	/** What the steps are for, as `To update it anyway:`. */
	lead: string;
	steps: Step[];
}

export type Step =
	| { command: string }
	| { choice: string[] }
	| { words: string };

/** Whether a message has nothing to say at a terminal: a rich one whose words are machine mode's alone. */
export function isMachineOnly(message: Message): boolean {
	return (
		typeof message !== "string" &&
		message.text === "" &&
		message.cause === undefined &&
		message.remedy === undefined
	);
}

/** The message as machine mode prints it: a string as it is, a rich one its `plain`. */
export function plainText(message: Message): string {
	return typeof message === "string" ? message : message.plain;
}

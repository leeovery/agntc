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

export interface Remedy {
	/** What the steps are for, as `To update it anyway:`. */
	lead: string;
	steps: Step[];
}

export type Step =
	| { command: string }
	| { choice: string[] }
	| { words: string };

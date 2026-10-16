import { type Readable, Transform, type TransformCallback } from "node:stream";

/** The stdin a prompt reads: a terminal's, with its raw mode. */
export interface PromptInput extends Readable {
	isTTY?: boolean;
	isRaw?: boolean;
	setRawMode?(mode: boolean): unknown;
}

const OSC_START = "\x1b]";
const ESC = "\x1b";
const BEL = "\x07";
const ST_END = "\\";
/** How long, and how far, a sequence split across reads is held for its end. */
const HOLD_MS = 100;
const HOLD_BYTES = 64;

interface SequenceEnd {
	/** Where the sequence's body stops. */
	body: number;
	/** Where what follows it starts. */
	next: number;
	/** False when an ESC cut it short, as a terminal reads it too. */
	complete: boolean;
}

/**
 * What a prompt reads instead of stdin. Every OSC sequence (`ESC ]` … BEL or
 * ST) is taken out and its body reported, so a terminal's reply never reaches
 * the prompt as keys, however late it comes. Every other byte passes at once,
 * but for a read's last ESC, which may open a sequence split across reads.
 *
 * What's held waits at most 100 ms from when the hold began. A lone ESC
 * passes as soon as the byte after it isn't `]`, or when the wait ends, as
 * it was the escape key. A sequence's start is dropped when the wait ends or
 * it grows past 64 bytes, as it was never keys.
 *
 * It reads as a terminal (`isTTY`), and its raw mode is the source's, so the
 * prompt engine sets raw mode on stdin through it.
 */
export class InputFilter extends Transform {
	readonly isTTY = true;
	private held = "";
	private holdTimer: NodeJS.Timeout | undefined;
	private readonly sequenceListeners = new Set<(body: string) => void>();

	constructor(private readonly source: PromptInput) {
		super();
	}

	get isRaw(): boolean {
		return this.source.isRaw === true;
	}

	setRawMode(mode: boolean): this {
		this.source.setRawMode?.(mode);
		return this;
	}

	/** Hears the body of each sequence taken out (`11;rgb:…`); the return stops it. */
	onSequence(listener: (body: string) => void): () => void {
		this.sequenceListeners.add(listener);
		return () => {
			this.sequenceListeners.delete(listener);
		};
	}

	override _transform(
		chunk: Buffer,
		_encoding: BufferEncoding,
		done: TransformCallback,
	): void {
		// latin1 maps each byte to one character and back, so a key's UTF-8
		// split across reads passes through whole.
		this.strip(this.held + chunk.toString("latin1"));
		done();
	}

	override _flush(done: TransformCallback): void {
		this.endHold();
		done();
	}

	override _destroy(
		error: Error | null,
		done: (error?: Error | null) => void,
	): void {
		this.stopHolding();
		done(error);
	}

	private strip(text: string): void {
		this.held = "";
		let passed = "";
		let at = 0;
		while (at < text.length) {
			const start = text.indexOf(OSC_START, at);
			if (start === -1) {
				const rest = text.slice(at);
				this.held = rest.endsWith(ESC) ? ESC : "";
				passed += rest.slice(0, rest.length - this.held.length);
				break;
			}
			passed += text.slice(at, start);
			const end = sequenceEnd(text, start + OSC_START.length);
			if (end === undefined) {
				this.held = text.slice(start);
				break;
			}
			if (end.complete) {
				this.report(text.slice(start + OSC_START.length, end.body));
			}
			at = end.next;
		}
		if (this.held.length > HOLD_BYTES) {
			this.held = "";
		}
		this.emitText(passed);
		if (this.held === "") {
			this.stopHolding();
		} else {
			this.holdTimer ??= setTimeout(() => this.endHold(), HOLD_MS);
		}
	}

	/** Lets a held ESC through as the escape key, and drops a sequence's start. */
	private endHold(): void {
		this.stopHolding();
		if (this.held === ESC) {
			this.emitText(ESC);
		}
		this.held = "";
	}

	private stopHolding(): void {
		clearTimeout(this.holdTimer);
		this.holdTimer = undefined;
	}

	private emitText(text: string): void {
		if (text !== "") {
			this.push(Buffer.from(text, "latin1"));
		}
	}

	private report(body: string): void {
		for (const listener of this.sequenceListeners) {
			listener(body);
		}
	}
}

/** Where a sequence whose body starts at `from` ends; undefined while its end is still to come. */
function sequenceEnd(text: string, from: number): SequenceEnd | undefined {
	for (let at = from; at < text.length; at++) {
		const char = text.charAt(at);
		if (char === BEL) {
			return { body: at, next: at + 1, complete: true };
		}
		if (char === ESC) {
			if (at + 1 === text.length) {
				return undefined;
			}
			return text.charAt(at + 1) === ST_END
				? { body: at, next: at + 2, complete: true }
				: { body: at, next: at, complete: false };
		}
	}
	return undefined;
}

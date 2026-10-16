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
/** How long core's readline waits after an ESC for what follows it (its escapeCodeTimeout). */
const ESCAPE_MS = 50;
/** How long, and how far, a sequence split across reads is held for its end. */
const SEQUENCE_MS = 100;
const HOLD_BYTES = 64;
/** A byte of a colour reply's body (`11;rgb:1e1e/1e1e/1e1e`) or of a query's. */
const REPLY_BYTE = /^[\da-fA-F;:/rg?]$/;

/** Where a lone ESC's wait ran out with nothing after it: readline's escape key. */
const ESCAPE_KEY = Symbol("escape key");
type Delivery = string | typeof ESCAPE_KEY;

interface Scan {
	passed: string;
	/** The start of a sequence whose end is still to come. */
	held: string;
	bodies: string[];
}

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
 * the prompt as keys. Every other byte passes at once, read by readline as it
 * would read stdin, but for the last ESC of what passes.
 *
 * That ESC waits as long as readline waits after one, from when it was read,
 * whatever sequence is taken out after it meanwhile: a `]` straight after it
 * starts a sequence, any other byte passes with it, as readline would join
 * them, and nothing by then makes it the escape key. A sequence's start is
 * held for its end 100 ms at most and 64 bytes. Dropped then, as it was never
 * keys, the rest of a reply that may still come is taken out too, up to its
 * BEL or ST: until a byte no reply holds, or another 100 ms.
 *
 * Until released it reads all the same but delivers nothing, keeping it in
 * order for the release: while the background is asked, no prompt reads.
 *
 * It reads as a terminal (`isTTY`), and its raw mode is the source's, so the
 * prompt engine sets raw mode on stdin through it.
 */
export class InputFilter extends Transform {
	readonly isTTY = true;
	/** The start of a sequence whose end is still to come. */
	private held = "";
	/** Whether what's read is still the rest of a sequence whose start was dropped. */
	private inTail = false;
	/** The held sequence's wait for its end, or a dropped one's for its rest. */
	private timer: NodeJS.Timeout | undefined;
	/** The last ESC's wait for the key after it. */
	private escape: NodeJS.Timeout | undefined;
	/** Whether that ESC is the last byte read, so a `]` read next opens a sequence with it. */
	private escapeLast = false;
	private released = false;
	/** What's held back until released: text, and the escape key wherever a lone ESC's wait ran out. */
	private readonly queue: Delivery[] = [];
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

	/**
	 * Lets through everything held back, in order, then each key as it comes.
	 * The session calls it once readline reads the filter, so each push reaches
	 * readline as it's made and the escape key, handed over at once, lands
	 * between the text either side.
	 */
	release(): void {
		this.released = true;
		for (const item of this.queue.splice(0)) {
			this.send(item);
		}
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
		if (chunk.length > 0) {
			// latin1 maps each byte to one character and back, so a key's UTF-8
			// split across reads passes through whole.
			this.strip(chunk.toString("latin1"));
		}
		done();
	}

	/** A waiting ESC is stdin's last byte, read in turn; a sequence's start is dropped. */
	override _flush(done: TransformCallback): void {
		if (this.escape !== undefined) {
			this.stopEscape();
			this.deliver(ESC);
		}
		this.held = "";
		this.inTail = false;
		this.stopWaiting();
		done();
	}

	override _destroy(
		error: Error | null,
		done: (error?: Error | null) => void,
	): void {
		this.stopWaiting();
		this.stopEscape();
		done(error);
	}

	private strip(chunk: string): void {
		const opens = this.escapeLast;
		this.escapeLast = false;
		const after = this.afterTail(chunk);
		if (after === undefined) {
			return;
		}
		const previous = this.held;
		let text = previous + after;
		if (opens && text.startsWith("]")) {
			this.stopEscape();
			text = ESC + text;
		}
		const { passed, held, bodies } = scan(text);
		for (const body of bodies) {
			this.report(body);
		}
		this.pass(passed);
		this.escapeLast = held === "" && text.endsWith(ESC);
		this.hold(held, previous !== "" && held === text);
	}

	/** Holds a sequence's start; its wait starts afresh unless it carries on the one already held. */
	private hold(held: string, continued: boolean): void {
		this.held = held;
		if (held.length > HOLD_BYTES) {
			this.dropSequence();
		} else if (held === "") {
			this.stopWaiting();
		} else if (!continued) {
			this.wait();
		}
	}

	/** Drops a sequence's start, then takes out what of its reply is still to come. */
	private dropSequence(): void {
		this.held = "";
		this.inTail = true;
		this.wait();
	}

	/**
	 * What of `text` follows a dropped sequence's rest, all of it when there's
	 * none to take out; undefined while it's all rest. Once the rest ends, the
	 * hold of what follows it ends or restarts the rest's wait.
	 */
	private afterTail(text: string): string | undefined {
		if (!this.inTail) {
			return text;
		}
		const end = tailEnd(text);
		if (end === undefined) {
			return undefined;
		}
		this.inTail = false;
		return text.slice(end);
	}

	private wait(): void {
		clearTimeout(this.timer);
		this.timer = setTimeout(() => this.waited(), SEQUENCE_MS);
	}

	private waited(): void {
		this.timer = undefined;
		if (this.inTail) {
			this.inTail = false;
		} else {
			this.dropSequence();
		}
	}

	private stopWaiting(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}

	/** Keys: an ESC waiting goes on with them, and their last ESC waits in turn. */
	private pass(text: string): void {
		if (text === "") {
			return;
		}
		let keys = text;
		if (this.escape !== undefined) {
			this.stopEscape();
			keys = ESC + keys;
		}
		if (keys.endsWith(ESC)) {
			keys = keys.slice(0, -1);
			this.escape = setTimeout(() => this.escaped(), ESCAPE_MS);
		}
		if (keys !== "") {
			this.deliver(keys);
		}
	}

	private escaped(): void {
		this.escape = undefined;
		this.escapeLast = false;
		this.deliver(ESCAPE_KEY);
	}

	private stopEscape(): void {
		clearTimeout(this.escape);
		this.escape = undefined;
	}

	private deliver(item: Delivery): void {
		if (this.released) {
			this.send(item);
		} else {
			this.queue.push(item);
		}
	}

	/**
	 * Text is pushed; the escape key is handed over as the key readline makes
	 * of an ESC nothing followed in time, as a pushed ESC would start its wait
	 * over.
	 */
	private send(item: Delivery): void {
		if (item === ESCAPE_KEY) {
			this.emit("keypress", undefined, {
				sequence: ESC,
				name: "escape",
				ctrl: false,
				meta: true,
				shift: false,
			});
		} else {
			this.push(Buffer.from(item, "latin1"));
		}
	}

	private report(body: string): void {
		for (const listener of this.sequenceListeners) {
			listener(body);
		}
	}
}

/** `text` read for its sequences: what passes as keys, a last sequence's start held for its end, and each body taken out. */
function scan(text: string): Scan {
	const bodies: string[] = [];
	let passed = "";
	let at = 0;
	while (at < text.length) {
		const start = text.indexOf(OSC_START, at);
		if (start === -1) {
			return { passed: passed + text.slice(at), held: "", bodies };
		}
		passed += text.slice(at, start);
		const end = sequenceEnd(text, start + OSC_START.length);
		if (end === undefined) {
			return { passed, held: text.slice(start), bodies };
		}
		if (end.complete) {
			bodies.push(text.slice(start + OSC_START.length, end.body));
		}
		at = end.next;
	}
	return { passed, held: "", bodies };
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

/** Where what follows a reply's rest starts: past its BEL or ST, or at a byte no reply holds; undefined while it's all reply. */
function tailEnd(text: string): number | undefined {
	for (let at = 0; at < text.length; at++) {
		const char = text.charAt(at);
		if (char === BEL) {
			return at + 1;
		}
		if (char === ESC && text.charAt(at + 1) === ST_END) {
			return at + 2;
		}
		if (!REPLY_BYTE.test(char)) {
			return at;
		}
	}
	return undefined;
}

import type { Interface } from "node:readline";
import { Prompt } from "@clack/core";

/**
 * Core's prompt as a session runs it: one that ends as a cancel when its
 * readline closes under it, that can be closed without an answer, and whose
 * readline the session can reach.
 */
export class Engine extends Prompt {
	private closed = false;

	/** Whether it's still asking: neither answered nor cancelled. */
	get asking(): boolean {
		return this.state !== "submit" && this.state !== "cancel";
	}

	/** The readline core reads keys through, from `prompt()` to its close; core keeps it private. */
	get readline(): Interface | undefined {
		return (this as unknown as { rl?: Interface }).rl;
	}

	/**
	 * Readline closes itself on ctrl-d at an empty line, ctrl-c and stdin's
	 * end, turning raw mode off; core goes on asking, deaf to every key after.
	 */
	override prompt(): Promise<string | symbol> {
		const answered = super.prompt();
		this.readline?.once("close", () => {
			if (this.asking) {
				this.abandon();
			}
		});
		return answered;
	}

	/**
	 * Closes as a cancel does, for a session that can't go on: its readline
	 * and listeners go, and core writes its closing newline.
	 */
	abandon(): void {
		this.state = "cancel";
		this.close();
	}

	/** Once: readline closes in its own handling of a key, ahead of core's, which closes again on a cancel. */
	protected override close(): void {
		if (!this.closed) {
			this.closed = true;
			super.close();
		}
	}
}

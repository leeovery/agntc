import type { Interface } from "node:readline";
import { Prompt } from "@clack/core";

const CTRL_D = "\x04";

/**
 * Core's prompt as a session runs it: one that ends as a cancel on ctrl-d
 * or when its readline closes under it, that can be closed without an
 * answer, and whose readline the session can reach.
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
	 * Ctrl-d cancels whatever readline's line holds: core never clears it, so
	 * the prompt's own keys (j, space, tab) stay in it, and readline ends its
	 * input on ctrl-d only when it's empty. Readline also closes itself at
	 * stdin's end, turning raw mode off, while core goes on asking.
	 */
	override prompt(): Promise<string | symbol> {
		this.on("key", (key) => {
			if (key === CTRL_D) {
				this.abandon();
			}
		});
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

import { Prompt } from "@clack/core";

/** Core's prompt as a session runs it: one it can close without an answer. */
export class Engine extends Prompt {
	/**
	 * Closes as a cancel does, for a session that can't go on: its readline
	 * and listeners go, and core writes its closing newline.
	 */
	abandon(): void {
		this.state = "cancel";
		this.close();
	}
}

import { Prompt } from "@clack/core";
import { firstStop, scrollWindow, stepCursor } from "./list-window.js";
import { noFrame } from "./session.js";

type EngineOptions = Omit<ConstructorParameters<typeof Prompt>[0], "render">;

/**
 * Core's prompt over a list of lines: ↑↓ (and core's j and k) move a cursor
 * that passes over headings and wraps round the ends, and a window of
 * `size` lines follows it.
 */
export class ListEngine extends Prompt {
	cursor: number;
	top: number;

	constructor(
		private readonly headings: readonly boolean[],
		private readonly size: number,
		options: EngineOptions,
	) {
		super({ ...options, render: noFrame }, false);
		this.cursor = firstStop(headings);
		this.top = scrollWindow(headings, this.cursor, 0, size);
		this.on("cursor", (action) => {
			if (action === "up" || action === "down") {
				this.move(action === "up" ? -1 : 1);
			}
		});
	}

	private move(by: 1 | -1): void {
		this.cursor = stepCursor(this.headings, this.cursor, by);
		this.top = scrollWindow(this.headings, this.cursor, this.top, this.size);
	}
}

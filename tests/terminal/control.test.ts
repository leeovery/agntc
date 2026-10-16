import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { type ExitHost, restoreOnExit } from "../../src/terminal/control.js";

const EVENTS = ["exit", "SIGINT", "SIGTERM"] as const;

class FakeHost extends EventEmitter implements ExitHost {
	exit = vi.fn();
}

const listening = (host: EventEmitter) =>
	EVENTS.map((event) => host.listenerCount(event));

describe("restoreOnExit", () => {
	it("restores when the process exits, leaving the exit to it", () => {
		const host = new FakeHost();
		const restore = vi.fn();
		restoreOnExit(host, restore);
		host.emit("exit");
		expect(restore).toHaveBeenCalledExactlyOnceWith("exit");
		expect(host.exit).not.toHaveBeenCalled();
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	])("restores on %s, told it was that signal, then exits %i", (signal, code) => {
		const host = new FakeHost();
		const order: string[] = [];
		host.exit.mockImplementation(() => order.push("exit"));
		restoreOnExit(host, (event) => order.push(`restore ${event}`));
		host.emit(signal);
		expect(order).toEqual([`restore ${signal}`, "exit"]);
		expect(host.exit).toHaveBeenCalledWith(code);
	});

	it("watches all three until stopped", () => {
		const host = new FakeHost();
		const restore = vi.fn();
		const stop = restoreOnExit(host, restore);
		expect(listening(host)).toEqual([1, 1, 1]);
		stop();
		expect(listening(host)).toEqual([0, 0, 0]);
		host.emit("exit");
		expect(restore).not.toHaveBeenCalled();
	});
});

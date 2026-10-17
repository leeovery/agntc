import { describe, expect, it, vi } from "vitest";
import { RunSignals } from "../../src/terminal/control.js";
import { FakeHost } from "./prompts/terminal.js";

const EVENTS = ["exit", "SIGINT", "SIGTERM", "SIGTSTP"] as const;

const listening = (host: FakeHost) =>
	EVENTS.map((event) => host.listenerCount(event));

function watched() {
	const host = new FakeHost();
	const order: string[] = [];
	const handlers = {
		exit: vi.fn(() => order.push("exit handled")),
		interrupt: vi.fn(() => order.push(`interrupt ${listening(host)}`)),
		suspend: vi.fn(() => order.push("suspend")),
	};
	host.exit.mockImplementation((code) =>
		order.push(`exit ${code} ${listening(host)}`),
	);
	const signals = new RunSignals(host, handlers);
	return { host, order, handlers, signals };
}

describe("RunSignals", () => {
	it("listens for nothing until it watches, and for all four until it stops", () => {
		const { host, signals } = watched();
		expect(listening(host)).toEqual([0, 0, 0, 0]);
		signals.watch();
		signals.watch();
		expect(listening(host)).toEqual([1, 1, 1, 1]);
		signals.unwatch();
		expect(listening(host)).toEqual([0, 0, 0, 0]);
	});

	it("puts the terminal back when the process exits, leaving the exit to it", () => {
		const { host, handlers, signals } = watched();
		signals.watch();
		host.emit("exit");
		expect(handlers.exit).toHaveBeenCalledOnce();
		expect(handlers.interrupt).not.toHaveBeenCalled();
		expect(host.exit).not.toHaveBeenCalled();
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	])("hands %s to the run, stops watching, then exits %i", (signal, code) => {
		const { host, order, signals } = watched();
		signals.watch();
		host.emit(signal);
		expect(order).toEqual(["interrupt 1,1,1,1", `exit ${code} 0,0,0,0`]);
	});

	it("stops watching and exits with the signal's code though the run throws handling it", () => {
		const { host, handlers, signals } = watched();
		handlers.interrupt.mockImplementation(() => {
			throw new Error("EIO");
		});
		signals.watch();
		expect(() => host.emit("SIGTERM")).toThrow("EIO");
		expect(host.exit.mock.calls).toEqual([[143]]);
		expect(listening(host)).toEqual([0, 0, 0, 0]);
	});

	it("hands a SIGTSTP to the run, and goes on watching", () => {
		const { host, handlers, signals } = watched();
		signals.watch();
		host.emit("SIGTSTP");
		expect(handlers.suspend).toHaveBeenCalledOnce();
		expect(host.exit).not.toHaveBeenCalled();
		expect(listening(host)).toEqual([1, 1, 1, 1]);
	});

	it("stops the whole process group with SIGTSTP let go, so the signal stops it, and takes it back once continued", () => {
		const { host, signals } = watched();
		signals.watch();
		const during: number[][] = [];
		host.kill.mockImplementation(() => during.push(listening(host)));
		signals.stopGroup();
		expect(host.kill.mock.calls).toEqual([[0, "SIGTSTP"]]);
		expect(during).toEqual([[1, 1, 1, 0]]);
		expect(listening(host)).toEqual([1, 1, 1, 1]);
	});

	it("stops the group unwatched without starting to watch", () => {
		const { host, signals } = watched();
		signals.stopGroup();
		expect(host.kill.mock.calls).toEqual([[0, "SIGTSTP"]]);
		expect(listening(host)).toEqual([0, 0, 0, 0]);
	});
});

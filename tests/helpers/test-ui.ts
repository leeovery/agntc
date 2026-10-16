import { type Mock, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { FailOptions, Log, Spinner, Ui } from "../../src/ui.js";

export interface TestSpinner extends Spinner {
	start: Mock<Spinner["start"]>;
	stop: Mock<Spinner["stop"]>;
}

/** A generic prompt keeps its signature, which a `Mock` alone would erase. */
type Prompt<F extends Ui["select"] | Ui["multiselect"]> = F & Mock<F>;

/** A line of output as a terminal shows it, whichever `Ui` call drew it. */
export type Channel =
	| "info"
	| "warn"
	| "error"
	| "cancel"
	| "success"
	| "message";

/**
 * An interactive `Ui` whose every member is a `vi.fn`. Prompts reject until a
 * test scripts them, so an unanswered question can't pass as a cancel.
 */
export interface TestUi extends Ui {
	readonly mode: "interactive";
	readonly log: { [K in keyof Log]: Mock<Log[K]> };
	warn: Mock<Ui["warn"]>;
	note: Mock<Ui["note"]>;
	intro: Mock<Ui["intro"]>;
	outro: Mock<Ui["outro"]>;
	cancel: Mock<Ui["cancel"]>;
	spinner: Mock<() => TestSpinner>;
	box: Mock<Ui["box"]>;
	select: Prompt<Ui["select"]>;
	multiselect: Prompt<Ui["multiselect"]>;
	confirm: Mock<Ui["confirm"]>;
	report: Mock<Ui["report"]>;
	fail: Mock<Ui["fail"]>;
	/** Every handle `spinner()` returned, in the order it returned them. */
	readonly spinners: TestSpinner[];
	/** The messages drawn on a channel, in call order across every call that draws there. */
	said(channel: Channel): string[];
	/** The `invocationCallOrder` of each line `said(channel)` returns, in the same order. */
	saidOrders(channel: Channel): number[];
}

function unscripted(name: string) {
	return vi.fn(async (prompt: { message: string }): Promise<never> => {
		throw new Error(`unscripted ${name}: "${prompt.message}"`);
	});
}

type Line = [order: number, message: string];

function lines(fn: Mock<(message: string) => void>): Line[] {
	return fn.mock.calls.map(([message], i) => [
		fn.mock.invocationCallOrder[i]!,
		message,
	]);
}

function failLines(fn: TestUi["fail"], style: FailOptions["style"]): Line[] {
	return fn.mock.calls.flatMap(([message, options], i): Line[] =>
		(options?.style ?? "cancel") === style
			? [[fn.mock.invocationCallOrder[i]!, message]]
			: [],
	);
}

function channelLines(ui: TestUi, channel: Channel): Line[] {
	return unsortedLines(ui, channel).sort(([a], [b]) => a - b);
}

function unsortedLines(ui: TestUi, channel: Channel): Line[] {
	switch (channel) {
		case "info":
			return [...lines(ui.log.info), ...lines(ui.note)];
		case "warn":
			return [...lines(ui.log.warn), ...lines(ui.warn)];
		case "error":
			return [...lines(ui.log.error), ...failLines(ui.fail, "error")];
		case "cancel":
			return [...lines(ui.cancel), ...failLines(ui.fail, "cancel")];
		case "success":
			return lines(ui.log.success);
		case "message":
			return lines(ui.log.message);
	}
}

export function testUi(): TestUi {
	const spinners: TestSpinner[] = [];
	const ui: TestUi = {
		mode: "interactive",
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			success: vi.fn(),
			message: vi.fn(),
		},
		warn: vi.fn(),
		note: vi.fn(),
		intro: vi.fn(),
		outro: vi.fn(),
		cancel: vi.fn(),
		spinner: vi.fn(() => {
			const handle = { start: vi.fn(), stop: vi.fn() };
			spinners.push(handle);
			return handle;
		}),
		box: vi.fn(),
		select: unscripted("select") as Prompt<Ui["select"]>,
		multiselect: unscripted("multiselect") as Prompt<Ui["multiselect"]>,
		confirm: unscripted("confirm"),
		report: vi.fn(),
		fail: vi.fn((): never => {
			throw new ExitSignal(1);
		}),
		spinners,
		said: (channel) => channelLines(ui, channel).map(([, message]) => message),
		saidOrders: (channel) => channelLines(ui, channel).map(([order]) => order),
	};
	return ui;
}

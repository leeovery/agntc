import { type Mock, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { Log, Spinner, Ui } from "../../src/ui.js";

export interface TestSpinner extends Spinner {
	start: Mock<Spinner["start"]>;
	stop: Mock<Spinner["stop"]>;
}

/** A generic prompt keeps its signature, which a `Mock` alone would erase. */
type Prompt<F extends Ui["select"] | Ui["multiselect"]> = F & Mock<F>;

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
}

function unscripted(name: string) {
	return vi.fn(async (prompt: { message: string }): Promise<never> => {
		throw new Error(`unscripted ${name}: "${prompt.message}"`);
	});
}

export function testUi(): TestUi {
	const spinners: TestSpinner[] = [];
	return {
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
	};
}

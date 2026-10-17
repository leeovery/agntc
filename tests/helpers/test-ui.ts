import { type Mock, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import { type Message, plainText } from "../../src/message.js";
import type { BlockSubject, Progress, Row } from "../../src/terminal/types.js";
import type {
	Block,
	BlockTask,
	FailOptions,
	Log,
	Spinner,
	Ui,
} from "../../src/ui.js";

export interface TestSpinner extends Spinner {
	start: Mock<Spinner["start"]>;
	stop: Mock<Spinner["stop"]>;
}

export interface TestTask extends BlockTask {
	settle: Mock<BlockTask["settle"]>;
	clear: Mock<BlockTask["clear"]>;
}

/** A generic prompt keeps its signature, which a `Mock` alone would erase. */
type Prompt<
	F extends
		| Ui["select"]
		| Ui["multiselect"]
		| Block["select"]
		| Block["multiselect"],
> = F & Mock<F>;

/**
 * A block's own question is answered as the Ui's prompt of its kind is
 * scripted, so a test scripts every question alike.
 */
export interface TestBlock extends Block {
	row: Mock<Block["row"]>;
	task: Mock<(progress: Progress) => TestTask>;
	select: Prompt<Block["select"]>;
	multiselect: Prompt<Block["multiselect"]>;
	confirm: Mock<Block["confirm"]>;
	/** Every task `task()` started, in the order it started them. */
	readonly tasks: TestTask[];
}

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
	header: Mock<Ui["header"]>;
	block: Mock<(subjects: readonly BlockSubject[]) => TestBlock>;
	next: Mock<Ui["next"]>;
	close: Mock<Ui["close"]>;
	cancel: Mock<Ui["cancel"]>;
	warn: Mock<Ui["warn"]>;
	note: Mock<Ui["note"]>;
	select: Prompt<Ui["select"]>;
	multiselect: Prompt<Ui["multiselect"]>;
	confirm: Mock<Ui["confirm"]>;
	report: Mock<Ui["report"]>;
	fail: Mock<Ui["fail"]>;
	readonly log: { [K in keyof Log]: Mock<Log[K]> };
	intro: Mock<Ui["intro"]>;
	outro: Mock<Ui["outro"]>;
	spinner: Mock<() => TestSpinner>;
	box: Mock<Ui["box"]>;
	/** Every block `block()` opened, in the order it opened them. */
	readonly blocks: TestBlock[];
	/** Every row the blocks drew, a settled task's included, in the order they were drawn. */
	rows(): Row[];
	/** Every handle `spinner()` returned, in the order it returned them. */
	readonly spinners: TestSpinner[];
	/** The messages drawn on a channel, in call order across every call that draws there; a rich one as machine mode flattens it. */
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

/** What a call that draws one message was given, and when. */
interface Drawn {
	mock: {
		calls: readonly (readonly [Message, ...unknown[]])[];
		invocationCallOrder: readonly number[];
	};
}

function lines(fn: Drawn): Line[] {
	return fn.mock.calls.map(([message], i) => [
		fn.mock.invocationCallOrder[i]!,
		plainText(message),
	]);
}

function failLines(fn: TestUi["fail"], style: FailOptions["style"]): Line[] {
	return fn.mock.calls.flatMap(([message, options], i): Line[] =>
		(options?.style ?? "cancel") === style
			? [[fn.mock.invocationCallOrder[i]!, plainText(message)]]
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

function drawnRows(blocks: readonly TestBlock[]): Row[] {
	const drawn = blocks.flatMap(({ row, tasks }) =>
		[row, ...tasks.map(({ settle }) => settle)].flatMap((fn) =>
			fn.mock.calls.map(([drawnRow], i): [number, Row] => [
				fn.mock.invocationCallOrder[i]!,
				drawnRow,
			]),
		),
	);
	return drawn.sort(([a], [b]) => a - b).map(([, drawnRow]) => drawnRow);
}

function testBlock(ui: Ui): TestBlock {
	const tasks: TestTask[] = [];
	return {
		row: vi.fn(),
		task: vi.fn(() => {
			const task = { settle: vi.fn(), clear: vi.fn() };
			tasks.push(task);
			return task;
		}),
		select: vi.fn((_row, prompt) => ui.select(prompt)) as Prompt<
			Block["select"]
		>,
		multiselect: vi.fn((_row, prompt) => ui.multiselect(prompt)) as Prompt<
			Block["multiselect"]
		>,
		confirm: vi.fn((_row, prompt) => ui.confirm(prompt)),
		tasks,
	};
}

export function testUi(): TestUi {
	const blocks: TestBlock[] = [];
	const spinners: TestSpinner[] = [];
	const ui: TestUi = {
		mode: "interactive",
		header: vi.fn(),
		block: vi.fn(() => {
			const block = testBlock(ui);
			blocks.push(block);
			return block;
		}),
		next: vi.fn(),
		close: vi.fn(),
		cancel: vi.fn(),
		warn: vi.fn(),
		note: vi.fn(),
		select: unscripted("select") as Prompt<Ui["select"]>,
		multiselect: unscripted("multiselect") as Prompt<Ui["multiselect"]>,
		confirm: unscripted("confirm"),
		report: vi.fn(),
		fail: vi.fn((): never => {
			throw new ExitSignal(1);
		}),
		log: {
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
			success: vi.fn(),
			message: vi.fn(),
		},
		intro: vi.fn(),
		outro: vi.fn(),
		spinner: vi.fn(() => {
			const handle = { start: vi.fn(), stop: vi.fn() };
			spinners.push(handle);
			return handle;
		}),
		box: vi.fn(),
		blocks,
		rows: () => drawnRows(blocks),
		spinners,
		said: (channel) => channelLines(ui, channel).map(([, message]) => message),
		saidOrders: (channel) => channelLines(ui, channel).map(([order]) => order),
	};
	return ui;
}

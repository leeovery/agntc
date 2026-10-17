import { type Mock, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import { type Message, plainText } from "../../src/message.js";
import type { BlockSubject, Progress, Row } from "../../src/terminal/types.js";
import type { Block, BlockTask, Ui } from "../../src/ui.js";

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

/** The `Ui` call that drew a message. */
export type Channel = "note" | "warn" | "fail";

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
	/** Every block `block()` opened, in the order it opened them. */
	readonly blocks: TestBlock[];
	/** Every row the blocks drew, a settled task's included, in the order they were drawn. */
	rows(): Row[];
	/** The messages drawn on a channel, in call order; a rich one as machine mode flattens it. */
	said(channel: Channel): string[];
}

function unscripted(name: string) {
	return vi.fn(async (prompt: { message: string }): Promise<never> => {
		throw new Error(`unscripted ${name}: "${prompt.message}"`);
	});
}

/** What a call that draws one message was given. */
interface Drawn {
	mock: { calls: readonly (readonly [Message, ...unknown[]])[] };
}

function said(fn: Drawn): string[] {
	return fn.mock.calls.map(([message]) => plainText(message));
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
		blocks,
		rows: () => drawnRows(blocks),
		said: (channel) => said(ui[channel]),
	};
	return ui;
}

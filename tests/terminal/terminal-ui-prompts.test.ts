import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	type Mock,
	vi,
} from "vitest";

vi.mock("../../src/terminal/prompts/select.js", () => ({
	promptSelect: vi.fn(),
}));
vi.mock("../../src/terminal/prompts/multiselect.js", () => ({
	promptMultiselect: vi.fn(),
}));
vi.mock("../../src/terminal/prompts/confirm.js", () => ({
	promptConfirm: vi.fn(),
}));

import { promptConfirm } from "../../src/terminal/prompts/confirm.js";
import { promptMultiselect } from "../../src/terminal/prompts/multiselect.js";
import { promptSelect } from "../../src/terminal/prompts/select.js";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import type { Row } from "../../src/terminal/types.js";
import type { Block } from "../../src/ui.js";
import { Terminal } from "./prompts/terminal.js";

const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const CLEAR = "\r\x1b[2K";
const OPTIONS = [
	{ heading: "owner/repo" },
	{ value: "a", label: "alpha", hint: "the first" },
];

function run(columns = 100, env: Record<string, string> = {}) {
	const term = new Terminal(columns, 30);
	const ui = new TerminalUi({
		input: term.input,
		output: term.output,
		env,
		host: term.host,
	});
	return { term, ui };
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("the terminal ui's prompts", () => {
	it("reach the prompts with the terminal's streams, width, style and process", async () => {
		const { term, ui } = run(100, { FORCE_COLOR: "2" });
		vi.mocked(promptSelect).mockResolvedValueOnce("a");
		vi.mocked(promptMultiselect).mockResolvedValueOnce(["a"]);
		vi.mocked(promptConfirm).mockResolvedValueOnce(true);
		const context = {
			input: term.input,
			output: term.output,
			width: 100,
			style: expect.objectContaining({ level: 2 }),
			host: term.host,
		};

		const select = { message: "Pick one", options: OPTIONS, maxItems: 5 };
		expect(await ui.select(select)).toBe("a");
		expect(promptSelect).toHaveBeenCalledWith(
			{ ...select, above: expect.any(Function) },
			context,
		);

		const multiselect = {
			message: "Pick any",
			options: [{ value: "a", label: "alpha" }],
			required: false,
		};
		expect(await ui.multiselect(multiselect)).toEqual(["a"]);
		expect(promptMultiselect).toHaveBeenCalledWith(
			{ ...multiselect, above: expect.any(Function) },
			context,
		);

		const confirm = { message: "Proceed?", initialValue: false };
		expect(await ui.confirm(confirm)).toBe(true);
		expect(promptConfirm).toHaveBeenCalledWith(
			{ ...confirm, above: expect.any(Function) },
			context,
		);
	});

	it("give the prompt the terminal's width as it is when it opens, at most 100", async () => {
		const { term, ui } = run(120);
		vi.mocked(promptConfirm).mockResolvedValue(true);

		await ui.confirm({ message: "Proceed?" });
		term.output.columns = 72;
		await ui.confirm({ message: "Proceed?" });

		expect(
			vi.mocked(promptConfirm).mock.calls.map(([, { width }]) => width),
		).toEqual([100, 72]);
	});

	it.each([
		{
			kind: "select",
			prompt: {
				message: "Pick one",
				options: [{ value: "a", label: "alpha" }],
			},
			answer: "a",
			asked: vi.mocked(promptSelect),
			ask: (block: Block, row: Row, prompt: never) => block.select(row, prompt),
		},
		{
			kind: "multiselect",
			prompt: {
				message: "Pick any",
				options: [{ value: "a", label: "alpha" }],
			},
			answer: ["a"],
			asked: vi.mocked(promptMultiselect),
			ask: (block: Block, row: Row, prompt: never) =>
				block.multiselect(row, prompt),
		},
		{
			kind: "confirm",
			prompt: { message: "Proceed?" },
			answer: false,
			asked: vi.mocked(promptConfirm),
			ask: (block: Block, row: Row, prompt: never) =>
				block.confirm(row, prompt),
		},
	])("ask a block's $kind under its row, laid out in the block's columns, its children cut whole to the room with the gap under it", async ({
		prompt,
		answer,
		asked,
		ask,
	}) => {
		const { term, ui } = run();
		ui.note("before");
		(asked as Mock).mockResolvedValueOnce(answer);
		const block = ui.block([
			{ subject: "owner/repo", children: [{ name: "a-long-skill-name" }] },
		]);
		const row: Row = {
			status: "done",
			subject: "owner/repo",
			detail: "2 skills",
			children: [{ name: "a" }, { name: "b" }],
		};

		expect(await ask(block, row, prompt as never)).toEqual(answer);

		expect(asked).toHaveBeenCalledWith(
			{ ...prompt, above: expect.any(Function) },
			expect.objectContaining({ width: 100 }),
		);
		const [[{ above }]] = (asked as Mock).mock.calls as [
			[{ above: (room: number) => string[] }],
		];
		const head = ` ✓ owner/repo${" ".repeat(13)}2 skills`;
		expect(above(5)).toEqual(["", head, "   ├─ a", "   └─ b", ""]);
		expect(above(4)).toEqual(["", head, "   └─ … 2 more", ""]);
		expect(above(3)).toEqual(["", head, ""]);
		expect(above(2)).toEqual([""]);
		expect(term.output.text).toBe(" · before\n");
	});

	it("ask a block's question under several rows, fitted together to the room, the gap under them", async () => {
		const { ui } = run();
		vi.mocked(promptConfirm).mockResolvedValueOnce(true);
		const rows: Row[] = [
			{
				status: "subject",
				subject: "owner/repo/a",
				children: [{ name: "x" }, { name: "y" }],
			},
			{ status: "subject", subject: "owner/repo/b", children: [{ name: "z" }] },
		];
		const block = ui.block(rows);

		await block.confirm(
			{ rows, noun: { one: "entry", many: "entries" } },
			{ message: "Remove them?" },
		);

		const [[{ above }]] = vi.mocked(promptConfirm).mock.calls as unknown as [
			[{ above: (room: number) => string[] }],
		];
		const a = ` ● owner/repo/a${" ".repeat(3)}`.trimEnd();
		const b = " ● owner/repo/b";
		expect(above(7)).toEqual([a, "   ├─ x", "   └─ y", b, "   └─ z", ""]);
		expect(above(5)).toEqual([a, "   └─ … 2 more", b, "   └─ z", ""]);
		expect(above(4)).toEqual([a, "   └─ … 2 more", " … 1 more entry", ""]);
		expect(above(3)).toEqual([a, " … 1 more entry", ""]);
		expect(above(2)).toEqual([a, ""]);
		expect(above(1)).toEqual([]);
	});

	it("ask a new block's question while another block's task spins: the spinner clears, what's said meanwhile waits for the answer, and the task spins on to settle", async () => {
		const { term, ui } = run();
		const group = ui.block([{ subject: "owner/repo" }]);
		const task = group.task({ subject: "owner/repo", text: "updating…" });
		ui.note("held while it spins");
		let seen = "";
		let whileAsking = "";
		vi.mocked(promptConfirm).mockImplementationOnce(async () => {
			seen = term.output.text;
			ui.note("said while it asks");
			whileAsking = term.output.text;
			return false;
		});
		const asked: Row = { status: "attention", subject: "owner/repo/gone" };

		expect(
			await ui.block([asked]).confirm(asked, { message: "Remove it?" }),
		).toBe(false);

		expect(seen.endsWith(`${CLEAR}${SHOW} · held while it spins\n`)).toBe(true);
		expect(whileAsking).toBe(seen);
		const after = term.output.text.slice(seen.length);
		expect(after.startsWith(" · said while it asks\n")).toBe(true);
		expect(after).toContain(`${HIDE}${CLEAR}`);
		expect(after).toContain("updating…");
		task.settle({ status: "attention", subject: "owner/repo", detail: "kept" });
		expect(await term.lines()).toEqual([
			" · held while it spins",
			" · said while it asks",
			" ! owner/repo   kept",
		]);
	});

	it.each([
		{
			why: "nothing is above it yet",
			before: () => {},
		},
		{
			why: "the block has drawn",
			before: (ui: TerminalUi, block: Block) => {
				ui.note("before");
				block.row({ status: "done", subject: "owner/drawn" });
			},
		},
	])("ask a block's question with no blank line of its own when $why", async ({
		before,
	}) => {
		const { ui } = run();
		vi.mocked(promptConfirm).mockResolvedValueOnce(true);
		const block = ui.block([{ subject: "owner/repo" }]);
		before(ui, block);

		await block.confirm(
			{ status: "subject", subject: "owner/repo" },
			{ message: "Proceed?" },
		);

		const [[{ above }]] = vi.mocked(promptConfirm).mock.calls as unknown as [
			[{ above: (room: number) => string[] }],
		];
		expect(above(5)).toEqual([" ● owner/repo", ""]);
	});

	it.each([
		[
			"select",
			(ui: TerminalUi) => ui.select({ message: "Pick", options: OPTIONS }),
			promptSelect,
		],
		[
			"multiselect",
			(ui: TerminalUi) => ui.multiselect({ message: "Pick", options: [] }),
			promptMultiselect,
		],
		[
			"confirm",
			(ui: TerminalUi) => ui.confirm({ message: "Proceed?" }),
			promptConfirm,
		],
	] as const)("ask a %s after other lines a blank line under them, in its frame, so it goes with it", async (_name, ask, prompt) => {
		const { term, ui } = run();
		vi.mocked(prompt as Mock).mockResolvedValueOnce(true);
		ui.note("before");

		await ask(ui);

		const [[{ above }]] = (prompt as Mock).mock.calls as [
			[{ above: (room: number) => string[] }],
		];
		expect(above(5)).toEqual([""]);
		expect(term.output.text).toBe(" · before\n");
	});

	it("ask a question with nothing above it, or under a blank line, with no blank line of its own", async () => {
		const term = new Terminal(100, 30);
		const ui = new TerminalUi({
			header: { command: "list", where: "~/project", version: "1.2.3" },
			input: term.input,
			output: term.output,
			env: {},
			host: term.host,
		});
		const opened: string[][] = [];
		vi.mocked(promptConfirm).mockImplementation(async (question) => {
			opened.push([...(question.above?.(5) ?? [])]);
			return true;
		});

		await ui.confirm({ message: "First?" });
		ui.header();
		await ui.confirm({ message: "Under the header?" });
		ui.note("then a line");
		await ui.confirm({ message: "Under a line?" });

		expect(opened).toEqual([[], [], [""]]);
	});

	it("leave nothing of a block that only asked: its row is drawn a blank line under what's above", async () => {
		const { term, ui } = run();
		ui.note("before");
		vi.mocked(promptConfirm).mockResolvedValueOnce(true);
		const block = ui.block([{ subject: "owner/repo" }]);

		await block.confirm(
			{ status: "subject", subject: "owner/repo" },
			{ message: "Proceed?" },
		);
		expect(term.output.text).toBe(" · before\n");

		block.row({ status: "done", subject: "owner/repo" });
		expect(term.output.text).toBe(" · before\n\n ✓ owner/repo\n");
	});

	it("open with nothing spinning, and the spinner back once answered", async () => {
		const { term, ui } = run();
		ui.spinner().start("Copying skill files...");
		ui.note("held while it spins");
		let seen = "";
		vi.mocked(promptConfirm).mockImplementationOnce(async () => {
			seen = term.output.text;
			return false;
		});

		expect(await ui.confirm({ message: "Proceed?" })).toBe(false);

		expect(seen.endsWith(`${CLEAR}${SHOW} · held while it spins\n`)).toBe(true);
		const after = term.output.text.slice(seen.length);
		expect(after.startsWith(`${HIDE}${CLEAR}`)).toBe(true);
		expect(after).toContain("Copying skill files...");
	});

	it("leave nothing spinning when the prompt throws, and spin again", async () => {
		const { term, ui } = run();
		const spin = ui.spinner();
		spin.start("Copying skill files...");
		vi.mocked(promptSelect).mockRejectedValueOnce(new Error("stdin closed"));

		await expect(
			ui.select({ message: "Pick", options: OPTIONS }),
		).rejects.toThrow("stdin closed");
		spin.stop("Copied successfully");

		expect(await term.lines()).toEqual([" ✓ Copied successfully"]);
	});
});

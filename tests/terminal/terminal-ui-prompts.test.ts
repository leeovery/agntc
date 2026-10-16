import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
		expect(promptSelect).toHaveBeenCalledWith(select, context);

		const multiselect = {
			message: "Pick any",
			options: [{ value: "a", label: "alpha" }],
			required: false,
		};
		expect(await ui.multiselect(multiselect)).toEqual(["a"]);
		expect(promptMultiselect).toHaveBeenCalledWith(multiselect, context);

		const confirm = { message: "Proceed?", initialValue: false };
		expect(await ui.confirm(confirm)).toBe(true);
		expect(promptConfirm).toHaveBeenCalledWith(confirm, context);
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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { RichMessage } from "../../src/message.js";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import type { Header, NextItem } from "../../src/terminal/types.js";
import { KEY, Terminal } from "./prompts/terminal.js";

const ACCENT = "\x1b[38;2;167;139;250m";
const FG = "\x1b[39m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const NORMAL = "\x1b[22m";
const HIDE = "\x1b[?25l";
const SHOW = "\x1b[?25h";
const CLEAR = "\r\x1b[2K";
const COLOR = { FORCE_COLOR: "3" };

const gap = (columns: number) => " ".repeat(columns);
/** `left`, then `right` ending at the right margin. */
const atRight = (left: string, right: string, width = 80) =>
	`${left}${gap(width - 1 - left.length - right.length)}${right}`;
const RULE = ` ${"─".repeat(78)}`;

const HEADER: Header = {
	command: "update",
	where: "~/Code/project",
	version: "1.2.3",
};
const HEADER_LINE = atRight(" ■ agntc update", "~/Code/project · v1.2.3");

const REMOVE = "npx agntc remove o/r/laravel";
const READD = "npx agntc add o/r --skill laravel";
const ABORT: NextItem = {
	subject: "laravel",
	remedy: {
		lead: "To update it anyway:",
		steps: [{ command: REMOVE }, { command: READD }],
	},
};
const NEXT_LINES = [
	"",
	" Next",
	"   laravel — to update it anyway:",
	`     ${REMOVE}`,
	`     ${READD}`,
];
const RICH: RichMessage = {
	text: "laravel can't be updated.",
	cause: "it would remove macos-hig",
	remedy: ABORT.remedy,
	plain: "unused at a terminal",
};

interface Options {
	env?: Record<string, string>;
	clock?: () => number;
}

function run({ env = {}, clock }: Options = {}) {
	const term = new Terminal(80, 40);
	const ui = new TerminalUi({
		header: HEADER,
		input: term.input,
		output: term.output,
		env,
		host: term.host,
		clock,
	});
	return { term, ui };
}

function failure(fail: () => never): unknown {
	try {
		fail();
	} catch (error) {
		return error;
	}
	throw new Error("expected a failure");
}

describe("the header", () => {
	it("opens the run, a blank line under it", () => {
		const { term, ui } = run();
		ui.header();
		expect(term.output.text).toBe(`${HEADER_LINE}\n\n`);
	});

	it("is drawn once, however often it or intro is called", () => {
		const { term, ui } = run();
		ui.intro("agntc update");
		ui.header();
		ui.intro("agntc update");
		expect(term.output.text).toBe(`${HEADER_LINE}\n\n`);
	});

	it("is left out of a run that has none", () => {
		const term = new Terminal();
		const ui = new TerminalUi({ output: term.output, env: {} });
		ui.header();
		ui.intro("agntc add");
		expect(term.output.text).toBe("");
	});

	it("paints the mark in the accent, agntc bold and the right side dim", () => {
		const { term, ui } = run({ env: COLOR });
		ui.header();
		expect(term.output.text).toBe(
			` ${ACCENT}■${FG} ${BOLD}agntc${NORMAL} update${gap(41)}${DIM}~/Code/project · v1.2.3${NORMAL}\n\n`,
		);
	});
});

describe("a block", () => {
	it("lines its rows up by every subject it opened with, as they stream in", async () => {
		const { term, ui } = run();
		const block = ui.block([
			{ subject: "leeovery/agentic-skills", meta: "^0.2.4" },
			{ subject: "github/gh-stack", meta: "^0.2.1" },
		]);
		block.row({
			status: "unchanged",
			subject: "github/gh-stack",
			meta: "^0.2.1",
			detail: "up to date",
		});
		block.row({
			status: "done",
			subject: "leeovery/agentic-skills",
			meta: "^0.2.4",
			detail: { move: { from: "v0.2.4", to: "v0.2.5" } },
			children: [{ name: "laravel", detail: "pack · 14 skills" }],
		});
		expect(await term.lines()).toEqual([
			` ○ github/gh-stack${gap(11)}^0.2.1${gap(3)}up to date`,
			` ✓ leeovery/agentic-skills${gap(3)}^0.2.4${gap(3)}v0.2.4 → v0.2.5`,
			`   └─ laravel${gap(25)}pack · 14 skills`,
		]);
	});

	it("sits under the header's blank line, and a blank line under anything else", async () => {
		const { term, ui } = run();
		ui.header();
		ui.block([{ subject: "owner/alpha" }]).row({
			status: "done",
			subject: "owner/alpha",
		});
		ui.log.info("checked");
		ui.block([{ subject: "owner/beta" }]).row({
			status: "done",
			subject: "owner/beta",
		});
		expect(await term.lines()).toEqual([
			HEADER_LINE,
			"",
			" ✓ owner/alpha",
			" · checked",
			"",
			" ✓ owner/beta",
		]);
	});
});

describe("a task", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const SUBJECTS = [{ subject: "owner/alpha", meta: "^1.0.0" }];
	const PROGRESS = {
		subject: "owner/alpha",
		meta: "^1.0.0",
		text: "updating to v1.0.1…",
	};
	const SETTLED = {
		status: "done" as const,
		subject: "owner/alpha",
		meta: "^1.0.0",
		detail: { move: { from: "v1.0.0", to: "v1.0.1" } },
	};
	const spinning = (frame: string) =>
		` ${frame} owner/alpha${gap(3)}^1.0.0${gap(3)}updating to v1.0.1…`;
	const SETTLED_LINE = ` ✓ owner/alpha${gap(3)}^1.0.0${gap(3)}v1.0.0 → v1.0.1`;

	it("spins in its row's glyph slot, saying what it's doing, then settles into its row", async () => {
		const { term, ui } = run();
		const task = ui.block(SUBJECTS).task(PROGRESS);
		expect(await term.lines()).toEqual([spinning("⠁")]);
		vi.advanceTimersByTime(80);
		expect(await term.lines()).toEqual([spinning("⠂")]);
		task.settle(SETTLED);
		expect(await term.lines()).toEqual([SETTLED_LINE]);
	});

	it("spins on one line with a long subject's tail, then settles into the row with its subject whole", async () => {
		const { term, ui } = run();
		const subject =
			"/Volumes/Scratch/sources/a-rather-long-local-source-folder-name/with-another-level";
		const task = ui
			.block([{ subject, meta: "local" }])
			.task({ subject, meta: "local", text: "copying…" });
		expect(await term.lines()).toEqual([
			` ⠁ …${subject.slice(-58)}  local  copying…`,
		]);
		task.settle({
			status: "done",
			subject,
			meta: "local",
			detail: "installed",
		});
		expect(await term.lines()).toEqual([
			" ✓ /Volumes/Scratch/sources/a-rather-long-local-source-folder-name/",
			`   with-another-level${gap(18)}local   installed`,
		]);
	});

	it("hides the cursor while it spins, the frame in the accent and its words dim", () => {
		const { term, ui } = run({ env: COLOR });
		const task = ui.block(SUBJECTS).task(PROGRESS);
		expect(term.output.text).toBe(
			`${HIDE}${CLEAR} ${ACCENT}⠁${FG} ${BOLD}owner/alpha${NORMAL}${gap(3)}${DIM}^1.0.0${NORMAL}${gap(3)}${DIM}updating to v1.0.1…${NORMAL}`,
		);
		task.clear();
		expect(term.output.text.endsWith(SHOW)).toBe(true);
	});

	it("prints what's said while it runs under the row it settles into", async () => {
		const { term, ui } = run();
		const task = ui.block(SUBJECTS).task(PROGRESS);
		ui.note("a note");
		ui.warn("careful");
		expect(await term.lines()).toEqual([spinning("⠁")]);
		task.settle(SETTLED);
		expect(await term.lines()).toEqual([
			SETTLED_LINE,
			" · a note",
			" ! careful",
		]);
	});

	it("prints nothing for a note or warning whose words are machine mode's alone", async () => {
		const { term, ui } = run();
		const task = ui.block(SUBJECTS).task(PROGRESS);
		ui.note({ text: "", plain: "owner/repo/a is now keyed owner/repo/b" });
		ui.warn({ text: "", plain: "for the document" });
		ui.note("a note");
		task.settle(SETTLED);
		expect(await term.lines()).toEqual([SETTLED_LINE, " · a note"]);
	});

	it("clears without a row, what was said meanwhile kept", async () => {
		const { term, ui } = run();
		const task = ui.block(SUBJECTS).task(PROGRESS);
		ui.note("a note");
		task.clear();
		expect(await term.lines()).toEqual([" · a note"]);
	});

	it("pauses the task it starts under, which spins again once it ends", async () => {
		const { term, ui } = run();
		const outer = ui.block(SUBJECTS).task(PROGRESS);
		const clone = ui.spinner();
		clone.start("Cloning repository...");
		expect(await term.lines()).toEqual([" ⠁ Cloning repository..."]);
		clone.stop("Cloned successfully");
		expect(await term.lines()).toEqual([
			" ✓ Cloned successfully",
			spinning("⠁"),
		]);
		outer.settle(SETTLED);
		expect(await term.lines()).toEqual([
			" ✓ Cloned successfully",
			SETTLED_LINE,
		]);
	});

	it("pauses for a prompt, which draws alone, and spins again once it's answered", async () => {
		const { term, ui } = run();
		const task = ui.block(SUBJECTS).task(PROGRESS);
		ui.warn("files in the way");
		const answer = ui.confirm({ message: "Overwrite them?" });
		await term.press();
		expect(await term.lines()).toEqual([
			" ! files in the way",
			"",
			" ? Overwrite them?   [Yes]  No",
		]);
		await term.press("y");
		expect(await answer).toBe(true);
		expect(await term.lines()).toEqual([" ! files in the way", spinning("⠁")]);
		task.settle(SETTLED);
		expect(await term.lines()).toEqual([" ! files in the way", SETTLED_LINE]);
	});

	describe("with another task", () => {
		const TWO = [{ subject: "owner/alpha" }, { subject: "owner/beta" }];
		const done = (subject: string) => ({ status: "done" as const, subject });

		it("prints rows in the order their tasks settle, an older one's above the line spinning", async () => {
			const { term, ui } = run();
			const block = ui.block(TWO);
			const alpha = block.task({ subject: "owner/alpha", text: "updating…" });
			ui.note("said under alpha");
			const beta = block.task({ subject: "owner/beta", text: "updating…" });
			alpha.settle(done("owner/alpha"));
			expect(await term.lines()).toEqual([
				" ✓ owner/alpha",
				" · said under alpha",
				` ⠁ owner/beta${gap(4)}updating…`,
			]);
			beta.settle(done("owner/beta"));
			expect(await term.lines()).toEqual([
				" ✓ owner/alpha",
				" · said under alpha",
				" ✓ owner/beta",
			]);
		});

		it("prints what every task held above a prompt, the newest's last", async () => {
			const { term, ui } = run();
			const block = ui.block(TWO);
			const alpha = block.task({ subject: "owner/alpha", text: "updating…" });
			ui.note("said under alpha");
			const beta = block.task({ subject: "owner/beta", text: "updating…" });
			ui.note("said under beta");
			const answer = ui.confirm({ message: "Go on?" });
			await term.press();
			expect(await term.lines()).toEqual([
				" · said under alpha",
				" · said under beta",
				"",
				" ? Go on?   [Yes]  No",
			]);
			await term.press("n");
			expect(await answer).toBe(false);
			beta.clear();
			alpha.clear();
		});

		it("keeps a row that settles while a prompt asks for after its answer, spinning nothing", async () => {
			const { term, ui } = run();
			const task = ui.block(SUBJECTS).task(PROGRESS);
			const answer = ui.confirm({ message: "Go on?" });
			await term.press();
			task.settle(SETTLED);
			expect(await term.lines()).toEqual([" ? Go on?   [Yes]  No"]);
			await term.press("y");
			await answer;
			vi.advanceTimersByTime(160);
			expect(await term.lines()).toEqual([SETTLED_LINE]);
			expect(term.output.text.endsWith(`${SETTLED_LINE}\n`)).toBe(true);
		});

		it("spins a task started while a prompt asks only once it's answered", async () => {
			const { term, ui } = run();
			const block = ui.block(SUBJECTS);
			const answer = ui.confirm({ message: "Go on?" });
			await term.press();
			const task = block.task(PROGRESS);
			expect(await term.lines()).toEqual([" ? Go on?   [Yes]  No"]);
			await term.press("y");
			await answer;
			expect(await term.lines()).toEqual([spinning("⠁")]);
			task.clear();
		});

		it("spins the task under one that settles during a prompt once it's answered", async () => {
			const { term, ui } = run();
			const block = ui.block(TWO);
			const alpha = block.task({ subject: "owner/alpha", text: "updating…" });
			const beta = block.task({ subject: "owner/beta", text: "updating…" });
			const answer = ui.confirm({ message: "Go on?" });
			await term.press();
			beta.settle(done("owner/beta"));
			await term.press("y");
			await answer;
			expect(await term.lines()).toEqual([
				" ✓ owner/beta",
				` ⠁ owner/alpha${gap(3)}updating…`,
			]);
			alpha.clear();
		});
	});

	describe("and the blank line a block opens with", () => {
		it("comes under what a task holds, a block opened while it spins", async () => {
			const { term, ui } = run();
			ui.header();
			const task = ui.block(SUBJECTS).task(PROGRESS);
			ui.note("a note");
			ui.block([{ subject: "owner/beta" }]).row({
				status: "done",
				subject: "owner/beta",
			});
			task.settle(SETTLED);
			expect(await term.lines()).toEqual([
				HEADER_LINE,
				"",
				SETTLED_LINE,
				" · a note",
				"",
				" ✓ owner/beta",
			]);
		});

		it("is left out under a blank line a task holds", async () => {
			const { term, ui } = run();
			const task = ui.block(SUBJECTS).task(PROGRESS);
			ui.header();
			ui.block([{ subject: "owner/beta" }]).row({
				status: "done",
				subject: "owner/beta",
			});
			task.settle(SETTLED);
			expect(await term.lines()).toEqual([
				SETTLED_LINE,
				HEADER_LINE,
				"",
				" ✓ owner/beta",
			]);
		});

		it("comes under the row a task will settle into, though it holds nothing", async () => {
			const { term, ui } = run();
			ui.header();
			const task = ui.block(SUBJECTS).task(PROGRESS);
			ui.block([{ subject: "owner/beta" }]).row({
				status: "done",
				subject: "owner/beta",
			});
			task.settle(SETTLED);
			expect(await term.lines()).toEqual([
				HEADER_LINE,
				"",
				SETTLED_LINE,
				"",
				" ✓ owner/beta",
			]);
		});

		it("comes under a row a task settled into", async () => {
			const { term, ui } = run();
			ui.header();
			ui.block(SUBJECTS).task(PROGRESS).settle(SETTLED);
			ui.block([{ subject: "owner/beta" }]).row({
				status: "done",
				subject: "owner/beta",
			});
			expect(await term.lines()).toEqual([
				HEADER_LINE,
				"",
				SETTLED_LINE,
				"",
				" ✓ owner/beta",
			]);
		});
	});

	it("leaves a dim ○ Cancelled where it spun on a signal, and exits 130", () => {
		const { term, ui } = run({ env: COLOR });
		ui.block(SUBJECTS).task(PROGRESS);
		term.host.emit("SIGINT");
		expect(
			term.output.text.endsWith(`${CLEAR} ${DIM}○ Cancelled${NORMAL}\n${SHOW}`),
		).toBe(true);
		expect(term.host.exit).toHaveBeenCalledWith(130);
		ui.end();
	});
});

describe("close", () => {
	const ROW = " ✓ owner/alpha";
	const row = (ui: TerminalUi) =>
		ui.block([{ subject: "owner/alpha" }]).row({
			status: "done",
			subject: "owner/alpha",
		});

	it("ends on the row when the run had one outcome and nothing queued", () => {
		const { term, ui } = run();
		ui.close({ command: "add", counts: { installed: 1 } });
		ui.close({ command: "list", counts: {} });
		expect(term.output.text).toBe("");
	});

	it("draws the rule, then the tally and the time since the run began, for more than one outcome", async () => {
		let now = 1000;
		const { term, ui } = run({ clock: () => now });
		row(ui);
		now = 3400;
		ui.close({
			command: "update",
			counts: { updated: 3, upToDate: 2, notChecked: 1, notUpdated: 1 },
		});
		expect(await term.lines()).toEqual([
			ROW,
			"",
			RULE,
			atRight(
				" 3 updated  ·  2 up to date  ·  1 not checked  ·  1 not updated",
				"2.4s",
			),
		]);
	});

	it("closes on two outcomes with nothing queued", async () => {
		const { term, ui } = run({ clock: () => 0 });
		row(ui);
		ui.close({ command: "remove", counts: { removed: 1, failed: 1 } });
		expect(await term.lines()).toEqual([
			ROW,
			"",
			RULE,
			atRight(" 1 removed  ·  1 failed", "0.1s"),
		]);
	});

	it("gives Next, the rule and the tally for one outcome with something queued", async () => {
		let now = 0;
		const { term, ui } = run({ clock: () => now });
		row(ui);
		ui.next(ABORT);
		now = 72_000;
		ui.close({ command: "update", counts: { notUpdated: 1 } });
		expect(await term.lines()).toEqual([
			ROW,
			...NEXT_LINES,
			"",
			RULE,
			atRight(" 1 not updated", "1m 12s"),
		]);
	});

	it("gives Next alone, with no rule or tally, for no outcome with something queued", async () => {
		const { term, ui } = run({ clock: () => 0 });
		row(ui);
		ui.next(ABORT);
		ui.close({ command: "add", counts: {} });
		expect(await term.lines()).toEqual([ROW, ...NEXT_LINES]);
	});

	it("opens with no second blank line under the header's", async () => {
		const { term, ui } = run({ clock: () => 0 });
		ui.header();
		ui.close({ command: "add", counts: { installed: 2 } });
		expect(await term.lines()).toEqual([
			HEADER_LINE,
			"",
			RULE,
			atRight(" 2 installed", "0.1s"),
		]);
	});

	it("empties the queue, so nothing after it prints the Next items again", async () => {
		const { term, ui } = run({ clock: () => 0 });
		row(ui);
		ui.next(ABORT);
		ui.close({ command: "update", counts: { notUpdated: 1 } });
		const closed = await term.lines();
		ui.close({ command: "update", counts: { notUpdated: 2 } });
		ui.end();
		expect((await term.lines()).filter((line) => line === " Next")).toEqual([
			" Next",
		]);
		expect(closed).toContain(" Next");
	});

	it("counts in its command's order, each in its glyph's colour", () => {
		const { term, ui } = run({ env: COLOR, clock: () => 0 });
		ui.close({ command: "update", counts: { kept: 1, updated: 2 } });
		expect(term.output.text).toContain(
			`\x1b[32m2 updated${FG}${DIM}  ·  ${NORMAL}\x1b[33m1 kept${FG}`,
		);
	});
});

describe("end", () => {
	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("prints the Next items a run ended without closing on", async () => {
		const { term, ui } = run();
		ui.log.error("laravel can't be updated");
		ui.next(ABORT);
		ui.end();
		expect(await term.lines()).toEqual([
			" ✗ laravel can't be updated",
			...NEXT_LINES,
		]);
	});

	it("clears what spins, prints what it held, then the Next items", async () => {
		const { term, ui } = run();
		ui.next(ABORT);
		ui.spinner().start("Cloning repository...");
		ui.note("held");
		ui.end();
		expect(await term.lines()).toEqual([" · held", ...NEXT_LINES]);
		expect(term.output.text).toContain(`${CLEAR}${SHOW}`);
	});
});

describe("cancel", () => {
	it("prints ○ and the caller's words, dim", () => {
		const { term, ui } = run({ env: COLOR });
		ui.cancel("Cancelled");
		expect(term.output.text).toBe(` ${DIM}○ Cancelled${NORMAL}\n`);
	});

	it("opens with a blank line under a row, so it doesn't read as one of its children", async () => {
		const { term, ui } = run();
		ui.block([{ subject: "owner/repo" }]).row({
			status: "unchanged",
			subject: "owner/repo",
			children: [{ name: "a" }],
		});
		ui.cancel("Cancelled");
		expect(await term.lines()).toEqual([
			" ○ owner/repo",
			"   └─ a",
			"",
			" ○ Cancelled",
		]);
	});
});

describe("warn and note", () => {
	it("print a warning with ! and a note with ·", async () => {
		const { term, ui } = run();
		ui.warn("careful");
		ui.note("for what it's worth");
		expect(await term.lines()).toEqual([
			" ! careful",
			" · for what it's worth",
		]);
	});

	it("keep a string's lines as written, wrapping none, so a command in a sentence stays whole", () => {
		const { term, ui } = run();
		const long = `To install them as a pack: npx agntc add leeovery/agentic-skills/examples --pack, then restart`;
		ui.warn(`examples has agents/\n  - agents/a.md\n${long}`);
		expect(term.output.text).toBe(
			` ! examples has agents/\n     - agents/a.md\n   ${long}\n`,
		);
	});

	it("lay out a rich message: its cause, then its remedy's commands on lines of their own", async () => {
		const { term, ui } = run();
		ui.warn(RICH);
		expect(await term.lines()).toEqual([
			" ! laravel can't be updated.",
			"   it would remove macos-hig",
			"   To update it anyway:",
			`     ${REMOVE}`,
			`     ${READD}`,
		]);
	});
});

describe("fail", () => {
	it("prints the error and ends the command with exit code 1", async () => {
		const { term, ui } = run();
		const error = failure(() => ui.fail("couldn't clone o/r"));
		expect(error).toBeInstanceOf(ExitSignal);
		expect((error as ExitSignal).code).toBe(1);
		expect(await term.lines()).toEqual([" ✗ couldn't clone o/r"]);
	});

	it("prints a cancel-style failure as an error too", async () => {
		const { term, ui } = run();
		failure(() => ui.fail("--skill and --all can't be combined"));
		failure(() => ui.fail("not installed", { style: "error" }));
		expect(await term.lines()).toEqual([
			" ✗ --skill and --all can't be combined",
			"",
			" ✗ not installed",
		]);
	});

	it("puts the message in bold", () => {
		const { term, ui } = run({ env: COLOR });
		failure(() => ui.fail("broken"));
		expect(term.output.text).toBe(` \x1b[31m✗${FG} ${BOLD}broken${NORMAL}\n`);
	});

	it("prints after the Next items queued so far, and empties the queue", async () => {
		const { term, ui } = run();
		ui.log.error("laravel can't be updated");
		ui.next(ABORT);
		failure(() => ui.fail("broken"));
		ui.end();
		expect(await term.lines()).toEqual([
			" ✗ laravel can't be updated",
			...NEXT_LINES,
			"",
			" ✗ broken",
		]);
	});

	it("opens its Next items with no second blank line under the header's", async () => {
		const { term, ui } = run();
		ui.header();
		ui.next(ABORT);
		failure(() => ui.fail("broken"));
		expect(await term.lines()).toEqual([
			HEADER_LINE,
			...NEXT_LINES,
			"",
			" ✗ broken",
		]);
	});

	it("puts a string's first line in bold and the rest, its cause, dim", () => {
		const { term, ui } = run({ env: COLOR });
		failure(() => ui.fail("couldn't clone o/r\nfatal: repository not found\n"));
		expect(term.output.text).toBe(
			` \x1b[31m✗${FG} ${BOLD}couldn't clone o/r${NORMAL}\n   ${DIM}fatal: repository not found${NORMAL}\n`,
		);
	});

	it("lays out a rich failure, its cause dim under it", async () => {
		const { term, ui } = run();
		failure(() => ui.fail({ ...RICH, remedy: undefined }));
		expect(await term.lines()).toEqual([
			" ✗ laravel can't be updated.",
			"   it would remove macos-hig",
		]);
	});

	it("opens with a blank line under a row, so it doesn't read as one of its children", async () => {
		const { term, ui } = run();
		const block = ui.block([{ subject: "owner/repo" }]);
		block.row({
			status: "failed",
			subject: "owner/repo",
			children: [{ name: "a" }],
		});
		failure(() => ui.fail("broken"));
		expect(await term.lines()).toEqual([
			" ✗ owner/repo",
			"   └─ a",
			"",
			" ✗ broken",
		]);
	});

	it("clears what spins first, and prints what it held", async () => {
		const { term, ui } = run();
		ui.spinner().start("Cloning repository...");
		ui.note("held");
		failure(() => ui.fail("broken"));
		expect(await term.lines()).toEqual([" · held", "", " ✗ broken"]);
		expect(term.output.text).toContain(`${CLEAR}${SHOW}`);
	});
});

describe("the old surface", () => {
	it.each([
		["info", " · a line"],
		["warn", " ! a line"],
		["error", " ✗ a line"],
		["success", " ✓ a line"],
		["message", " a line"],
	] as const)("draws log.%s as a plain row", async (channel, line) => {
		const { term, ui } = run();
		ui.log[channel]("a line");
		expect(await term.lines()).toEqual([line]);
	});

	it("keeps a log's lines and their indentation as written", async () => {
		const { term, ui } = run();
		ui.log.success("Installed alpha\nInstalled beta");
		ui.log.info("Pinned to v1.0.0. Newer tags available:");
		ui.log.message("  v1.2.0");
		expect(await term.lines()).toEqual([
			" ✓ Installed alpha",
			"   Installed beta",
			" · Pinned to v1.0.0. Newer tags available:",
			"   v1.2.0",
		]);
	});

	it("paints each log's glyph in its colour, the words as they are", () => {
		const { term, ui } = run({ env: COLOR });
		ui.log.info("i");
		ui.log.warn("w");
		ui.log.error("e");
		ui.log.success("s");
		expect(term.output.text).toBe(
			[
				` ${DIM}·${NORMAL} i`,
				` \x1b[33m!${FG} w`,
				` \x1b[31m✗${FG} e`,
				` \x1b[32m✓${FG} s`,
				"",
			].join("\n"),
		);
	});

	it("closes with outro's words under a blank line", async () => {
		const { term, ui } = run();
		ui.log.success("Installed alpha");
		ui.outro("Everything is up to date.");
		expect(await term.lines()).toEqual([
			" ✓ Installed alpha",
			"",
			" Everything is up to date.",
		]);
	});

	it("draws box as its title in bold with the message under it", () => {
		const { term, ui } = run({ env: COLOR });
		ui.box("  - .claude/skills/a/\n  - .claude/skills/b/", 'Files for "o/r"');
		expect(term.output.text).toBe(
			` ${BOLD}Files for "o/r"${NORMAL}\n   - .claude/skills/a/\n   - .claude/skills/b/\n`,
		);
	});

	describe("spinner", () => {
		beforeEach(() => {
			vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it("spins its message dim, the frame in the accent", () => {
			const { term, ui } = run({ env: COLOR });
			ui.spinner().start("Cloning repository...");
			expect(term.output.text).toBe(
				`${HIDE}${CLEAR} ${ACCENT}⠁${FG} ${DIM}Cloning repository...${NORMAL}`,
			);
		});

		it.each([
			[0, " ✓ Cloned successfully"],
			[2, " ✗ Cloned successfully"],
		])("leaves its stop message as a row, at code %i", async (code, line) => {
			const { term, ui } = run();
			const spin = ui.spinner();
			spin.start("Cloning repository...");
			vi.advanceTimersByTime(160);
			spin.stop("Cloned successfully", code);
			expect(await term.lines()).toEqual([line]);
			expect(term.output.text.endsWith(`\n${SHOW}`)).toBe(true);
		});

		it("clears and leaves nothing when stopped without a message", async () => {
			const { term, ui } = run();
			const spin = ui.spinner();
			spin.start("Checking for updates...");
			spin.stop();
			expect(await term.lines()).toEqual([]);
		});

		it("leaves a row when stopped without being started", async () => {
			const { term, ui } = run();
			ui.spinner().stop("Update checks complete.");
			expect(await term.lines()).toEqual([" ✓ Update checks complete."]);
		});

		it("leaves one row however often it's stopped, until it starts again", async () => {
			const { term, ui } = run();
			const spin = ui.spinner();
			spin.start("Cloning repository...");
			spin.stop("Cloned successfully");
			spin.stop("Cloned successfully");
			spin.start("Copying skill files...");
			spin.stop("Copied successfully");
			expect(await term.lines()).toEqual([
				" ✓ Cloned successfully",
				" ✓ Copied successfully",
			]);
		});

		it("says what a second start says, spinning on the one line", async () => {
			const { term, ui } = run();
			const spin = ui.spinner();
			spin.start("Cloning repository...");
			spin.start("Fetching tags...");
			vi.advanceTimersByTime(80);
			expect(await term.lines()).toEqual([" ⠂ Fetching tags..."]);
			spin.stop("Fetched tags");
			ui.note("nothing spins now");
			expect(await term.lines()).toEqual([
				" ✓ Fetched tags",
				" · nothing spins now",
			]);
		});
	});
});

describe("blank lines", () => {
	it("leave out outro's own under the header's", async () => {
		const { term, ui } = run();
		ui.header();
		ui.outro("No skills or packs installed.");
		expect(await term.lines()).toEqual([
			HEADER_LINE,
			"",
			" No skills or packs installed.",
		]);
	});

	it("never end a cancel or a written message", () => {
		const { term, ui } = run();
		ui.cancel("Clone failed: fatal: repository not found\n");
		ui.warn("Some files were left behind\n\n");
		expect(term.output.text).toBe(
			" ○ Clone failed: fatal: repository not found\n ! Some files were left behind\n",
		);
	});
});

describe("prompts", () => {
	it("ask on the terminal and answer with what was chosen", async () => {
		const { term, ui } = run();
		const answer = ui.select({
			message: "Pick one",
			options: [
				{ heading: "owner/repo" },
				{ value: "a", label: "alpha" },
				{ value: "b", label: "beta" },
			],
		});
		await term.press(KEY.down, KEY.enter);
		expect(await answer).toBe("b");
		expect(await term.lines()).toEqual([]);
	});
});

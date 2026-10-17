import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));

vi.mock("node:os", async (importOriginal) => {
	const os = await importOriginal<typeof import("node:os")>();
	return { ...os, homedir: () => home.dir };
});

import { runInit } from "../../src/commands/init.js";
import { ExitSignal } from "../../src/exit-signal.js";
import type { InitType } from "../../src/init/type-select.js";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import { KEY, Terminal } from "./prompts/terminal.js";

// Whole init runs drawn by the real terminal Ui into a headless xterm, 100
// columns, colour off, compared line for line, so the look can't drift.

/** `left`, then `right` ending at the right margin. */
const atRight = (left: string, right: string) =>
	`${left}${" ".repeat(99 - left.length - right.length)}${right}`;
const HEADER = atRight(" ■ agntc init", "~/my-pack · v1.2.3");
const RULE = ` ${"─".repeat(98)}`;
const close = (tally: string) => ["", RULE, atRight(` ${tally}`, "2.4s")];

let folder: string;

beforeEach(async () => {
	home.dir = await realpath(await mkdtemp(join(tmpdir(), "agntc-init-")));
	folder = join(home.dir, "my-pack");
	await mkdir(folder, { recursive: true });
	vi.spyOn(process, "cwd").mockReturnValue(folder);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(home.dir, { recursive: true, force: true });
});

interface Run {
	type?: InitType;
	yes?: boolean;
	/** Keys pressed once the run asks its question. */
	answer?: string[];
	/** Keys pressed once the run asks a second question, as its words show. */
	later?: { asked: string; answer: string[] };
	rows?: number;
}

/** The terminal while the run asks each question, and once it has ended. */
async function session({ type, yes, answer, later, rows = 60 }: Run): Promise<{
	asking: string[];
	askingLater: string[];
	ended: string[];
}> {
	const term = new Terminal(100, rows);
	let asking: string[] = [];
	let askingLater: string[] = [];
	let now = 0;
	const ui = new TerminalUi({
		header: { command: "init", where: "~/my-pack", version: "1.2.3" },
		input: term.input,
		output: term.output,
		env: {},
		host: term.host,
		clock: () => {
			const at = now;
			now = 2400;
			return at;
		},
	});
	ui.header();
	const running = runInit(type, { yes }, ui);
	// Settled below, once the questions are answered; a cancel may end it first.
	running.catch(() => {});
	if (answer !== undefined) {
		await vi.waitFor(() => {
			expect(term.output.text).toContain(" ? ");
		});
		asking = await term.lines();
		await term.press(...answer);
	}
	if (later !== undefined) {
		await vi.waitFor(() => {
			expect(term.output.text).toContain(later.asked);
		});
		askingLater = await term.lines();
		await term.press(...later.answer);
	}
	try {
		await running;
	} catch (err) {
		if (!(err instanceof ExitSignal)) {
			throw err;
		}
	} finally {
		ui.end();
	}
	return { asking, askingLater, ended: await term.lines() };
}

const PACK_ROW = [
	" ● ~/my-pack           pack · will create 4 files",
	"   ├─ agntc.json",
	"   ├─ skills/",
	"   │  └─ my-skill/",
	"   │     └─ SKILL.md",
	"   ├─ agents/",
	"   │  └─ my-agent.md",
	"   └─ hooks/",
	"      └─ my-hook.sh",
];

describe("an init of a pack", () => {
	it("asks under the tree of the files it will create, then draws a row per file and closes on the tally", async () => {
		const { asking, ended } = await session({ type: "pack", answer: ["y"] });

		expect(asking).toEqual([
			HEADER,
			"",
			...PACK_ROW,
			"",
			" ? Proceed?   [Yes]  No",
		]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ✓ agntc.json                 created",
			" ✓ skills/my-skill/SKILL.md   created",
			" ✓ agents/my-agent.md         created",
			" ✓ hooks/my-hook.sh           created",
			" · Done. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
			...close("4 created"),
		]);
	});

	it.each([
		[
			10,
			[
				" ● ~/my-pack           pack · will create 4 files",
				"   ├─ agntc.json",
				"   ├─ skills/",
				"   │  └─ my-skill/",
				"   │     └─ SKILL.md",
				"   └─ … 2 more files",
			],
		],
		[
			6,
			[
				" ● ~/my-pack           pack · will create 4 files",
				"   ├─ agntc.json",
				"   └─ … 3 more files",
			],
		],
		[
			5,
			[
				" ● ~/my-pack           pack · will create 4 files",
				"   └─ … 4 more files",
			],
		],
	])("cuts the tree to a screen of %i rows, counting the files left out, not the folders, and no folder whose files are all cut", async (rows, fitted) => {
		const { asking } = await session({ type: "pack", answer: ["n"], rows });

		expect(asking).toEqual([
			HEADER,
			"",
			...fitted,
			"",
			" ? Proceed?   [Yes]  No",
		]);
	});

	it("leaves the files there already as they are, dim, and warns of what keeps the folder from being a pack", async () => {
		await writeFile(join(folder, "agntc.json"), "{}");
		await writeFile(join(folder, "SKILL.md"), "mine");

		expect((await session({ type: "pack", yes: true })).ended).toEqual([
			HEADER,
			"",
			" ○ agntc.json                 already there",
			" ✓ skills/my-skill/SKILL.md   created",
			" ✓ agents/my-agent.md         created",
			" ✓ hooks/my-hook.sh           created",
			' ! agntc.json was already here and doesn\'t declare a pack — add "type": "pack" to it',
			" ! SKILL.md here makes this folder a skill, not a pack — move it under skills/",
			" · Done. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
			...close("3 created  ·  1 already there"),
		]);
	});

	it("asks counting only the files it will create, those already there marked so in the tree", async () => {
		await writeFile(join(folder, "agntc.json"), "{}");

		const { asking } = await session({ type: "pack", answer: ["n"] });
		expect(asking).toEqual([
			HEADER,
			"",
			" ● ~/my-pack           pack · will create 3 files",
			"   ├─ agntc.json       already there",
			"   ├─ skills/",
			"   │  └─ my-skill/",
			"   │     └─ SKILL.md",
			"   ├─ agents/",
			"   │  └─ my-agent.md",
			"   └─ hooks/",
			"      └─ my-hook.sh",
			"",
			" ? Proceed?   [Yes]  No",
		]);
	});

	it("leaves nothing but the cancel when the question is answered no", async () => {
		expect((await session({ type: "pack", answer: ["n"] })).ended).toEqual([
			HEADER,
			"",
			" ○ Cancelled",
		]);
	});
});

describe("an init of a skill", () => {
	it("asks which type when none is given, then under the file it will create, ending on its row", async () => {
		const { asking, askingLater, ended } = await session({
			answer: [KEY.enter],
			later: { asked: "Proceed", answer: ["y"] },
		});

		expect(asking).toEqual([
			HEADER,
			"",
			atRight(" ? What are you creating?", "↑↓ move   ⏎ choose   esc cancel"),
			" ▌ Skill   a single skill (SKILL.md)",
			"   Pack    skills, agents and hooks that install together as one",
		]);
		expect(askingLater).toEqual([
			HEADER,
			"",
			" ● ~/my-pack     skill · will create 1 file",
			"   └─ SKILL.md",
			"",
			" ? Proceed?   [Yes]  No",
		]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ✓ SKILL.md   created",
			" · Done. Edit `SKILL.md` to define your skill.",
		]);
	});

	it("ends on the row saying its SKILL.md is already there, saying nothing more", async () => {
		await writeFile(join(folder, "SKILL.md"), "mine");

		expect((await session({ type: "skill", yes: true })).ended).toEqual([
			HEADER,
			"",
			" ○ SKILL.md   already there",
		]);
	});

	it("asks nothing when its SKILL.md is already there, ending on that row", async () => {
		await writeFile(join(folder, "SKILL.md"), "mine");

		const { ended } = await session({ type: "skill" });
		expect(ended).toEqual([HEADER, "", " ○ SKILL.md   already there"]);
	});

	it("leaves nothing but the cancel when the type isn't chosen", async () => {
		expect((await session({ answer: [KEY.escape] })).ended).toEqual([
			HEADER,
			"",
			" ○ Cancelled",
		]);
	});
});

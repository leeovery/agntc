import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initCommand, runInit } from "../../src/commands/init.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { plainText } from "../../src/message.js";
import type { Row } from "../../src/terminal/types.js";
import { runMachine } from "../helpers/machine.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const PACK_FILES = [
	"agntc.json",
	"skills/my-skill/SKILL.md",
	"agents/my-agent.md",
	"hooks/my-hook.sh",
];
const NOT_A_PACK =
	'agntc.json was already here and doesn\'t declare a pack — add "type": "pack" to it';

let dir: string;
let ui: TestUi;

beforeEach(async () => {
	vi.clearAllMocks();
	ui = testUi();
	dir = await mkdtemp(join(tmpdir(), "agntc-init-"));
	vi.spyOn(process, "cwd").mockReturnValue(dir);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(dir, { recursive: true, force: true });
});

async function written(): Promise<string[]> {
	const entries = await readdir(dir, { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name).slice(dir.length + 1))
		.sort();
}

function created(path: string): Row {
	return { status: "done", subject: path, detail: { label: "created" } };
}

function skipped(path: string): Row {
	return {
		status: "unchanged",
		subject: path,
		detail: { label: "skipped", aside: "already exists" },
	};
}

/** What the terminal is told beside the rows, as machine mode would word it. */
function told(): { warnings: string[]; notes: string[] } {
	return {
		warnings: ui.warn.mock.calls.map(([message]) => plainText(message)),
		notes: ui.note.mock.calls.map(([message]) => plainText(message)),
	};
}

async function expectCleanCancel(run: Promise<void>): Promise<void> {
	const error = await run.catch((e: unknown) => e);

	expect(error).toBeInstanceOf(ExitSignal);
	expect((error as ExitSignal).code).toBe(0);
	expect(ui.cancel).toHaveBeenCalledWith("Cancelled");
	expect(await written()).toEqual([]);
}

describe("runInit at a terminal", () => {
	it("opens with its header", async () => {
		ui.confirm.mockResolvedValue(true);

		await runInit("skill", {}, ui);

		expect(ui.header).toHaveBeenCalledOnce();
	});

	it("scaffolds a skill named by the type argument without showing the menu", async () => {
		ui.confirm.mockResolvedValue(true);

		await runInit("skill", {}, ui);

		expect(ui.select).not.toHaveBeenCalled();
		expect(await written()).toEqual(["SKILL.md"]);
		expect(ui.rows()).toEqual([created("SKILL.md")]);
		expect(told()).toEqual({
			warnings: [],
			notes: ["Done. Edit `SKILL.md` to define your skill."],
		});
		expect(ui.close).toHaveBeenCalledExactlyOnceWith({
			command: "init",
			counts: { created: 1, skipped: 0 },
		});
	});

	it("scaffolds a pack named by the type argument without showing the menu", async () => {
		ui.confirm.mockResolvedValue(true);

		await runInit("pack", {}, ui);

		expect(ui.select).not.toHaveBeenCalled();
		expect(await written()).toEqual([...PACK_FILES].sort());
		expect(ui.block).toHaveBeenLastCalledWith(PACK_FILES.map(created));
		expect(ui.rows()).toEqual(PACK_FILES.map(created));
		expect(told().notes).toEqual([
			"Done. Add skills under `skills/`, agents to `agents/` and hooks to `hooks/`.",
		]);
		expect(ui.close).toHaveBeenCalledExactlyOnceWith({
			command: "init",
			counts: { created: 4, skipped: 0 },
		});
	});

	it.each([
		["skill", ["SKILL.md"]],
		["pack", [...PACK_FILES].sort()],
	])("asks for the type when none is given, then scaffolds a %s", async (type, files) => {
		ui.select.mockResolvedValue(type);
		ui.confirm.mockResolvedValue(true);

		await runInit(undefined, {}, ui);

		expect(ui.select).toHaveBeenCalledOnce();
		expect(await written()).toEqual(files);
	});

	it("asks to proceed under the row of what it will create", async () => {
		ui.confirm.mockResolvedValue(true);

		await runInit("pack", {}, ui);

		const row = {
			status: "subject",
			subject: dir,
			detail: "pack · will create 4 files",
			children: [
				{ name: "agntc.json", depth: 0 },
				{ name: "skills/", depth: 0 },
				{ name: "my-skill/", depth: 1 },
				{ name: "SKILL.md", depth: 2 },
				{ name: "agents/", depth: 0 },
				{ name: "my-agent.md", depth: 1 },
				{ name: "hooks/", depth: 0 },
				{ name: "my-hook.sh", depth: 1 },
			],
		};
		expect(ui.block).toHaveBeenNthCalledWith(1, [row]);
		expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(row, {
			message: "Proceed?",
		});
		expect(ui.blocks[0]!.row).not.toHaveBeenCalled();
	});

	it("exits cleanly, writing nothing, when the menu is cancelled", async () => {
		ui.select.mockResolvedValue(null);

		await expectCleanCancel(runInit(undefined, {}, ui));
		expect(ui.confirm).not.toHaveBeenCalled();
	});

	it.each([
		"skill",
		"pack",
	] as const)("exits cleanly, writing nothing, when the %s confirmation is declined", async (type) => {
		ui.confirm.mockResolvedValue(false);

		await expectCleanCancel(runInit(type, {}, ui));
	});

	it.each([
		"skill",
		"pack",
	] as const)("skips the preview and its confirmation for a %s with -y", async (type) => {
		await runInit(type, { yes: true }, ui);

		expect(ui.confirm).not.toHaveBeenCalled();
		expect(ui.blocks.map((block) => block.confirm.mock.calls)).toEqual([[]]);
		expect((await written()).length).toBeGreaterThan(0);
	});

	it("leaves an existing SKILL.md as it is and says so", async () => {
		await writeFile(join(dir, "SKILL.md"), "# Mine\n");

		await runInit("skill", { yes: true }, ui);

		expect(await readFile(join(dir, "SKILL.md"), "utf-8")).toBe("# Mine\n");
		expect(ui.rows()).toEqual([skipped("SKILL.md")]);
		expect(told()).toEqual({ warnings: [], notes: [] });
		expect(ui.close).toHaveBeenCalledExactlyOnceWith({
			command: "init",
			counts: { created: 0, skipped: 1 },
		});
	});

	it("writes the rest of a pack around files already there, listing those as existing", async () => {
		await writeFile(join(dir, "agntc.json"), '{"type": "pack"}');

		await runInit("pack", { yes: true }, ui);

		expect(await readFile(join(dir, "agntc.json"), "utf-8")).toBe(
			'{"type": "pack"}',
		);
		expect(ui.rows()).toEqual([
			skipped("agntc.json"),
			...PACK_FILES.slice(1).map(created),
		]);
		expect(ui.said("warn")).toEqual([]);
		expect(ui.close).toHaveBeenCalledExactlyOnceWith({
			command: "init",
			counts: { created: 3, skipped: 1 },
		});
	});

	it("warns when an agntc.json already there keeps the folder from being a pack", async () => {
		await writeFile(join(dir, "agntc.json"), "{}");

		await runInit("pack", { yes: true }, ui);

		expect(await readFile(join(dir, "agntc.json"), "utf-8")).toBe("{}");
		expect(ui.warn).toHaveBeenCalledWith({
			text: NOT_A_PACK,
			plain: NOT_A_PACK,
		});
		expect(ui.warn.mock.invocationCallOrder[0]!).toBeGreaterThan(
			ui.blocks[0]!.row.mock.invocationCallOrder.at(-1)!,
		);
	});
});

describe("init without a terminal", () => {
	it("refuses without a type, naming the type argument's values, before anything else", async () => {
		const run = await runMachine(initCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document).toEqual({
			ok: false,
			command: "init",
			error: {
				message:
					"init needs to know what to scaffold without a terminal: npx agntc init skill or npx agntc init pack",
				flags: ["skill", "pack"],
			},
			warnings: [],
			notes: [],
		});
		expect(await written()).toEqual([]);
		expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
	});

	it("refuses for the type even when -y is given", async () => {
		const run = await runMachine(initCommand, ["-y"]);

		expect(run.exitCode).toBe(1);
		expect(run.document.error).toMatchObject({ flags: ["skill", "pack"] });
	});

	it.each([
		"skill",
		"pack",
	])("refuses a %s without -y, writing nothing", async (type) => {
		const run = await runMachine(initCommand, [type]);

		expect(run.exitCode).toBe(1);
		expect(run.document).toEqual({
			ok: false,
			command: "init",
			error: {
				message: `scaffolding a ${type} asks before writing anything — confirm with -y`,
				flags: ["-y"],
			},
			warnings: [],
			notes: [],
		});
		expect(await written()).toEqual([]);
		expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
	});

	it("scaffolds a skill with -y and reports the files created", async () => {
		const run = await runMachine(initCommand, ["skill", "-y"]);

		expect(run.exitCode).toBe(0);
		expect(run.document).toEqual({
			ok: true,
			command: "init",
			type: "skill",
			files: ["SKILL.md"],
			skipped: [],
			warnings: [],
			notes: [],
		});
		expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
	});

	it("scaffolds a pack with --yes and reports the files created", async () => {
		const run = await runMachine(initCommand, ["pack", "--yes"]);

		expect(run.exitCode).toBe(0);
		expect(run.document).toEqual({
			ok: true,
			command: "init",
			type: "pack",
			files: PACK_FILES,
			skipped: [],
			warnings: [],
			notes: [],
		});
		expect(await written()).toEqual([...PACK_FILES].sort());
	});

	it("reports files already there as skipped, without asking, and warns when they keep it from being a pack", async () => {
		await writeFile(join(dir, "agntc.json"), "{}");

		const run = await runMachine(initCommand, ["pack", "-y"]);

		expect(run.exitCode).toBe(0);
		expect(run.document).toMatchObject({
			ok: true,
			files: PACK_FILES.slice(1),
			skipped: ["agntc.json"],
			warnings: [NOT_A_PACK],
		});
		expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
	});
});

describe("init's wording", () => {
	it("never says plugin or collection in its help", () => {
		expect(initCommand.helpInformation()).not.toMatch(/plugin|collection/i);
	});

	it("offers skill and pack as the type argument's values", () => {
		const help = initCommand.helpInformation();

		expect(help).toContain('choices: "skill", "pack"');
	});
});

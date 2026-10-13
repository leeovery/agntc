import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdd } from "../../src/commands/add.js";
import { runUpdate } from "../../src/commands/update.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { readManifest } from "../../src/manifest.js";
import { type CommandName, MachineUi } from "../../src/ui.js";

let testDir: string;
let projectDir: string;
/** A local source that is one pack. */
let source: string;

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "agntc-duplicate-targets-"));
	projectDir = join(testDir, "project");
	source = join(testDir, "laravel");
	await mkdir(projectDir, { recursive: true });
	await write(source, {
		"agntc.json": JSON.stringify({ type: "pack" }),
		"skills/lint/SKILL.md": "v1",
	});
	vi.spyOn(process, "cwd").mockReturnValue(projectDir);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

async function write(base: string, files: Record<string, string>) {
	for (const [path, content] of Object.entries(files)) {
		const full = join(base, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content);
	}
}

async function run(
	command: CommandName,
	action: (ui: MachineUi) => Promise<void>,
) {
	const ui = new MachineUi(command, "project");
	let exitCode = 0;
	try {
		await action(ui);
	} catch (err) {
		if (!(err instanceof ExitSignal)) {
			throw err;
		}
		exitCode = err.code;
	}
	return { exitCode, document: ui.document(exitCode) };
}

describe("duplicate install targets on add", () => {
	it("refuses before copying anything, listing each clash with its paths", async () => {
		const repo = join(testDir, "repo");
		await write(repo, {
			"skills/a/foo/SKILL.md": "",
			"tools/foo/SKILL.md": "",
			"p/agntc.json": JSON.stringify({ type: "pack" }),
			"p/skills/bar/SKILL.md": "",
			"p/agents/lead.md": "",
			"q/agntc.json": JSON.stringify({ type: "pack" }),
			"q/bar/SKILL.md": "",
			"q/agents/lead.md": "",
		});

		const { exitCode, document } = await run("add", (ui) =>
			runAdd(repo, { all: true }, ui),
		);

		expect(exitCode).toBe(1);
		expect(document.error?.message.split("\n")).toEqual([
			`${repo}: p/skills/bar and q/bar would both install to .claude/skills/bar — choose one`,
			"p/agents/lead.md and q/agents/lead.md would both install to .claude/agents/lead.md — choose one",
			"skills/a/foo and tools/foo would both install to .claude/skills/foo — choose one",
		]);
		expect(await readManifest(projectDir)).toEqual({});
		await expect(
			readFile(join(projectDir, ".claude/skills/bar/SKILL.md")),
		).rejects.toThrow();
	});
});

describe("duplicate install targets on update", () => {
	it("aborts a pack whose re-walk finds two skills with one folder name, leaving it installed", async () => {
		await run("add", (ui) => runAdd(source, {}, ui));
		await write(source, {
			"skills/lint/SKILL.md": "v2",
			"tools/lint/SKILL.md": "v2",
		});

		const { exitCode, document } = await run("update", (ui) =>
			runUpdate(undefined, {}, ui),
		);

		expect(exitCode).toBe(1);
		expect(document.items).toEqual([
			expect.objectContaining({
				key: source,
				status: "aborted",
				message: expect.stringContaining(
					"skills/lint and tools/lint would both install to .claude/skills/lint",
				),
			}),
		]);
		expect(
			await readFile(join(projectDir, ".claude/skills/lint/SKILL.md"), "utf-8"),
		).toBe("v1");
		expect((await readManifest(projectDir))[source]).toMatchObject({
			type: "pack",
			files: [".claude/skills/lint/"],
		});
	});
});

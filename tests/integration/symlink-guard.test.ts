import {
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runAdd } from "../../src/commands/add.js";
import { runRemove } from "../../src/commands/remove.js";
import { runUpdate } from "../../src/commands/update.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { type CommandName, MachineUi } from "../../src/ui.js";

let testDir: string;
let projectDir: string;
/** A local source holding one skill, `foo`. */
let source: string;
/** Someone's own folder, which `.claude/skills/foo` gets linked to. */
let mine: string;

const SKILL = ".claude/skills/foo";

beforeEach(async () => {
	testDir = await mkdtemp(join(tmpdir(), "agntc-symlink-guard-"));
	projectDir = join(testDir, "project");
	source = join(testDir, "source");
	mine = join(testDir, "mine");
	await write(source, { "foo/SKILL.md": "from source" });
	await write(mine, { "SKILL.md": "mine", "references/guide.md": "mine" });
	await mkdir(join(projectDir, ".claude/skills"), { recursive: true });
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

async function linkSkillToMine(): Promise<void> {
	await rm(join(projectDir, SKILL), { recursive: true, force: true });
	await symlink(mine, join(projectDir, SKILL));
}

async function expectMineUntouched(): Promise<void> {
	expect((await readdir(mine)).sort()).toEqual(["SKILL.md", "references"]);
	expect(await readdir(join(mine, "references"))).toEqual(["guide.md"]);
	expect(await readFile(join(mine, "SKILL.md"), "utf-8")).toBe("mine");
	expect(await readFile(join(mine, "references/guide.md"), "utf-8")).toBe(
		"mine",
	);
}

async function isLink(relPath: string): Promise<boolean> {
	const stats = await lstat(join(projectDir, relPath)).catch(() => null);
	return stats?.isSymbolicLink() ?? false;
}

/** Runs a command without a terminal; resolves to its document and exit code. */
async function run(
	command: CommandName,
	action: (ui: MachineUi) => Promise<void>,
) {
	const ui = new MachineUi(command);
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

describe("a symlink in the destination", () => {
	it("remove unlinks a recorded skill folder that is now a link, leaving its target", async () => {
		await run("add", (ui) => runAdd(source, {}, ui));
		await linkSkillToMine();

		const { exitCode } = await run("remove", (ui) =>
			runRemove(join(source, "foo"), { yes: true }, ui),
		);

		expect(exitCode).toBe(0);
		expect(await lstat(join(projectDir, SKILL)).catch(() => null)).toBeNull();
		await expectMineUntouched();
	});

	it("update's reinstall replaces the link with a real folder, leaving its target", async () => {
		await run("add", (ui) => runAdd(source, {}, ui));
		await linkSkillToMine();

		const { exitCode } = await run("update", (ui) => runUpdate(undefined, ui));

		expect(exitCode).toBe(0);
		expect(await isLink(SKILL)).toBe(false);
		expect(await readFile(join(projectDir, SKILL, "SKILL.md"), "utf-8")).toBe(
			"from source",
		);
		await expectMineUntouched();
	});

	it("add counts an unmanaged link at the target as in the way", async () => {
		await linkSkillToMine();

		const { exitCode, document } = await run("add", (ui) =>
			runAdd(source, {}, ui),
		);

		expect(exitCode).toBe(1);
		expect(document.items).toEqual([
			expect.objectContaining({
				status: "skipped",
				reason: `files in the way weren't installed by agntc: ${SKILL}/`,
				flags: ["--overwrite"],
			}),
		]);
		expect(await isLink(SKILL)).toBe(true);
		await expectMineUntouched();
	});

	it("add counts a dangling link at the target as in the way", async () => {
		await symlink(join(testDir, "gone"), join(projectDir, SKILL));

		const { exitCode, document } = await run("add", (ui) =>
			runAdd(source, {}, ui),
		);

		expect(exitCode).toBe(1);
		expect(document.items).toEqual([
			expect.objectContaining({ status: "skipped", flags: ["--overwrite"] }),
		]);
	});

	it("add --overwrite replaces an unmanaged link at the target, leaving its target", async () => {
		await linkSkillToMine();

		const { exitCode, document } = await run("add", (ui) =>
			runAdd(source, { overwrite: true }, ui),
		);

		expect(exitCode).toBe(0);
		expect(document.items).toEqual([
			expect.objectContaining({ status: "installed" }),
		]);
		expect(await isLink(SKILL)).toBe(false);
		expect(await readFile(join(projectDir, SKILL, "SKILL.md"), "utf-8")).toBe(
			"from source",
		);
		await expectMineUntouched();
	});

	it("add --overwrite replaces an unmanaged folder rather than merging into it", async () => {
		await write(join(projectDir, SKILL), { "stale.md": "old" });

		const { exitCode } = await run("add", (ui) =>
			runAdd(source, { overwrite: true }, ui),
		);

		expect(exitCode).toBe(0);
		expect(await readdir(join(projectDir, SKILL))).toEqual(["SKILL.md"]);
	});

	it("add over its own install, now a link, replaces the link and leaves its target", async () => {
		await run("add", (ui) => runAdd(source, {}, ui));
		await linkSkillToMine();

		const { exitCode } = await run("add", (ui) => runAdd(source, {}, ui));

		expect(exitCode).toBe(0);
		expect(await isLink(SKILL)).toBe(false);
		expect(await readFile(join(projectDir, SKILL, "SKILL.md"), "utf-8")).toBe(
			"from source",
		);
		await expectMineUntouched();
	});
});

import { existsSync, mkdirSync, readdirSync, symlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	commit,
	GATES,
	gateCalls,
	git,
	npmFolders,
	recorded,
	repoPath,
	run,
	scratchPath,
	start,
	useGateRepo,
	write,
} from "../helpers/script-repo.js";

useGateRepo();

function headTree(): string {
	return git("rev-parse", "HEAD^{tree}");
}

/** Whether the gate left no checkout behind: none in TMPDIR, none in git's list. */
function leftNothing(): boolean {
	return (
		readdirSync(scratchPath("tmp")).length === 0 &&
		git("worktree", "list", "--porcelain")
			.split("\n")
			.filter((line) => line.startsWith("worktree ")).length === 1
	);
}

async function until(file: string): Promise<void> {
	while (!existsSync(file)) {
		await new Promise((resume) => setTimeout(resume, 20));
	}
}

describe("scripts/gate", () => {
	it("runs every gate in order, in a fresh checkout of HEAD outside the repo, and records its tree", async () => {
		const { status, output } = await run("gate");

		expect(status).toBe(0);
		expect(gateCalls()).toEqual(GATES);
		for (const folder of npmFolders()) {
			expect(folder.startsWith(repoPath())).toBe(false);
			expect(folder).toContain("agntc-gate.");
		}
		expect(recorded()).toEqual([headTree()]);
		expect(output).toContain(
			`gate: checking HEAD ${git("rev-parse", "--short", "HEAD")} in a fresh checkout`,
		);
		expect(output).toContain("changes not committed are no part of it");
	});

	it("records a tree once, however often it passes", async () => {
		await run("gate");
		await run("gate");

		expect(recorded()).toHaveLength(1);
	});

	it("checks HEAD, not an edit to the checkout", async () => {
		write("src/cli.ts", "broken");

		const { status } = await run("gate");

		expect(status).toBe(0);
		expect(recorded()).toEqual([headTree()]);
	});

	it("fails a broken HEAD, however the checkout mends it", async () => {
		commit({ "src/cli.ts": "broken" });
		write("src/cli.ts", "mended");
		git("update-index", "--assume-unchanged", "src/cli.ts");

		const { status } = await run("gate");

		expect(status).not.toBe(0);
		expect(recorded()).toEqual([]);
	});

	it("stops at the first gate that fails, recording nothing", async () => {
		const { status, output } = await run("gate", {
			extra: { NPM_FAIL: "run build" },
		});

		expect(status).not.toBe(0);
		expect(gateCalls()).toEqual(GATES.slice(0, 4));
		expect(recorded()).toEqual([]);
		expect(output).toContain(
			"gate: npm run build failed, so nothing is recorded",
		);
	});

	it("refuses to run under a folder holding node_modules", async () => {
		mkdirSync(scratchPath("node_modules"));

		const { status, output } = await run("gate");

		expect(status).toBe(1);
		expect(output).toContain(
			`gate: ${scratchPath("node_modules")} lies above the checkout`,
		);
		expect(gateCalls()).toEqual([]);
		expect(recorded()).toEqual([]);
		expect(leftNothing()).toBe(true);
	});

	it.each([
		["TMPDIR's real folder", "linked", "real"],
		["the link TMPDIR names", "held/linked", "held"],
	])("refuses when node_modules lies above %s", async (_, link, holder) => {
		mkdirSync(scratchPath("real", "tmp"), { recursive: true });
		mkdirSync(scratchPath(holder, "node_modules"), { recursive: true });
		symlinkSync(scratchPath("real", "tmp"), scratchPath(link));

		const { status } = await run("gate", {
			extra: { TMPDIR: scratchPath(link) },
		});

		expect(status).toBe(1);
		expect(gateCalls()).toEqual([]);
	});

	it.each([
		["passes", {}],
		["fails", { NPM_FAIL: "run typecheck" }],
	])("removes its checkout when it %s", async (_, extra) => {
		await run("gate", { extra });

		expect(gateCalls()).not.toEqual([]);
		expect(leftNothing()).toBe(true);
	});

	it.each([
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const)("removes its checkout when stopped by %s", async (signal, code) => {
		const hung = scratchPath("hung");
		const gate = start("gate", { extra: { NPM_HANG: hung } });
		await until(hung);

		process.kill(-gate.pid, signal);
		const { status } = await gate.done;

		expect(status).toBe(code);
		expect(recorded()).toEqual([]);
		expect(leftNothing()).toBe(true);
	});

	it.each([
		["inside the repo", () => repoPath("src")],
		["outside the repo", () => scratchPath("bin")],
	])("runs from a folder %s", async (_, folder) => {
		const { status } = await run("gate", { cwd: folder() });

		expect(status).toBe(0);
		expect(recorded()).toEqual([headTree()]);
	});

	it("records in the git common directory, which every worktree shares", async () => {
		const worktree = scratchPath("worktree");
		git("worktree", "add", "-q", "--detach", worktree);

		await run("gate", { from: worktree });

		expect(recorded()).toEqual([headTree()]);
	});
});

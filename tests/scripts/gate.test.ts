import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	commit,
	GATES,
	gateCalls,
	git,
	leftNothing,
	npmFolders,
	recorded,
	repoPath,
	run,
	scratchPath,
	useGateRepo,
	write,
} from "../helpers/script-repo.js";

useGateRepo();

function headTree(): string {
	return git("rev-parse", "HEAD^{tree}");
}

describe("scripts/gate", () => {
	it("runs every gate in order, in a fresh checkout of HEAD outside the repo, and records its tree", async () => {
		const { status, output } = await run("gate");

		expect(status).toBe(0);
		expect(gateCalls()).toEqual(GATES);
		for (const folder of npmFolders()) {
			expect(folder.startsWith(repoPath())).toBe(false);
			expect(folder).toMatch(/\/agntc-gate\.\w+\/agntc$/);
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

	it("runs HEAD's steps, not those of an edited copy of itself", async () => {
		commit({ "src/cli.ts": "broken" });
		const edited = readFileSync(repoPath("scripts/gate"), "utf-8").replace(
			/^run npm (run typecheck|run build|test .*)$/gm,
			"",
		);
		writeFileSync(repoPath("scripts/gate"), edited);
		git("update-index", "--assume-unchanged", "scripts/gate");

		const { status } = await run("gate");

		expect(status).not.toBe(0);
		expect(gateCalls()).toEqual(GATES);
		expect(recorded()).toEqual([]);
	});

	it("records the tree it checked, though HEAD moves while it runs", async () => {
		const checked = headTree();

		const { status } = await run("gate", { extra: { NPM_MOVE: repoPath() } });

		expect(status).toBe(0);
		expect(headTree()).not.toBe(checked);
		expect(recorded()).toEqual([checked]);
	});

	it("refuses a node whose major version isn't the one HEAD's .nvmrc names", async () => {
		commit({ ".nvmrc": "99\n" });

		const { status, output } = await run("gate");

		expect(status).toBe(1);
		expect(output).toContain(
			`gate: node ${process.versions.node.split(".")[0]} is on PATH, but HEAD's .nvmrc names node 99, so nothing is run or recorded`,
		);
		expect(gateCalls()).toEqual([]);
		expect(leftNothing()).toBe(true);
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

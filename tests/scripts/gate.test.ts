import { rmSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	commit,
	forgetNpmCalls,
	git,
	npmCalls,
	recorded,
	repoPath,
	run,
	scratchPath,
	script,
	useScriptRepo,
	write,
} from "../helpers/script-repo.js";

const GATES = ["run typecheck", "run build", "test"];

useScriptRepo(() => {
	script("gate");
	commit(
		{
			".gitignore": "node_modules/\n",
			"package.json": "{}",
			"package-lock.json": "{}",
			"src/cli.ts": "one",
		},
		"first",
	);
});

describe("scripts/gate", () => {
	it("installs, runs every gate in order and records the clean tree", () => {
		const { status, output } = run("gate");

		expect(status).toBe(0);
		expect(npmCalls()).toEqual(["ci", ...GATES]);
		expect(recorded()).toEqual([git("rev-parse", "HEAD^{tree}")]);
		expect(output).toContain("recorded");
	});

	it("records a tree once, however often it passes", () => {
		run("gate");
		run("gate");

		expect(recorded()).toHaveLength(1);
	});

	it("skips npm ci when node_modules is as its own npm ci left it", () => {
		run("gate");
		forgetNpmCalls();

		run("gate");

		expect(npmCalls()).toEqual(GATES);
	});

	it.each([
		["package-lock.json changes", () => commit({ "package-lock.json": "[]" })],
		["package.json changes", () => commit({ "package.json": "[]" })],
		[
			"npm has installed into node_modules since",
			() => write("node_modules/.package-lock.json", "other"),
		],
		[
			"node_modules is gone",
			() => rmSync(repoPath("node_modules"), { recursive: true }),
		],
		[
			"node_modules wasn't installed by the gate",
			() => rmSync(repoPath("node_modules", ".agntc-gate")),
		],
	])("runs npm ci again when %s", (_, change) => {
		run("gate");
		forgetNpmCalls();
		change();

		run("gate");

		expect(npmCalls()).toEqual(["ci", ...GATES]);
	});

	it("doesn't trust node_modules after a failed npm ci", () => {
		run("gate", { extra: { NPM_FAIL: "ci" } });
		forgetNpmCalls();

		run("gate");

		expect(npmCalls()).toEqual(["ci", ...GATES]);
	});

	it("runs the gates on a checkout with changes, but records nothing", () => {
		write("src/cli.ts", "dirty");

		const { status, output } = run("gate");

		expect(status).toBe(0);
		expect(npmCalls()).toEqual(["ci", ...GATES]);
		expect(recorded()).toEqual([]);
		expect(output).toContain("the checkout had changes as they began");
	});

	it("records nothing for an untracked file", () => {
		write("src/new.ts", "new");

		run("gate");

		expect(recorded()).toEqual([]);
	});

	it("records nothing when the checkout changes while the gates run", () => {
		const { status, output } = run("gate", {
			extra: { NPM_TOUCH: repoPath("src/new.ts") },
		});

		expect(status).toBe(0);
		expect(recorded()).toEqual([]);
		expect(output).toContain("the checkout changed while they ran");
	});

	it("stops at the first gate that fails, recording nothing", () => {
		const { status, output } = run("gate", {
			extra: { NPM_FAIL: "run build" },
		});

		expect(status).not.toBe(0);
		expect(npmCalls()).toEqual(["ci", "run typecheck", "run build"]);
		expect(recorded()).toEqual([]);
		expect(output).toContain(
			"gate: npm run build failed, so nothing is recorded",
		);
	});

	it("records in the git common directory, which every worktree shares", () => {
		const worktree = scratchPath("worktree");
		git("worktree", "add", "-q", "--detach", worktree);

		run("gate", { cwd: worktree });

		expect(recorded()).toEqual([git("rev-parse", "HEAD^{tree}")]);
	});
});

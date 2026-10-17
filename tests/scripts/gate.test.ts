import { describe, expect, it } from "vitest";
import {
	GATES,
	gateCalls,
	git,
	recorded,
	repoPath,
	run,
	scratchPath,
	useGateRepo,
	write,
} from "../helpers/script-repo.js";

useGateRepo();

describe("scripts/gate", () => {
	it("installs, runs every gate in order and records the clean tree", () => {
		const { status, output } = run("gate");

		expect(status).toBe(0);
		expect(gateCalls()).toEqual(["ci", ...GATES]);
		expect(recorded()).toEqual([git("rev-parse", "HEAD^{tree}")]);
		expect(output).toContain("recorded");
	});

	it("records a tree once, however often it passes", () => {
		run("gate");
		run("gate");

		expect(recorded()).toHaveLength(1);
	});

	it("runs the gates on a checkout with changes, but records nothing", () => {
		write("src/cli.ts", "dirty");

		const { status, output } = run("gate");

		expect(status).toBe(0);
		expect(gateCalls()).toEqual(["ci", ...GATES]);
		expect(recorded()).toEqual([]);
		expect(output).toContain("the checkout had changes as they began");
	});

	it.each([
		["an untracked file", () => write("src/new.ts", "new")],
		[
			"an untracked file git is told not to show",
			() => {
				git("config", "status.showUntrackedFiles", "no");
				write("src/new.ts", "new");
			},
		],
		[
			"an edit to a file marked skip-worktree",
			() => {
				git("update-index", "--skip-worktree", "src/cli.ts");
				write("src/cli.ts", "hidden");
			},
		],
		[
			"an edit to a file marked assume-unchanged",
			() => {
				git("update-index", "--assume-unchanged", "src/cli.ts");
				write("src/cli.ts", "hidden");
			},
		],
		[
			"an edit in a submodule git is told to pass over",
			() => {
				git("init", "-q", "sub");
				write("sub/f", "one");
				git("-C", "sub", "add", "f");
				git("-C", "sub", "commit", "-q", "-m", "sub");
				git("add", "sub");
				git("commit", "-q", "-m", "sub");
				git("config", "diff.ignoreSubmodules", "all");
				write("sub/f", "edited");
			},
		],
		["an ignored file in src/", () => write("src/dist/x.ts", "ignored")],
		["an ignored file in tests/", () => write("tests/dist/x.ts", "ignored")],
	])("records nothing for %s", (_, change) => {
		change();

		const { output } = run("gate");

		expect(recorded()).toEqual([]);
		expect(output).toContain("the checkout had changes as they began");
	});

	it("records past an ignored file outside src/ and tests/, as the build writes dist/", () => {
		write("dist/cli.js", "built");

		run("gate");

		expect(recorded()).toEqual([git("rev-parse", "HEAD^{tree}")]);
	});

	it("records nothing when the checkout changes while the gates run", () => {
		const { status, output } = run("gate", {
			extra: { NPM_TOUCH: repoPath("src/new.ts") },
		});

		expect(status).toBe(0);
		expect(recorded()).toEqual([]);
		expect(output).toContain("the checkout changed while they ran");
	});

	it("records nothing when HEAD moves to another tree while the gates run", () => {
		const { status, output } = run("gate", { extra: { NPM_COMMIT: "1" } });

		expect(status).toBe(0);
		expect(recorded()).toEqual([]);
		expect(output).toContain("the checkout changed while they ran");
	});

	it("stops at the first gate that fails, recording nothing", () => {
		const { status, output } = run("gate", {
			extra: { NPM_FAIL: "run build" },
		});

		expect(status).not.toBe(0);
		expect(gateCalls()).toEqual([
			"ci",
			"declared-imports",
			"run typecheck",
			"run build",
		]);
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

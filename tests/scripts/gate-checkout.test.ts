import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	commit,
	GATES,
	gateCalls,
	git,
	leftNothing,
	npmEnv,
	recorded,
	repoPath,
	run,
	scratchPath,
	script,
	shadow,
	useGateRepo,
	write,
} from "../helpers/script-repo.js";

useGateRepo();

const MAJOR = process.versions.node.split(".")[0]!;

// The bashes the gate must run under: the one PATH finds, and macOS's own,
// where there is one.
const SHELLS: [string, string | undefined][] = [
	["the bash PATH finds", undefined],
	...(existsSync("/bin/bash")
		? [["/bin/bash", "/bin/bash"] as [string, string]]
		: []),
];

/** A checkout of the commit given, made by hand as a gate makes its own. */
function handmade(commitish: string): { scratch: string; checkout: string } {
	const scratch = scratchPath("tmp", "agntc-gate.HANDMD");
	const checkout = `${scratch}/agntc`;
	git("worktree", "add", "-q", "--detach", checkout, commitish);
	return { scratch, checkout };
}

describe("scripts/gate's checkout", () => {
	it("holds every file, whatever a sparse caller leaves out", async () => {
		commit({ "src/cli.ts": "broken" });
		git("sparse-checkout", "set", "--no-cone", "/*", "!/src/cli.ts");
		expect(existsSync(repoPath("src/cli.ts"))).toBe(false);

		const { status } = await run("gate");

		expect(status).not.toBe(0);
		expect(gateCalls()).toEqual(GATES);
		expect(recorded()).toEqual([]);
	});

	it("is refused when git holds a file in it as left out", async () => {
		const head = git("rev-parse", "HEAD");
		const { scratch, checkout } = handmade(head);
		git("-C", checkout, "update-index", "--skip-worktree", "src/cli.ts");

		const { status, output } = await run("gate", {
			from: checkout,
			args: ["--in-checkout", repoPath(), head, scratch],
		});

		expect(status).toBe(1);
		expect(output).toContain(
			"gate: the checkout leaves out files git holds, src/cli.ts among them",
		);
		expect(gateCalls()).toEqual([]);
	});

	it("records the tree of the commit handed to it, not HEAD's", async () => {
		const handed = git("rev-parse", "HEAD");
		const tree = git("rev-parse", "HEAD^{tree}");
		const { scratch, checkout } = handmade(handed);
		commit({ "src/cli.ts": "two" });

		const { status } = await run("gate", {
			from: checkout,
			args: ["--in-checkout", repoPath(), handed, scratch],
		});

		expect(status).toBe(0);
		expect(recorded()).toEqual([tree]);
	});

	it.each([
		["the repo", () => repoPath()],
		["a folder not named as a gate's", () => scratchPath("tmp")],
	])("deletes nothing when handed %s as its folder", async (_, folder) => {
		const { status, output } = await run("gate", {
			args: ["--in-checkout", repoPath(), git("rev-parse", "HEAD"), folder()],
		});

		expect(status).toBe(1);
		expect(output).toContain("isn't a checkout a gate made");
		expect(existsSync(repoPath(".git"))).toBe(true);
		expect(existsSync(scratchPath("tmp"))).toBe(true);
	});

	it.each([
		"misnamed",
		"agntc-gate.SEVEN77",
	])("deletes nothing when handed a folder %s holding a checkout", async (name) => {
		const folder = scratchPath("tmp", name);
		mkdirSync(join(folder, "agntc"), { recursive: true });

		const { status, output } = await run("gate", {
			args: ["--in-checkout", repoPath(), git("rev-parse", "HEAD"), folder],
		});

		expect(status).toBe(1);
		expect(output).toContain("isn't a checkout a gate made");
		expect(existsSync(join(folder, "agntc"))).toBe(true);
	});

	it("leaves a hook's repo and index alone, its git environment exported from a linked worktree", async () => {
		const victim = scratchPath("victim");
		git("worktree", "add", "-q", "-b", "feat", victim);
		writeFileSync(join(victim, "staged.txt"), "staged\n");
		git("-C", victim, "add", "staged.txt");
		const gitdir = git("-C", victim, "rev-parse", "--absolute-git-dir");

		const { status } = await run("gate", {
			from: victim,
			extra: { GIT_DIR: gitdir, GIT_INDEX_FILE: `${gitdir}/index` },
		});

		expect(status).toBe(0);
		expect(git("-C", victim, "diff", "--cached", "--name-only")).toBe(
			"staged.txt",
		);
		expect(recorded()).toEqual([git("rev-parse", "HEAD^{tree}")]);
	});

	it("runs with a hook's git environment as the main worktree's hook has it, relative", async () => {
		write("staged.txt", "staged\n");
		git("add", "staged.txt");

		const { status } = await run("gate", {
			extra: { GIT_DIR: ".git", GIT_INDEX_FILE: ".git/index" },
		});

		expect(status).toBe(0);
		expect(git("diff", "--cached", "--name-only")).toBe("staged.txt");
		expect(recorded()).toEqual([git("rev-parse", "HEAD^{tree}")]);
	});

	it("is removed when HEAD's scripts/gate won't run", async () => {
		commit({ "scripts/gate": "#!/nonexistent/bash\n" });
		script("gate");

		const { status, output } = await run("gate");

		expect(status).toBe(1);
		expect(output).toContain("gate: HEAD's scripts/gate won't run");
		expect(leftNothing()).toBe(true);
	});

	it("runs with a TMPDIR relative to where it's called, handing the steps it whole", async () => {
		const { status } = await run("gate", {
			cwd: scratchPath(),
			extra: { TMPDIR: "tmp" },
		});

		expect(status).toBe(0);
		expect(npmEnv().get("TMPDIR")).toBe(scratchPath("tmp"));
		expect(leftNothing()).toBe(true);
	});

	it("ends its look above a relative TMPDIR at its top", async () => {
		const head = git("rev-parse", "HEAD");
		const { scratch, checkout } = handmade(head);

		const { status } = await run("gate", {
			from: checkout,
			cwd: scratchPath(),
			args: ["--in-checkout", repoPath(), head, scratch],
			extra: { TMPDIR: "tmp" },
		});

		expect(status).toBe(0);
	});

	it.each(
		SHELLS,
	)("deletes nothing when TMPDIR is missing, under %s", async (_, shell) => {
		const { status, output } = await run("gate", {
			shell,
			extra: { TMPDIR: scratchPath("missing") },
		});

		expect(status).toBe(1);
		expect(output).toContain("gate: no folder could be made in TMPDIR");
		expect(existsSync(repoPath(".git"))).toBe(true);
		expect(existsSync(repoPath("src/cli.ts"))).toBe(true);
	});

	it("is removed when HEAD holds no scripts/gate it can run", async () => {
		git("update-index", "--chmod=-x", "scripts/gate");
		git("commit", "-q", "-m", "not executable");

		const { status, output } = await run("gate");

		expect(status).toBe(1);
		expect(output).toContain("gate: HEAD has no scripts/gate to run");
		expect(leftNothing()).toBe(true);
	});
});

describe("scripts/gate's node", () => {
	it.each([
		["a major", MAJOR],
		["a v and a major", `v${MAJOR}`],
		["a whole version", `${MAJOR}.1.0`],
	])(".nvmrc may name %s", async (_, nvmrc) => {
		// No newline, so even the major alone is a change to commit.
		commit({ ".nvmrc": nvmrc });

		expect((await run("gate")).status).toBe(0);
	});

	it.each([
		[
			"is missing",
			undefined,
			"HEAD .+ has no .nvmrc to name the node it runs on",
		],
		[
			"names no version",
			"lts/iron",
			"HEAD's .nvmrc names no major version of node: lts/iron",
		],
	])("is refused when .nvmrc %s", async (_, nvmrc, message) => {
		if (nvmrc === undefined) {
			git("rm", "-q", ".nvmrc");
			git("commit", "-q", "-m", "no .nvmrc");
		} else {
			commit({ ".nvmrc": `${nvmrc}\n` });
		}

		const { status, output } = await run("gate");

		expect(status).toBe(1);
		expect(output).toMatch(
			new RegExp(`gate: ${message}, so nothing is run or recorded`),
		);
		expect(gateCalls()).toEqual([]);
	});

	it("is refused when it won't run", async () => {
		const path = shadow("node", "#!/bin/sh\nexit 1\n");

		const { status, output } = await run("gate", { extra: { PATH: path } });

		expect(status).toBe(1);
		expect(output).toContain(
			"gate: node won't run from PATH, so nothing is run or recorded",
		);
	});
});

describe("scripts/gate's steps", () => {
	it("end the gate with a failing step's own status", async () => {
		const { status } = await run("gate", {
			extra: { NPM_FAIL: "run build", NPM_FAIL_STATUS: "7" },
		});

		expect(status).toBe(7);
	});
});

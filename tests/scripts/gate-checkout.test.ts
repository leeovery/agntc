import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	commit,
	GATES,
	gateCalls,
	git,
	leftNothing,
	recorded,
	repoPath,
	run,
	scratchPath,
	shadow,
	useGateRepo,
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

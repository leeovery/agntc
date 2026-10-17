import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	commit,
	git,
	inertCommits,
	recordHead,
	repoPath,
	run,
	scratchPath,
	script,
	useScriptRepo,
	write,
} from "../helpers/script-repo.js";

// scripts/gate as gated relies on it: it records HEAD's tree on a pass.
const STUB_GATE = `#!/usr/bin/env bash
set -euo pipefail
echo "stub gate ran"
record=$(git rev-parse --path-format=absolute --git-common-dir)/agntc/gated
mkdir -p "$(dirname "$record")"
git rev-parse 'HEAD^{tree}' >>"$record"
`;

useScriptRepo(() => {
	script("gated");
	script("gate", STUB_GATE);
	commit({ "src/cli.ts": "one", "README.md": "one" }, "first");
	commit({ "src/cli.ts": "two" }, "second");
});

/** Commits a scripts/gate of the content given in place of the stub. */
function commitGate(content: string): void {
	script("gate", content);
	git("add", "-A");
	git("commit", "-q", "-m", "another gate");
}

describe("scripts/gated", () => {
	it("passes at once when HEAD's tree is recorded", async () => {
		recordHead();

		const { status, output } = await run("gated");

		expect(status).toBe(0);
		expect(output).toContain("gated: gates passed on tree");
		expect(output).not.toContain("stub gate ran");
	});

	it("passes when only inert paths changed since a recorded tree", async () => {
		recordHead();
		commit({ "README.md": "two", "design/v2.md": "notes" });
		commit({
			"CLAUDE.md": "rules",
			"CHANGELOG.md": "log",
			".mint.toml": "toml",
			"art/shot.png": "png",
			"demo/run.tape": "tape",
			".workflows/spec.md": "spec",
			".claude/settings.json": "{}",
		});

		const { status, output } = await run("gated");

		expect(status).toBe(0);
		expect(output).toContain("and nothing since changes code");
		expect(output).not.toContain("stub gate ran");
	});

	it.each([
		["src/cli.ts"],
		["tests/cli.test.ts"],
		["package.json"],
		["package-lock.json"],
		["vitest.config.ts"],
		["scripts/new"],
		["biome.json"],
		["src/README.md"],
		["src/design/x.ts"],
		["src/.claude/x.ts"],
		["src/.workflows/x.ts"],
		["tests/CLAUDE.md"],
		["designs/x.ts"],
		["design.config.ts"],
		["tsconfig.json"],
		["tsconfig.test.json"],
		["tsup.config.ts"],
		["docs/guide.md"],
	])("runs the gate when a commit since the recorded tree changes %s", async (path) => {
		recordHead();
		commit({ [path]: "changed" });

		const { status, output } = await run("gated");

		expect(status).toBe(0);
		expect(output).toContain("(it changes code): running the gates");
		expect(output).toContain("stub gate ran");
		expect(output).not.toContain("gates passed on tree");
	});

	it("runs the gate at a merge, though the merge brings only inert paths", async () => {
		recordHead();
		git("checkout", "-q", "-b", "side");
		commit({ "README.md": "side" });
		git("checkout", "-q", "main");
		git("merge", "-q", "--no-ff", "-m", "merge", "side");

		const { status, output } = await run("gated");

		expect(status).toBe(0);
		expect(output).toContain("(a merge): running the gates");
		expect(output).toContain("stub gate ran");
	});

	it("runs the gate when the walk reaches the first commit", async () => {
		git("checkout", "-q", "--orphan", "fresh");
		commit({ "README.md": "only" }, "root");

		const { output } = await run("gated");

		expect(output).toContain(
			"(the first commit, or a shallow clone's boundary): running the gates",
		);
		expect(output).toContain("stub gate ran");
	});

	it("runs the gate when the recorded tree lies 51 commits back", async () => {
		recordHead();
		inertCommits(51);

		const { output } = await run("gated");

		expect(output).toContain("no record of the gates within 50 commits");
		expect(output).toContain("stub gate ran");
	});

	it("passes a recorded tree 50 commits back", async () => {
		recordHead();
		inertCommits(50);

		const { output } = await run("gated");

		expect(output).toContain("and nothing since changes code");
		expect(output).not.toContain("stub gate ran");
	});

	it.each([
		["a changed tracked file", () => write("src/cli.ts", "dirty")],
		["an untracked file", () => write("src/new.ts", "new")],
		[
			"a staged change, nothing unstaged",
			() => {
				write("src/cli.ts", "staged");
				git("add", "src/cli.ts");
			},
		],
		[
			"a staged rename from code onto an inert path",
			() => {
				mkdirSync(repoPath("design"));
				git("mv", "src/cli.ts", "design/cli.ts");
			},
		],
	])("refuses a checkout with %s, its tree recorded or not", async (_, dirty) => {
		recordHead();
		dirty();

		const { status, output } = await run("gated");

		expect(status).toBe(1);
		expect(output).toContain(
			"gated: the checkout has changes outside the inert paths, and a release is of HEAD",
		);
		expect(output).not.toContain("stub gate ran");
	});

	it("passes a recorded tree when the checkout's changes are only inert", async () => {
		recordHead();
		write("README.md", "dirty");
		write("design/new.md", "new");

		const { output } = await run("gated");

		expect(output).toContain("gated: gates passed on tree");
		expect(output).not.toContain("stub gate ran");
	});

	it.each([
		["inside the repo", () => repoPath("src")],
		["outside the repo", () => scratchPath("bin")],
	])("runs from a folder %s", async (_, folder) => {
		recordHead();

		const { status, output } = await run("gated", { cwd: folder() });

		expect(status).toBe(0);
		expect(output).toContain("gated: gates passed on tree");
	});

	it("sees changes outside the folder it runs from", async () => {
		recordHead();
		write("tests/new.ts", "new");

		const { status } = await run("gated", { cwd: repoPath("src") });

		expect(status).toBe(1);
	});

	it("fails as the gate fails", async () => {
		commitGate("#!/usr/bin/env bash\nexit 3\n");

		expect((await run("gated")).status).toBe(3);
	});

	it("fails when the gate passes without recording HEAD's tree", async () => {
		commitGate("#!/usr/bin/env bash\nexit 0\n");

		const { status, output } = await run("gated");

		expect(status).toBe(1);
		expect(output).toContain(
			"gated: scripts/gate passed but recorded nothing for tree",
		);
	});
});

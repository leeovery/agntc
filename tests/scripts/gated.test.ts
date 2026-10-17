import { mkdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	commit,
	git,
	inertCommits,
	recordHead,
	repoPath,
	run,
	script,
	useScriptRepo,
	write,
} from "../helpers/script-repo.js";

const STUB_GATE = `#!/usr/bin/env bash
echo "stub gate ran"
`;

useScriptRepo(() => {
	script("gated");
	script("gate", STUB_GATE);
	commit({ "src/cli.ts": "one", "README.md": "one" }, "first");
	commit({ "src/cli.ts": "two" }, "second");
});

describe("scripts/gated", () => {
	it("passes at once when HEAD's tree is recorded", () => {
		recordHead();

		const { status, output } = run("gated");

		expect(status).toBe(0);
		expect(output).toContain("gated: gates passed on tree");
		expect(output).not.toContain("stub gate ran");
	});

	it("passes when only inert paths changed since a recorded tree", () => {
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

		const { status, output } = run("gated");

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
		["tsconfig.json"],
		["tsconfig.test.json"],
		["tsup.config.ts"],
		["docs/guide.md"],
	])("runs the gate when a commit since the recorded tree changes %s", (path) => {
		recordHead();
		commit({ [path]: "changed" });

		const { status, output } = run("gated");

		expect(status).toBe(0);
		expect(output).toContain("(it changes code): running the gates");
		expect(output).toContain("stub gate ran");
	});

	it("runs the gate at a merge, though the merge brings only inert paths", () => {
		recordHead();
		git("checkout", "-q", "-b", "side");
		commit({ "README.md": "side" });
		git("checkout", "-q", "main");
		git("merge", "-q", "--no-ff", "-m", "merge", "side");

		const { status, output } = run("gated");

		expect(status).toBe(0);
		expect(output).toContain("(a merge): running the gates");
		expect(output).toContain("stub gate ran");
	});

	it("runs the gate when the walk reaches the first commit", () => {
		git("checkout", "-q", "--orphan", "fresh");
		commit({ "README.md": "only" }, "root");

		const { output } = run("gated");

		expect(output).toContain(
			"(the first commit, or a shallow clone's boundary): running the gates",
		);
		expect(output).toContain("stub gate ran");
	});

	it("runs the gate when the recorded tree lies 51 commits back", () => {
		recordHead();
		inertCommits(51);

		const { output } = run("gated");

		expect(output).toContain("no record of the gates within 50 commits");
		expect(output).toContain("stub gate ran");
	});

	it("passes a recorded tree 50 commits back", () => {
		recordHead();
		inertCommits(50);

		const { output } = run("gated");

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
	])("runs the gate when the checkout has %s", (_, dirty) => {
		recordHead();
		dirty();

		const { output } = run("gated");

		expect(output).toContain(
			"the checkout has changes outside the inert paths: running the gates",
		);
		expect(output).toContain("stub gate ran");
	});

	it("passes a recorded tree when the checkout's changes are only inert", () => {
		recordHead();
		write("README.md", "dirty");
		write("design/new.md", "new");

		const { output } = run("gated");

		expect(output).toContain("gated: gates passed on tree");
		expect(output).not.toContain("stub gate ran");
	});

	it("fails as the gate fails", () => {
		script("gate", "#!/usr/bin/env bash\nexit 3\n");
		git("add", "-A");
		git("commit", "-q", "-m", "failing gate");

		expect(run("gated").status).toBe(3);
	});
});

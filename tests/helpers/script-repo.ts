import { execFileSync, spawn } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

const SCRIPTS = resolve(import.meta.dirname, "../../scripts");

// npm as the gates call it, wherever they run: each call logged, with the
// folder it ran in, and failing when NPM_FAIL names it. ci installs and logs
// the environment it was given. test fails on a src/cli.ts that reads
// `broken`; commits a change to the repo NPM_MOVE names, as HEAD moving under
// the gate; and when NPM_HANG names a file, writes it and waits to be
// stopped, as one process, so no signal lands between the two, catching
// the signal and exiting 1 when NPM_CATCH is set, as vitest does.
const FAKE_NPM = `#!/usr/bin/env bash
echo "$*" >>"$NPM_LOG"
pwd -P >>"$NPM_LOG.where"
if [ "$1" = ci ]; then
	mkdir -p node_modules
	env >"$NPM_LOG.env"
	cat "$NPM_CONFIG_USERCONFIG" "$NPM_CONFIG_GLOBALCONFIG" >"$NPM_LOG.npmrc"
fi
if [ "$1" = test ]; then
	if [ -n "\${NPM_MOVE:-}" ]; then
		echo moved >"$NPM_MOVE/src/moved.ts"
		git -C "$NPM_MOVE" add -A
		git -C "$NPM_MOVE" commit -qm moved
	fi
	if [ -n "\${NPM_HANG:-}" ]; then
		exec perl -e '
			$SIG{INT} = $SIG{TERM} = sub { exit 1 } if $ENV{NPM_CATCH};
			open my $f, ">", $ENV{NPM_HANG}; close $f; sleep 30'
	fi
	[ "$(cat src/cli.ts)" != broken ] || exit 1
fi
[ "$*" != "\${NPM_FAIL:-}" ]
`;

// The import check, logged as npm's calls are, failing when NPM_FAIL names it.
const STUB_DECLARED_IMPORTS = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.NPM_LOG, "declared-imports\\n");
if (process.env.NPM_FAIL === "declared-imports") process.exit(1);
`;

/** What scripts/gate runs, in order, as the call log names it. */
export const GATES = [
	"ci",
	"declared-imports",
	"run typecheck",
	"run build",
	"test -- --allowOnly=false",
];

let root: string;
let repo: string;
let bin: string;
let npmLog: string;

function enter(dir: string): void {
	root = dir;
	repo = join(root, "repo");
	bin = join(root, "bin");
	npmLog = join(root, "npm.log");
}

/** A script repo holding scripts/gate, its import check stubbed, committed. */
export function useGateRepo(): void {
	useScriptRepo(() => {
		script("gate");
		script("declared-imports.mjs", STUB_DECLARED_IMPORTS);
		commit(
			{
				".gitignore": "node_modules/\ndist/\n",
				".nvmrc": `${process.versions.node.split(".")[0]}\n`,
				"package.json": "{}",
				"package-lock.json": "{}",
				"src/cli.ts": "one",
			},
			"first",
		);
	});
}

/**
 * A git repo of its own for each test, with npm on its PATH faked and TMPDIR
 * a folder of the test's own, in which the repo's scripts run as copies.
 * `setup` builds it once, in a template each test gets a copy of, as git
 * takes most of a test's time.
 */
export function useScriptRepo(setup: () => void): void {
	let template: string;

	beforeAll(() => {
		template = mkdtempSync(join(tmpdir(), "agntc-gate-template-"));
		enter(template);
		for (const folder of [repo, bin, scratchPath("tmp"), scratchPath("xdg")]) {
			mkdirSync(folder);
		}
		writeFileSync(join(bin, "npm"), FAKE_NPM);
		chmodSync(join(bin, "npm"), 0o755);
		git("init", "-q", "-b", "main");
		setup();
	});

	beforeEach(() => {
		enter(mkdtempSync(join(tmpdir(), "agntc-gate-test-")));
		cpSync(template, root, { recursive: true });
	});

	// The git calls are synchronous; a turn of the event loop between tests
	// lets vitest's worker answer its runner.
	afterEach(async () => {
		rmSync(root, { recursive: true, force: true });
		await new Promise((resume) => setImmediate(resume));
	});

	afterAll(() => {
		rmSync(template, { recursive: true, force: true });
	});
}

export function repoPath(...parts: string[]): string {
	return join(repo, ...parts);
}

export function scratchPath(...parts: string[]): string {
	return join(root, ...parts);
}

function env(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const kept = Object.fromEntries(
		Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_")),
	);
	return {
		...kept,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		// git reads $XDG_CONFIG_HOME/git/ignore and the like whatever
		// GIT_CONFIG_GLOBAL says.
		XDG_CONFIG_HOME: scratchPath("xdg"),
		// A commit otherwise starts maintenance in the background, which can
		// still hold a lock file in .git as the next test copies the template.
		GIT_CONFIG_COUNT: "1",
		GIT_CONFIG_KEY_0: "maintenance.auto",
		GIT_CONFIG_VALUE_0: "false",
		GIT_AUTHOR_NAME: "test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "test",
		GIT_COMMITTER_EMAIL: "test@example.com",
		PATH: `${bin}:${process.env.PATH}`,
		TMPDIR: scratchPath("tmp"),
		NPM_LOG: npmLog,
		...extra,
	};
}

export function git(...args: string[]): string {
	return execFileSync("git", args, {
		cwd: repo,
		env: env(),
		encoding: "utf-8",
	}).trim();
}

export function write(path: string, content: string): void {
	const file = repoPath(path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

export function commit(files: Record<string, string>, message = "change") {
	for (const [path, content] of Object.entries(files)) {
		write(path, content);
	}
	git("add", "-A");
	git("commit", "-q", "-m", message);
}

/** Commits `count` changes to README.md on main, in one git call. */
export function inertCommits(count: number): void {
	const data = (text: string) => `data ${Buffer.byteLength(text)}\n${text}\n`;
	let stream = "";
	for (let i = 0; i < count; i++) {
		stream += "commit refs/heads/main\n";
		stream += "committer test <test@example.com> 0 +0000\n";
		stream += data(`readme ${i}`);
		if (i === 0) {
			stream += `from ${git("rev-parse", "HEAD")}\n`;
		}
		stream += `M 100644 inline README.md\n${data(`readme ${i}`)}`;
	}
	execFileSync("git", ["fast-import", "--quiet"], {
		cwd: repo,
		env: env(),
		input: stream,
	});
	git("reset", "-q", "--hard");
}

/** Puts scripts/<name> in the repo: the repo's own, or the content given. */
export function script(name: string, content?: string): void {
	const file = repoPath("scripts", name);
	mkdirSync(dirname(file), { recursive: true });
	if (content === undefined) {
		copyFileSync(join(SCRIPTS, name), file);
	} else {
		writeFileSync(file, content);
	}
	chmodSync(file, 0o755);
}

export interface Ran {
	status: number | null;
	output: string;
}

export interface RunOptions {
	/** The checkout whose scripts/ the script is taken from; the repo by default. */
	from?: string;
	/** Where it runs; `from` by default. */
	cwd?: string;
	extra?: Record<string, string>;
}

/**
 * Starts scripts/<name> in a process group of its own, so a signal sent to
 * `-pid` reaches it and whatever it is running.
 */
export function start(
	name: string,
	{ from = repo, cwd = from, extra = {} }: RunOptions = {},
): { pid: number; done: Promise<Ran> } {
	const child = spawn(join(from, "scripts", name), [], {
		cwd,
		env: env(extra),
		detached: true,
	});
	let output = "";
	child.stdout.on("data", (chunk) => {
		output += chunk;
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
	});
	const done = new Promise<Ran>((settle) => {
		child.on("close", (status) => settle({ status, output }));
	});
	return { pid: child.pid!, done };
}

export function run(name: string, options: RunOptions = {}): Promise<Ran> {
	return start(name, options).done;
}

function recordFile(): string {
	return repoPath(".git", "agntc", "gated");
}

/** The trees the record holds, in the order they were recorded. */
export function recorded(): string[] {
	return lines(recordFile());
}

export function recordHead(): void {
	mkdirSync(dirname(recordFile()), { recursive: true });
	writeFileSync(recordFile(), `${git("rev-parse", "HEAD^{tree}")}\n`, {
		flag: "a",
	});
}

/** The calls the gates made to npm and the import check, in order. */
export function gateCalls(): string[] {
	return lines(npmLog);
}

/** The folders npm ran in, one a call. */
export function npmFolders(): string[] {
	return lines(`${npmLog}.where`);
}

/** The folders of the repo's worktrees, its own first. */
export function worktrees(): string[] {
	return git("worktree", "list", "--porcelain")
		.split("\n")
		.filter((line) => line.startsWith("worktree "))
		.map((line) => line.slice("worktree ".length));
}

/** Whether the gate left no checkout behind: none in TMPDIR, none in git's list. */
export function leftNothing(): boolean {
	return (
		readdirSync(scratchPath("tmp")).length === 0 && worktrees().length === 1
	);
}

/** What npm ci found in the user and global config files it was given. */
export function npmConfigRead(): string {
	return readFileSync(`${npmLog}.npmrc`, "utf-8");
}

/** The environment npm ci was given, by name. */
export function npmEnv(): Map<string, string> {
	return new Map(
		lines(`${npmLog}.env`).map((line) => {
			const at = line.indexOf("=");
			return [line.slice(0, at), line.slice(at + 1)] as const;
		}),
	);
}

function lines(file: string): string[] {
	if (!existsSync(file)) {
		return [];
	}
	return readFileSync(file, "utf-8").split("\n").filter(Boolean);
}

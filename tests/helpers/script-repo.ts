import { execFileSync, spawnSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

const SCRIPTS = resolve(import.meta.dirname, "../../scripts");

// npm as the gates call it: each call logged, and failing when NPM_FAIL
// names it. ci installs, writing npm's record of the install, before it
// would fail; test writes the file NPM_TOUCH names, as a checkout changing
// under the gates.
const FAKE_NPM = `#!/usr/bin/env bash
echo "$*" >>"$NPM_LOG"
if [ "$1" = ci ]; then
	rm -rf node_modules
	mkdir node_modules
	echo installed >node_modules/.package-lock.json
fi
if [ "$1" = test ] && [ -n "\${NPM_TOUCH:-}" ]; then
	echo touched >"$NPM_TOUCH"
fi
[ "$*" != "\${NPM_FAIL:-}" ]
`;

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

/**
 * A git repo of its own for each test, with npm on its PATH faked, in which
 * the repo's scripts run as copies. `setup` builds it once, in a template
 * each test gets a copy of, as git takes most of a test's time.
 */
export function useScriptRepo(setup: () => void): void {
	let template: string;

	beforeAll(() => {
		template = mkdtempSync(join(tmpdir(), "agntc-gate-template-"));
		enter(template);
		mkdirSync(repo);
		mkdirSync(bin);
		writeFileSync(join(bin, "npm"), FAKE_NPM);
		chmodSync(join(bin, "npm"), 0o755);
		git("init", "-q", "-b", "main");
		setup();
	});

	beforeEach(() => {
		enter(mkdtempSync(join(tmpdir(), "agntc-gate-test-")));
		cpSync(template, root, { recursive: true });
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
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
		GIT_AUTHOR_NAME: "test",
		GIT_AUTHOR_EMAIL: "test@example.com",
		GIT_COMMITTER_NAME: "test",
		GIT_COMMITTER_EMAIL: "test@example.com",
		PATH: `${bin}:${process.env.PATH}`,
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

export function run(
	name: string,
	{
		cwd = repo,
		extra = {},
	}: { cwd?: string; extra?: Record<string, string> } = {},
): { status: number | null; output: string } {
	const result = spawnSync(join(cwd, "scripts", name), {
		cwd,
		env: env(extra),
		encoding: "utf-8",
	});
	return { status: result.status, output: result.stdout + result.stderr };
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

/** The npm calls made since the last `forgetNpmCalls`. */
export function npmCalls(): string[] {
	return lines(npmLog);
}

export function forgetNpmCalls(): void {
	rmSync(npmLog, { force: true });
}

function lines(file: string): string[] {
	if (!existsSync(file)) {
		return [];
	}
	return readFileSync(file, "utf-8").split("\n").filter(Boolean);
}

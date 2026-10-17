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
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

const SCRIPTS = resolve(import.meta.dirname, "../../scripts");

// npm as the gates call it: each call logged, and failing when NPM_FAIL
// names it. ci installs, writing npm's record of the install, before it
// would fail; test writes the file NPM_TOUCH names, or commits one when
// NPM_COMMIT is set, as a checkout changing under the gates.
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
if [ "$1" = test ] && [ -n "\${NPM_COMMIT:-}" ]; then
	echo moved >src/moved.ts
	git add src/moved.ts
	git commit -qm moved
fi
[ "$*" != "\${NPM_FAIL:-}" ]
`;

// node and uname as the gate's stamp reads them, from FAKE_NODE_VERSION and
// FAKE_UNAME; node runs anything else as the real one does.
const FAKE_NODE = `#!/usr/bin/env bash
if [ "$1" = --version ]; then
	echo "\${FAKE_NODE_VERSION:-v24.0.0}"
	exit 0
fi
exec "${process.execPath}" "$@"
`;
const FAKE_UNAME = `#!/usr/bin/env bash
echo "\${FAKE_UNAME:-Darwin arm64}"
`;

// The import check, logged as the gates are.
const STUB_DECLARED_IMPORTS = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.NPM_LOG, "declared-imports\\n");
`;

/** What scripts/gate runs after npm ci, in order, as the call log names it. */
export const GATES = ["declared-imports", "run typecheck", "run build", "test"];

function tool(name: string, content: string): void {
	writeFileSync(join(bin, name), content);
	chmodSync(join(bin, name), 0o755);
}

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
				"package.json": "{}",
				"package-lock.json": "{}",
				"src/cli.ts": "one",
			},
			"first",
		);
	});
}

/** Writes a file dated a minute ahead, so newer than anything the gate wrote. */
export function writeLater(path: string): void {
	write(path, "later");
	const later = new Date(Date.now() + 60_000);
	utimesSync(repoPath(path), later, later);
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
		tool("npm", FAKE_NPM);
		tool("node", FAKE_NODE);
		tool("uname", FAKE_UNAME);
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

/** The npm calls made since the last `forgetGateCalls`. */
export function gateCalls(): string[] {
	return lines(npmLog);
}

export function forgetGateCalls(): void {
	rmSync(npmLog, { force: true });
}

function lines(file: string): string[] {
	if (!existsSync(file)) {
		return [];
	}
	return readFileSync(file, "utf-8").split("\n").filter(Boolean);
}

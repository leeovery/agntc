import { sep } from "node:path";

/**
 * Project installs live under the working directory; global ones under the
 * home directory. Either way the layout below the root is the same:
 * `.claude/…` for what's installed, `.agntc/manifest.json` for the record.
 */
export type ScopeName = "project" | "global";

export interface Scope {
	name: ScopeName;
	/** The folder `.claude` and `.agntc` sit in. */
	root: string;
}

export function projectScope(root: string = process.cwd()): Scope {
	return { name: "project", root };
}

export function globalScope(home: string): Scope {
	return { name: "global", root: home };
}

export type ScopedCommand = "add" | "remove" | "update" | "list";

/**
 * The `npx agntc …` line that runs `command` with `args` on this scope's
 * installs, ready to paste: an argument a shell would split or expand is
 * single-quoted.
 */
export function agntcCommand(
	scope: ScopeName,
	command: ScopedCommand,
	args: string[],
): string {
	const flags = scope === "global" ? ["-g"] : [];
	return ["npx agntc", command, ...flags, ...args.map(shellWord)].join(" ");
}

/**
 * Characters every shell takes literally. `^` and `~` are left out: zsh's
 * `EXTENDED_GLOB` reads them as glob operators even mid-word, as in `@^1.2.3`.
 */
const PLAIN_WORD = /^[\w@%+=:,./-]+$/;

function shellWord(word: string): string {
	return PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** Where a scope installs, as a terminal's header says it: `global`, or the project root. */
export function scopeWhere(scope: Scope, home: string): string {
	return scope.name === "global" ? "global" : homeShortened(scope.root, home);
}

/** `path` with the home folder it starts with written as `~`. */
export function homeShortened(path: string, home: string): string {
	if (path === home) {
		return "~";
	}
	return path.startsWith(`${home}${sep}`)
		? `~${path.slice(home.length)}`
		: path;
}

/** What a command's title says at a terminal. */
export function commandTitle(command: ScopedCommand, scope: ScopeName): string {
	return scope === "global" ? `agntc ${command} · global` : `agntc ${command}`;
}

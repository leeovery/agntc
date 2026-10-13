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

/** Characters a shell takes literally, `^` and `~` included as they sit mid-word in a version. */
const PLAIN_WORD = /^[\w@%+=:,./^~-]+$/;

function shellWord(word: string): string {
	return PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/** What a command's title says at a terminal. */
export function commandTitle(command: ScopedCommand, scope: ScopeName): string {
	return scope === "global" ? `agntc ${command} · global` : `agntc ${command}`;
}

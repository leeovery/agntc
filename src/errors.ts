export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err;
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

const GIT_FATAL = "fatal: ";

/** Lines git and ssh write around a failure that don't name it. */
const NOT_THE_CAUSE = /^(warning:|hint:|cloning into)/i;

/**
 * A git failure in one line for the terminal: the first line that names it,
 * with git's `fatal: ` taken off. Warnings, hints and progress before it are
 * passed over, and so is the advice after it, which would read a passing
 * refusal as an access problem. A message of nothing else gives its first line.
 */
export function gitErrorCause(message: string): string {
	const lines = message
		.split("\n")
		.map((part) => part.trim())
		.filter((part) => part !== "");
	const line =
		lines.find((part) => !NOT_THE_CAUSE.test(part)) ?? lines[0] ?? "";
	return line.startsWith(GIT_FATAL) ? line.slice(GIT_FATAL.length) : line;
}

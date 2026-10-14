export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err;
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

const GIT_FATAL = "fatal: ";

/**
 * A git failure in one line for the terminal: the first line of its message
 * with git's `fatal: ` taken off. The advice git appends after it would read
 * a passing refusal as an access problem.
 */
export function gitErrorCause(message: string): string {
	const line =
		message
			.split("\n")
			.map((part) => part.trim())
			.find((part) => part !== "") ?? "";
	return line.startsWith(GIT_FATAL) ? line.slice(GIT_FATAL.length) : line;
}

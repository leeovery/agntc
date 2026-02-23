export function isNodeError(err: unknown): err is NodeJS.ErrnoException {
	return err instanceof Error && "code" in err;
}

export function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

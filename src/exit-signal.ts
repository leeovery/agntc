export class ExitSignal extends Error {
	readonly code: number;

	constructor(code: number) {
		super(`exit:${code}`);
		this.name = "ExitSignal";
		this.code = code;
	}
}

export function withExitSignal<T extends (...args: any[]) => Promise<void>>(
	fn: T,
): T {
	return (async (...args: any[]) => {
		try {
			await fn(...args);
		} catch (err) {
			if (err instanceof ExitSignal) {
				return process.exit(err.code);
			}
			throw err;
		}
	}) as T;
}

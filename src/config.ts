import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { errorMessage, isNodeError } from "./errors.js";

export interface AgntcConfig {
	type?: string;
}

export interface ReadConfigOptions {
	onWarn?: (message: string) => void;
}

export async function readConfig(
	dir: string,
	options?: ReadConfigOptions,
): Promise<AgntcConfig | null> {
	const filePath = join(dir, "agntc.json");

	let raw: string;
	try {
		raw = await readFile(filePath, "utf-8");
	} catch (err: unknown) {
		if (isNodeError(err) && err.code === "ENOENT") {
			return null;
		}
		throw err;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (err: unknown) {
		options?.onWarn?.(`Ignoring malformed agntc.json: ${errorMessage(err)}`);
		return null;
	}

	if (typeof parsed !== "object" || parsed === null) {
		return null;
	}

	const { type } = parsed as { type?: unknown };
	return typeof type === "string" ? { type } : null;
}

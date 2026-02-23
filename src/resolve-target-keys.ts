import * as p from "@clack/prompts";
import { ExitSignal } from "./exit-signal.js";
import type { Manifest } from "./manifest.js";

export function resolveTargetKeys(key: string, manifest: Manifest): string[] {
	const exactMatch = manifest[key];
	if (exactMatch) {
		return [key];
	}

	const prefix = `${key}/`;
	const prefixKeys = Object.keys(manifest).filter((k) => k.startsWith(prefix));

	if (prefixKeys.length === 0) {
		p.log.error(`Plugin ${key} is not installed.`);
		throw new ExitSignal(1);
	}

	return prefixKeys;
}

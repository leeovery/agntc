import type { Manifest } from "./manifest.js";
import type { Ui } from "./ui.js";

export function resolveTargetKeys(
	key: string,
	manifest: Manifest,
	ui: Ui,
): string[] {
	const exactMatch = manifest[key];
	if (exactMatch) {
		return [key];
	}

	const prefix = `${key}/`;
	const prefixKeys = Object.keys(manifest).filter((k) => k.startsWith(prefix));

	if (prefixKeys.length === 0) {
		ui.fail(`${key} is not installed.`);
	}

	return prefixKeys;
}

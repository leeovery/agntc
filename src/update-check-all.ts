import { errorMessage } from "./errors.js";
import type { Manifest } from "./manifest.js";
import type { UpdateCheckResult } from "./update-check.js";
import { checkForUpdate } from "./update-check.js";

/** A key's result from {@link checkAllForUpdates}, read as failed when missing. */
export function checkResultFor(
	checks: Map<string, UpdateCheckResult>,
	key: string,
): UpdateCheckResult {
	return checks.get(key) ?? { status: "check-failed", reason: "unknown" };
}

export async function checkAllForUpdates(
	manifest: Manifest,
): Promise<Map<string, UpdateCheckResult>> {
	const entries = Object.entries(manifest);

	if (entries.length === 0) {
		return new Map();
	}

	const results = await Promise.all(
		entries.map(async ([key, entry]): Promise<[string, UpdateCheckResult]> => {
			try {
				const result = await checkForUpdate(key, entry);
				return [key, result];
			} catch (err) {
				return [
					key,
					{
						status: "check-failed",
						reason: errorMessage(err),
					} as UpdateCheckResult,
				];
			}
		}),
	);

	return new Map(results);
}

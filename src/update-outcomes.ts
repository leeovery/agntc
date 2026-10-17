import type { Manifest } from "./manifest.js";
import { writeManifest } from "./manifest.js";
import { remedyItem } from "./terminal/next.js";
import type { Ui } from "./ui.js";
import {
	applyOutcome,
	isSuccessOutcome,
	type PluginOutcome,
} from "./update-groups.js";

/**
 * What a unit's outcomes leave the reader: a reinstall's notes, which print
 * under the row the unit settles into, and a failure's remedy, under Next,
 * named as its row names it, a local entry's folder shortened against `home`.
 */
export function reportOutcomes(
	outcomes: PluginOutcome[],
	ui: Ui,
	home: string,
): void {
	for (const outcome of outcomes) {
		if (isSuccessOutcome(outcome)) {
			for (const note of outcome.notes) {
				ui.note(note);
			}
		}
		const item =
			"message" in outcome && outcome.message !== undefined
				? remedyItem(outcome.message, home)
				: null;
		if (item !== null) {
			ui.next(item);
		}
	}
}

/**
 * Folds ONE unit's (group, local or single key) outcomes into the working
 * manifest via {@link applyOutcome} and writes it — the per-unit persistence
 * boundary. The write is SKIPPED for a no-op unit. Returns the
 * (possibly-updated) manifest so the caller threads it into the next unit,
 * keeping each write cumulative.
 */
export async function persistUnitOutcomes(
	root: string,
	manifest: Manifest,
	outcomes: PluginOutcome[],
): Promise<Manifest> {
	const updatedManifest = outcomes.reduce(applyOutcome, manifest);
	if (updatedManifest !== manifest) {
		await writeManifest(root, updatedManifest);
	}
	return updatedManifest;
}

import { checkFileCollisions } from "./collision-check.js";
import {
	removeCollidingEntries,
	resolveCollisions,
} from "./collision-resolve.js";
import type { Manifest } from "./manifest.js";
import { removePathsInTheWay } from "./nuke-files.js";
import { joinWithAnd } from "./summary.js";
import type { Mode, Ui } from "./ui.js";
import { checkUnmanagedConflicts } from "./unmanaged-check.js";
import { resolveUnmanagedConflicts } from "./unmanaged-resolve.js";

/**
 * What to do with files in the way of an install, whether another entry's or
 * files agntc didn't install: replace them, ask, or stop the item.
 */
export type ConflictPolicy = "overwrite" | "ask" | "stop";

/** `--overwrite` replaces without asking; without it only a terminal can be asked. */
export function conflictPolicy(overwrite: boolean, mode: Mode): ConflictPolicy {
	if (overwrite) {
		return "overwrite";
	}
	return mode === "interactive" ? "ask" : "stop";
}

export interface ConflictCheck {
	incomingFiles: string[];
	manifest: Manifest;
	/** The item's own key: files recorded under it are its own, not in the way. */
	key: string;
	projectDir: string;
}

/** Why an item won't be copied. */
export interface Stop {
	reason: string;
	/** The flags that would have let it through. */
	flags?: string[];
}

export interface ClearedConflicts {
	manifest: Manifest;
	stop: Stop | null;
}

const NOT_RESOLVED: Stop = { reason: "conflict not resolved" };
const OVERWRITE_FLAGS = ["--overwrite"];

/**
 * Clears the files in an item's way under `policy`: first those other entries
 * installed, then those agntc didn't install. Overwriting another entry's
 * files removes that entry, as choosing to at the prompt does.
 */
export async function clearConflicts(
	check: ConflictCheck,
	policy: ConflictPolicy,
	ui: Ui,
): Promise<ClearedConflicts> {
	const afterCollisions = await clearCollisions(check, policy, ui);
	if (afterCollisions.stop !== null) {
		return afterCollisions;
	}
	const unmanaged = await checkUnmanagedConflicts(
		check.incomingFiles,
		afterCollisions.manifest,
		check.projectDir,
	);
	return {
		manifest: afterCollisions.manifest,
		stop: await clearUnmanaged(unmanaged, check, policy, ui),
	};
}

async function clearCollisions(
	{ incomingFiles, manifest, key, projectDir }: ConflictCheck,
	policy: ConflictPolicy,
	ui: Ui,
): Promise<ClearedConflicts> {
	const collisions = checkFileCollisions(incomingFiles, manifest, key);
	if (collisions.size === 0) {
		return { manifest, stop: null };
	}
	switch (policy) {
		case "overwrite":
			return {
				manifest: await removeCollidingEntries(
					collisions.keys(),
					manifest,
					projectDir,
				),
				stop: null,
			};
		case "ask": {
			const resolution = await resolveCollisions(
				collisions,
				manifest,
				projectDir,
				ui,
			);
			return {
				manifest: resolution.updatedManifest,
				stop: resolution.resolved ? null : NOT_RESOLVED,
			};
		}
		case "stop":
			return {
				manifest,
				stop: {
					reason: `files in the way belong to ${joinWithAnd([...collisions.keys()])}: ${[...collisions.values()].flat().join(", ")}`,
					flags: OVERWRITE_FLAGS,
				},
			};
	}
}

/**
 * Once replacing them is approved, removes the files in the way, a link as a
 * link, so the copy writes real folders rather than merging into what was there.
 */
async function clearUnmanaged(
	files: string[],
	{ key, projectDir }: ConflictCheck,
	policy: ConflictPolicy,
	ui: Ui,
): Promise<Stop | null> {
	if (files.length === 0) {
		return null;
	}
	if (policy === "stop") {
		return {
			reason: `files in the way weren't installed by agntc: ${files.join(", ")}`,
			flags: OVERWRITE_FLAGS,
		};
	}
	if (policy === "ask") {
		const { cancelled } = await resolveUnmanagedConflicts(
			[{ pluginKey: key, files }],
			ui,
		);
		if (cancelled.length > 0) {
			return NOT_RESOLVED;
		}
	}
	await removePathsInTheWay(projectDir, files);
	return null;
}

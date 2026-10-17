import { checkFileCollisions } from "./collision-check.js";
import {
	PartialRemovalError,
	removeCollidingEntries,
	resolveCollisions,
} from "./collision-resolve.js";
import type { EntryHead } from "./entry-head.js";
import { errorMessage } from "./errors.js";
import { ExitSignal } from "./exit-signal.js";
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
	/** The item, as a question's row names it. */
	head: EntryHead;
	/** The home folder a question's row shortens a local entry's key against. */
	home: string;
}

/**
 * Why an item won't be copied: skipped, as the policy has it or as the
 * question was answered, or failed, when clearing its way threw.
 */
export interface Stop {
	status: "skipped" | "failed";
	reason: string;
	/** The flags that would have let it through. */
	flags?: string[];
}

/** What was cleared out of an item's way: another entry, removed, or files agntc didn't install, replaced. */
export type Clearance =
	| { kind: "entry"; key: string; files: string[] }
	| { kind: "unmanaged"; files: string[] };

export interface ClearedConflicts {
	/** Without the entries removed, even when a later removal failed. */
	manifest: Manifest;
	stop: Stop | null;
	/** What was cleared out of the item's way, in the order it went, whether it then stopped or not. */
	cleared: Clearance[];
}

const OVERWRITE_FLAGS = ["--overwrite"];

/**
 * Clears the files in an item's way under `policy`: first those other entries
 * installed, then those agntc didn't install. Overwriting another entry's
 * files removes that entry, as choosing to at the prompt does. A removal that
 * fails stops the item as failed rather than throwing.
 */
export async function clearConflicts(
	check: ConflictCheck,
	policy: ConflictPolicy,
	ui: Ui,
): Promise<ClearedConflicts> {
	const collisions = checkFileCollisions(
		check.incomingFiles,
		check.manifest,
		check.key,
	);
	let manifest = check.manifest;
	let replaced: string[] = [];
	const ended = (stop: Stop | null): ClearedConflicts => ({
		manifest,
		stop,
		cleared: [
			...removedEntries(collisions, manifest),
			...(replaced.length > 0
				? [{ kind: "unmanaged" as const, files: replaced }]
				: []),
		],
	});
	try {
		const afterCollisions = await clearCollisions(
			collisions,
			check,
			policy,
			ui,
		);
		manifest = afterCollisions.manifest;
		if (afterCollisions.stop !== null) {
			return ended(afterCollisions.stop);
		}
		const unmanaged = await checkUnmanagedConflicts(
			check.incomingFiles,
			manifest,
			check.projectDir,
		);
		const stop = await clearUnmanaged(unmanaged, check, policy, ui);
		if (stop === null) {
			replaced = unmanaged;
		}
		return ended(stop);
	} catch (err) {
		if (err instanceof ExitSignal) {
			throw err;
		}
		if (err instanceof PartialRemovalError) {
			manifest = err.manifest;
		}
		return ended({
			status: "failed",
			reason: `couldn't clear the files in its way: ${errorMessage(err)}`,
		});
	}
}

/** The colliding entries `manifest` no longer holds, each with its files that were in the way. */
function removedEntries(
	collisions: Map<string, string[]>,
	manifest: Manifest,
): Clearance[] {
	return [...collisions]
		.filter(([key]) => manifest[key] === undefined)
		.map(([key, files]) => ({ kind: "entry", key, files }));
}

interface ClearedCollisions {
	manifest: Manifest;
	stop: Stop | null;
}

/** A question answered no stops the item on the entries still in its way. */
async function clearCollisions(
	collisions: Map<string, string[]>,
	{ manifest, projectDir, home }: ConflictCheck,
	policy: ConflictPolicy,
	ui: Ui,
): Promise<ClearedCollisions> {
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
			const { resolved, updatedManifest } = await resolveCollisions(
				collisions,
				manifest,
				projectDir,
				ui,
				home,
			);
			const left = [...collisions].filter(
				([key]) => updatedManifest[key] !== undefined,
			);
			return {
				manifest: updatedManifest,
				stop: resolved
					? null
					: { status: "skipped", reason: collisionReason(new Map(left)) },
			};
		}
		case "stop":
			return {
				manifest,
				stop: {
					status: "skipped",
					reason: collisionReason(collisions),
					flags: OVERWRITE_FLAGS,
				},
			};
	}
}

/** Whose files are in the way, and which. */
function collisionReason(collisions: Map<string, string[]>): string {
	return `files in the way belong to ${joinWithAnd([...collisions.keys()])}: ${[...collisions.values()].flat().join(", ")}`;
}

/**
 * Once replacing them is approved, removes the files in the way, a link as a
 * link, so the copy writes real folders rather than merging into what was there.
 */
async function clearUnmanaged(
	files: string[],
	{ head, projectDir }: ConflictCheck,
	policy: ConflictPolicy,
	ui: Ui,
): Promise<Stop | null> {
	if (files.length === 0) {
		return null;
	}
	const reason = `files in the way weren't installed by agntc: ${files.join(", ")}`;
	if (policy === "stop") {
		return { status: "skipped", reason, flags: OVERWRITE_FLAGS };
	}
	if (policy === "ask") {
		const { cancelled } = await resolveUnmanagedConflicts(
			[{ head, files }],
			ui,
		);
		if (cancelled.length > 0) {
			return { status: "skipped", reason };
		}
	}
	await removePathsInTheWay(projectDir, files);
	return null;
}

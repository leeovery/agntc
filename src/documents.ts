import type {
	FoundPack,
	FoundSkill,
	PackAssetDir,
	StrayAssets,
} from "./discover.js";
import type { InstallItem } from "./install-item.js";
import type { EntryType, Manifest, ManifestEntry } from "./manifest.js";
import type { ItemOutcome } from "./summary.js";
import type { UpdateCheckResult } from "./update-check.js";
import { checkResultFor } from "./update-check-all.js";
import type { PluginOutcome } from "./update-groups.js";

/** The source `add` read, at the version it resolved to. */
export interface SourceJson {
	source: string;
	ref: string | null;
	commit: string | null;
	constraint: string | null;
}

export interface AddItemJson {
	key: string;
	type: EntryType;
	path: string;
	status: ItemOutcome["status"];
	files?: string[];
	reason?: string;
	flags?: string[];
}

export interface AddBody extends SourceJson {
	items: AddItemJson[];
}

export function addBody(source: SourceJson, outcomes: ItemOutcome[]): AddBody {
	return { ...source, items: outcomes.map(addItem) };
}

function addItem(outcome: ItemOutcome): AddItemJson {
	const { key, kind, path, status } = outcome;
	const item: AddItemJson = { key, type: kind, path, status };
	if (outcome.status === "installed") {
		return { ...item, files: outcome.files };
	}
	return {
		...item,
		reason: outcome.reason,
		...(outcome.flags !== undefined ? { flags: outcome.flags } : {}),
	};
}

export interface ListedSkillJson {
	name: string;
	path: string;
	description: string | null;
}

export interface ListedPackJson {
	name: string;
	path: string;
	skillCount: number;
	skills: ListedSkillJson[];
	assetDirs: PackAssetDir[];
}

/** What `add --list` found, and what a refused menu would have offered. */
export interface ListingBody extends SourceJson {
	packs: ListedPackJson[];
	skills: ListedSkillJson[];
	strays: StrayAssets[];
}

export function listingBody(
	source: SourceJson,
	items: InstallItem[],
	strays: StrayAssets[],
): ListingBody {
	const packs = items.flatMap((item) =>
		item.kind === "pack" ? [item.pack] : [],
	);
	const skills = items.flatMap((item) =>
		item.kind === "skill" ? [item.skill] : [],
	);
	return {
		...source,
		packs: packs.map(listedPack),
		skills: skills.map(listedSkill),
		strays,
	};
}

function listedPack(pack: FoundPack): ListedPackJson {
	return {
		name: pack.name,
		path: pack.path,
		skillCount: pack.skills.length,
		skills: pack.skills.map(listedSkill),
		assetDirs: pack.assetDirs,
	};
}

function listedSkill(skill: FoundSkill): ListedSkillJson {
	return {
		name: skill.name,
		path: skill.path,
		description: skill.description ?? null,
	};
}

/** An installed entry's identity and version. */
interface EntryJson {
	key: string;
	type: EntryType;
	ref: string | null;
	commit: string | null;
	constraint: string | null;
}

function entryJson(key: string, entry: ManifestEntry): EntryJson {
	return {
		key,
		type: entry.type ?? "skill",
		ref: entry.ref,
		commit: entry.commit,
		constraint: entry.constraint ?? null,
	};
}

export interface RemovedJson extends EntryJson {
	files: string[];
}

export interface FailedRemovalJson extends EntryJson {
	reason: string;
}

/** A key `remove` couldn't remove, and why; its entry stays recorded. */
export interface RemovalFailure {
	key: string;
	reason: string;
}

/** What became of the keys `remove` set out to remove. */
export interface Removal {
	removed: string[];
	failed: RemovalFailure[];
}

/** `manifest` is the one the run started from. */
export function removeBody(
	manifest: Manifest,
	{ removed, failed }: Removal,
): { removed: RemovedJson[]; failed: FailedRemovalJson[] } {
	return {
		removed: removed.flatMap((key) => {
			const entry = manifest[key];
			return entry === undefined
				? []
				: [{ ...entryJson(key, entry), files: entry.files }];
		}),
		failed: failed.flatMap(({ key, reason }) => {
			const entry = manifest[key];
			return entry === undefined ? [] : [{ ...entryJson(key, entry), reason }];
		}),
	};
}

/** What an update check says beyond its status. */
interface CheckDetailsJson {
	reason?: string;
	newerTags?: string[];
	latestOutsideConstraint?: string;
}

function checkDetails(check: UpdateCheckResult | undefined): CheckDetailsJson {
	switch (check?.status) {
		case "check-failed":
			return { reason: check.reason };
		case "newer-tags":
			return { newerTags: check.tags };
		case "constrained-update-available":
		case "constrained-up-to-date":
			return check.latestOverall === null
				? {}
				: { latestOutsideConstraint: check.latestOverall };
		default:
			return {};
	}
}

export interface ListEntryJson extends EntryJson, CheckDetailsJson {
	installedAt: string;
	status: UpdateCheckResult["status"];
	availableRef?: string | null;
	availableCommit?: string;
}

export function listBody(
	manifest: Manifest,
	checks: Map<string, UpdateCheckResult>,
): { entries: ListEntryJson[] } {
	return {
		entries: Object.entries(manifest).map(([key, entry]) => {
			const check = checkResultFor(checks, key);
			return {
				...entryJson(key, entry),
				installedAt: entry.installedAt,
				status: check.status,
				...available(entry, check),
				...checkDetails(check),
			};
		}),
	};
}

function available(
	entry: ManifestEntry,
	check: UpdateCheckResult,
): Pick<ListEntryJson, "availableRef" | "availableCommit"> {
	switch (check.status) {
		case "update-available":
			return { availableRef: entry.ref, availableCommit: check.remoteCommit };
		case "constrained-update-available":
			return { availableRef: check.tag, availableCommit: check.commit };
		default:
			return {};
	}
}

/**
 * One entry `update` looked at. `ref` and `commit` are what's recorded after
 * the run; an update that moved carries where it came from as well.
 */
export interface UpdateItemJson extends EntryJson, CheckDetailsJson {
	status: PluginOutcome["status"];
	previousRef?: string | null;
	previousCommit?: string | null;
	/**
	 * What a terminal showed for an entry that didn't simply update: a failure
	 * with its remedy, or what became of an entry gone upstream or absorbed.
	 */
	message?: string;
	/** The flags that would have settled what couldn't be asked without a terminal. */
	flags?: string[];
}

/** `outcomes` in the order to report them; `before` is the manifest the run started from. */
export function updateBody(
	before: Manifest,
	outcomes: PluginOutcome[],
	checks: Map<string, UpdateCheckResult>,
): { items: UpdateItemJson[] } {
	return {
		items: outcomes.flatMap((outcome) => {
			const entry = before[outcome.key];
			return entry === undefined
				? []
				: [updateItem(outcome, entry, checks.get(outcome.key))];
		}),
	};
}

function updateItem(
	outcome: PluginOutcome,
	before: ManifestEntry,
	check: UpdateCheckResult | undefined,
): UpdateItemJson {
	const details = checkDetails(check);
	switch (outcome.status) {
		case "updated":
			return {
				...entryJson(outcome.key, outcome.newEntry),
				status: outcome.status,
				previousRef: before.ref,
				previousCommit: before.commit,
				...details,
			};
		case "refreshed":
			return {
				...entryJson(outcome.key, outcome.newEntry),
				status: outcome.status,
				...details,
			};
		case "gone-kept":
			return {
				...entryJson(outcome.key, before),
				status: outcome.status,
				message: outcome.summary,
				...(outcome.flags !== undefined ? { flags: outcome.flags } : {}),
				...details,
			};
		case "failed":
		case "copy-failed":
		case "aborted":
		case "blocked":
		case "gone-removed":
		case "absorbed":
			return {
				...entryJson(outcome.key, before),
				status: outcome.status,
				message: outcome.summary,
				...details,
			};
		default:
			return {
				...entryJson(outcome.key, before),
				status: outcome.status,
				...details,
			};
	}
}

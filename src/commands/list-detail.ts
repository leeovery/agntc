import {
	type AssetCounts,
	type AssetType,
	identifyAssetType,
	targetDir,
} from "../asset-targets.js";
import { gitErrorCause } from "../errors.js";
import { isInstalledSkill } from "../install-paths.js";
import type { EntryType, ManifestEntry } from "../manifest.js";
import {
	formatAssetCounts,
	formatPackCounts,
	formatRefLabel,
} from "../summary.js";
import type { Ui } from "../ui.js";
import {
	hasOutOfConstraintVersion,
	type UpdateCheckResult,
} from "../update-check.js";
import { isVersionTag } from "../version-resolve.js";

export type DetailAction = "update" | "remove" | "change-version" | "back";

export interface DetailViewInput {
	key: string;
	entry: ManifestEntry;
	updateStatus: UpdateCheckResult;
	/** Where the entry is installed, which tells its skills from its support folders. */
	installRoot: string;
}

const ENTRY_LABELS: Record<EntryType, string> = {
	skill: "Skill",
	pack: "Pack",
};

function formatCommit(entry: ManifestEntry): string {
	if (entry.commit) return entry.commit.slice(0, 7);
	return "\u2014";
}

function formatDate(isoDate: string): string {
	return isoDate.slice(0, 10);
}

/** What an entry's recorded files install; `other` counts files under no asset type. */
interface EntryAssets {
	counts: AssetCounts;
	other: number;
}

/**
 * Counts each `.claude/skills/<name>/` once: a skill when the install holds
 * its `SKILL.md`, else a pack's support folder, as the manifest records the
 * two alike. Agents and hooks count their recorded paths.
 */
async function countAssets(
	files: string[],
	installRoot: string,
): Promise<EntryAssets> {
	const folders = [...new Set(files.flatMap(skillFolderOf))];
	const isSkill = await Promise.all(
		folders.map((name) => isInstalledSkill(installRoot, name)),
	);
	const skills = isSkill.filter(Boolean).length;
	const typed = (type: AssetType | null) =>
		files.filter((file) => identifyAssetType(file) === type).length;
	return {
		counts: {
			skills,
			folders: folders.length - skills,
			agents: typed("agents"),
			hooks: typed("hooks"),
		},
		other: typed(null),
	};
}

/** The `<name>` of a path in `.claude/skills/<name>/`, if it's in one. */
function skillFolderOf(file: string): string[] {
	if (identifyAssetType(file) !== "skills") {
		return [];
	}
	const [name = ""] = file.slice(targetDir("skills").length + 1).split("/");
	return name === "" ? [] : [name];
}

/**
 * What the entry installs, on one line: a pack's counts as `add` words them,
 * a skill's only those it has. Empty for an entry recording no files.
 */
async function assetSummary(
	entry: ManifestEntry,
	installRoot: string,
): Promise<string> {
	if (entry.files.length === 0) {
		return "";
	}
	const { counts, other } = await countAssets(entry.files, installRoot);
	const assets =
		entry.type === "pack"
			? formatPackCounts(counts)
			: formatAssetCounts(counts);
	return [assets, other > 0 ? `${other} other` : ""]
		.filter((part) => part !== "")
		.join(", ");
}

// `canChangeVersion` is decided by the caller from the installed ref (tag-based)
// and reachability — see renderDetailView.
function getActions(
	updateResult: UpdateCheckResult,
	canChangeVersion: boolean,
): Array<{ value: DetailAction; label: string }> {
	const actions: Array<{ value: DetailAction; label: string }> = [];

	// "Update" applies only when there's an in-range (or HEAD) update to pull.
	// A tag-pinned install at the latest tag has nothing to "update" — it switches
	// versions via "Change version" instead.
	if (
		updateResult.status === "update-available" ||
		updateResult.status === "constrained-update-available" ||
		updateResult.status === "local"
	) {
		actions.push({ value: "update", label: "Update" });
	}

	// "Change version" lets any tag-pinned install jump to any other tag — newer
	// or older. Gated so HEAD/branch/local installs and unreachable remotes (where
	// there's no tag list to choose from) don't offer it.
	if (canChangeVersion) {
		actions.push({ value: "change-version", label: "Change version" });
	}

	actions.push(
		{ value: "remove", label: "Remove" },
		{ value: "back", label: "Back" },
	);
	return actions;
}

/** Why the view offers no update: no version in range, or a check that failed. */
function reportStatusProblem(
	entry: ManifestEntry,
	updateStatus: UpdateCheckResult,
	ui: Ui,
): void {
	if (updateStatus.status === "constrained-no-match") {
		ui.log.error(
			`No matching version found for constraint "${entry.constraint}"`,
		);
	}
	if (updateStatus.status === "check-failed") {
		ui.log.warn(
			`Couldn't check for updates (${gitErrorCause(updateStatus.reason)})`,
		);
	}
}

export async function renderDetailView(
	input: DetailViewInput,
	ui: Ui,
): Promise<DetailAction> {
	const { key, entry, updateStatus, installRoot } = input;

	// The out-of-constraint version (when present) folds into the Constraint line
	// rather than a separate trailing bullet.
	const outOfConstraint = hasOutOfConstraintVersion(updateStatus)
		? ` (${updateStatus.latestOverall} available outside constraint)`
		: "";

	ui.log.info(`${ENTRY_LABELS[entry.type ?? "skill"]}: ${key}`);
	ui.log.info(`Ref: ${formatRefLabel(entry.ref, entry.commit)}`);
	if (entry.constraint) {
		ui.log.info(`Constraint: ${entry.constraint}${outOfConstraint}`);
	}
	ui.log.info(`Commit: ${formatCommit(entry)}`);
	ui.log.info(`Installed: ${formatDate(entry.installedAt)}`);

	// One compact counts line — no raw file-path dump.
	const assets = await assetSummary(entry, installRoot);
	if (assets.length > 0) {
		ui.log.info(`Assets: ${assets}`);
	}

	reportStatusProblem(entry, updateStatus, ui);

	// A tag-pinned install (ref parses as a version) can switch to any other tag,
	// but only when we can actually reach the remote to list them.
	const canChangeVersion =
		isVersionTag(entry.ref) && updateStatus.status !== "check-failed";
	const actions = getActions(updateStatus, canChangeVersion);

	const selected = await ui.select<DetailAction>({
		message: "Action",
		options: actions,
	});

	return selected ?? "back";
}

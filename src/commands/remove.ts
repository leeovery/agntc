import { Command } from "commander";
import { type AssetType, identifyAssetType } from "../asset-targets.js";
import { commandAction, globalOption, jsonOption } from "../command-action.js";
import { type Removal, removeBody } from "../documents.js";
import { errorMessage } from "../errors.js";
import { ExitSignal } from "../exit-signal.js";
import {
	type Manifest,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";
import {
	agntcCommand,
	commandTitle,
	projectScope,
	type Scope,
	type ScopeName,
} from "../scope.js";
import { renderRemoveSummary } from "../summary.js";
import { interactiveUi, type Ui } from "../ui.js";

export interface RemoveOptions {
	/** Remove without asking for confirmation. */
	yes?: boolean;
}

interface Targets {
	keys: string[];
	summaryLabel: string;
}

async function selectKeysInteractive(
	manifest: Manifest,
	ui: Ui,
): Promise<string[]> {
	const options = Object.entries(manifest).map(([key, entry]) => ({
		value: key,
		label: key,
		hint: entry.ref ?? "HEAD",
	}));

	return ui.multiselect<string>({
		message: "Select what to remove",
		options,
		required: false,
	});
}

interface FileGroup {
	header: string;
	files: string[];
}

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
	skills: "Skills",
	agents: "Agents",
	hooks: "Hooks",
};

function classifyFile(file: string): string {
	const assetType = identifyAssetType(file);
	return assetType === null ? "Other" : ASSET_TYPE_LABELS[assetType];
}

function groupFilesByType(files: string[]): FileGroup[] {
	const order = ["Skills", "Agents", "Hooks", "Other"];
	const groups = new Map<string, string[]>();

	for (const file of files) {
		const type = classifyFile(file);
		const existing = groups.get(type);
		if (existing) {
			existing.push(file);
		} else {
			groups.set(type, [file]);
		}
	}

	const result: FileGroup[] = [];
	for (const type of order) {
		const typeFiles = groups.get(type);
		if (typeFiles && typeFiles.length > 0) {
			result.push({ header: type, files: typeFiles });
		}
	}
	return result;
}

export async function runRemove(
	key?: string,
	options: RemoveOptions = {},
	ui: Ui = interactiveUi,
	scope: Scope = projectScope(),
): Promise<void> {
	ui.intro(commandTitle("remove", scope.name));

	const manifest = await readManifestOrExit(scope.root, ui);

	if (Object.keys(manifest).length === 0) {
		ui.outro("No skills or packs installed.");
		ui.report(removeBody(manifest, { removed: [], failed: [] }));
		return;
	}

	const targets =
		key !== undefined
			? targetsForKey(key, manifest, ui)
			: await pickTargets(manifest, scope.name, ui);

	const allFiles = targets.keys.flatMap((k) => manifest[k]?.files ?? []);

	if (key !== undefined && targets.keys.length > 1) {
		for (const k of targets.keys) {
			ui.log.info(k);
		}
	}

	for (const group of groupFilesByType(allFiles)) {
		ui.log.message(group.header);
		for (const file of group.files) {
			ui.log.message(`  ${file}`);
		}
	}

	await confirmRemoval(targets.summaryLabel, allFiles.length, options, ui);

	const removal = await removeEach(targets.keys, manifest, scope.root);
	await writeManifest(
		scope.root,
		removal.removed.reduce(removeEntry, manifest),
	);

	for (const failure of removal.failed) {
		ui.log.error(
			`${failure.key}: failed — ${failure.reason}; it stays recorded`,
		);
	}
	ui.outro(removalSummary(targets, removal, manifest));
	ui.report(removeBody(manifest, removal));

	if (removal.failed.length > 0) {
		throw new ExitSignal(1);
	}
}

/**
 * Removes each key's files, carrying on past a key that fails, which stays
 * recorded so whatever is left of it stays tracked.
 */
async function removeEach(
	keys: string[],
	manifest: Manifest,
	installRoot: string,
): Promise<Removal> {
	const removal: Removal = { removed: [], failed: [] };
	for (const key of keys) {
		try {
			await nukeManifestFiles(installRoot, manifest[key]?.files ?? []);
			removal.removed.push(key);
		} catch (err) {
			removal.failed.push({ key, reason: errorMessage(err) });
		}
	}
	return removal;
}

function removalSummary(
	targets: Targets,
	{ removed }: Removal,
	manifest: Manifest,
): string {
	if (removed.length === 0) {
		return "Nothing removed";
	}
	const summaryLabel =
		removed.length === targets.keys.length
			? targets.summaryLabel
			: labelFor(removed, `${removed.length} install(s)`);
	const fileCount = removed.flatMap((k) => manifest[k]?.files ?? []).length;
	return renderRemoveSummary({ summaryLabel, fileCount });
}

function targetsForKey(key: string, manifest: Manifest, ui: Ui): Targets {
	const keys = resolveTargetKeys(key, manifest, ui);
	return { keys, summaryLabel: labelFor(keys, key) };
}

async function pickTargets(
	manifest: Manifest,
	scope: ScopeName,
	ui: Ui,
): Promise<Targets> {
	if (ui.mode === "machine") {
		ui.fail(
			`remove needs the key of what to remove without a terminal: ${agntcCommand(scope, "remove", [])} <key>`,
			{ flags: ["<key>"] },
		);
	}
	const keys = await selectKeysInteractive(manifest, ui);
	if (keys.length === 0) {
		ui.cancel("Cancelled");
		throw new ExitSignal(0);
	}
	return { keys, summaryLabel: labelFor(keys, `${keys.length} install(s)`) };
}

/** A lone key names itself; several go by `several`. */
function labelFor(keys: string[], several: string): string {
	const [only] = keys;
	return keys.length === 1 && only !== undefined ? only : several;
}

/** `-y` answers the question; without it, machine mode refuses before anything is deleted. */
async function confirmRemoval(
	summaryLabel: string,
	fileCount: number,
	options: RemoveOptions,
	ui: Ui,
): Promise<void> {
	if (options.yes) {
		return;
	}
	if (ui.mode === "machine") {
		ui.fail(
			`removing ${summaryLabel} deletes ${fileCount} file(s) — confirm with -y`,
			{ flags: ["-y"] },
		);
	}
	const confirmed = await ui.confirm({
		message: `Remove ${summaryLabel}? ${fileCount} file(s) will be deleted.`,
	});
	if (!confirmed) {
		ui.cancel("Cancelled");
		throw new ExitSignal(0);
	}
}

export const removeCommand = new Command("remove")
	.description("Remove installed skills and packs")
	.argument(
		"[key]",
		"Key to remove (owner/repo or owner/repo/<skill or pack path>)",
	)
	.option("-y, --yes", "Remove without asking for confirmation")
	.addOption(globalOption())
	.addOption(jsonOption())
	.action(
		commandAction(
			"remove",
			(ui, scope, key: string | undefined, options: RemoveOptions) =>
				runRemove(key, options, ui, scope),
		),
	);

import { Command } from "commander";
import { type AssetType, identifyAssetType } from "../asset-targets.js";
import { commandAction, globalOption, jsonOption } from "../command-action.js";
import { removeBody } from "../documents.js";
import { ExitSignal } from "../exit-signal.js";
import {
	type Manifest,
	readManifestOrExit,
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

async function selectPluginsInteractive(
	manifest: Manifest,
	ui: Ui,
): Promise<string[]> {
	const options = Object.entries(manifest).map(([key, entry]) => ({
		value: key,
		label: key,
		hint: entry.ref ?? "HEAD",
	}));

	return ui.multiselect<string>({
		message: "Select plugins to remove",
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
		ui.outro("No plugins installed.");
		ui.report(removeBody([], manifest));
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

	for (const k of targets.keys) {
		const entry = manifest[k];
		if (entry) {
			await nukeManifestFiles(scope.root, entry.files);
		}
	}

	const updated: Manifest = {};
	for (const [k, v] of Object.entries(manifest)) {
		if (!targets.keys.includes(k)) {
			updated[k] = v;
		}
	}
	await writeManifest(scope.root, updated);

	ui.outro(
		renderRemoveSummary({
			summaryLabel: targets.summaryLabel,
			fileCount: allFiles.length,
		}),
	);
	ui.report(removeBody(targets.keys, manifest));
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
	const keys = await selectPluginsInteractive(manifest, ui);
	if (keys.length === 0) {
		ui.cancel("Cancelled");
		throw new ExitSignal(0);
	}
	return { keys, summaryLabel: labelFor(keys, `${keys.length} plugin(s)`) };
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
	.description("Remove installed plugins")
	.argument("[key]", "Plugin key to remove (owner/repo or owner/repo/plugin)")
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

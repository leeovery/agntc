import { homedir } from "node:os";
import { Command } from "commander";
import { commandAction, globalOption, jsonOption } from "../command-action.js";
import { type Removal, removeBody } from "../documents.js";
import { assetSummary, kindAndCounts } from "../entry-assets.js";
import { errorMessage } from "../errors.js";
import { ExitSignal } from "../exit-signal.js";
import { nothingInstalledRow } from "../list-render.js";
import {
	type Manifest,
	type ManifestEntry,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import {
	removalQuestion,
	removalRow,
	removedRow,
	removeFailedRow,
} from "../remove-render.js";
import { resolveTargetKeys } from "../resolve-target-keys.js";
import {
	agntcCommand,
	homeShortened,
	projectScope,
	type Scope,
	type ScopeName,
} from "../scope.js";
import { formatRefLabel } from "../summary.js";
import type { Noun, Row } from "../terminal/types.js";
import { type Choice, interactiveUi, type Ui } from "../ui.js";

export interface RemoveOptions {
	/** Remove without asking for confirmation. */
	yes?: boolean;
}

/** What the question counts the entries its room leaves out as. */
const ENTRY: Noun = { one: "entry", many: "entries" };

/** An entry `remove` set out to remove, as its rows name it. */
interface Target {
	key: string;
	entry: ManifestEntry;
	/** Its key as a row names it: a local one shortened against the home folder. */
	subject: string;
	/** Its kind, a pack's with what it installs. */
	kind: string;
}

/**
 * Removes the entries `key` names, or those picked at a terminal, once their
 * rows' question is answered or `-y` answers it. Each entry whose files are
 * removed goes from the manifest; one whose files can't be stays, so
 * whatever is left of it stays tracked, and the command exits 1.
 */
export async function runRemove(
	key?: string,
	options: RemoveOptions = {},
	ui: Ui = interactiveUi(),
	scope: Scope = projectScope(),
): Promise<void> {
	ui.header();

	const home = homedir();
	const manifest = await readManifestOrExit(scope.root, ui);

	if (Object.keys(manifest).length === 0) {
		const row = nothingInstalledRow();
		ui.block([row]).row(row);
		ui.close({ command: "remove", counts: {} });
		ui.report(removeBody(manifest, { removed: [], failed: [] }));
		return;
	}

	const keys =
		key !== undefined
			? keysFor(key, manifest, options, ui)
			: await pickKeys(manifest, scope.name, ui, home);
	const targets = await describeTargets(keys, manifest, scope.root, home);

	if (!options.yes) {
		await confirmRemoval(targets, ui);
	}

	const removal = await removeEach(keys, manifest, scope.root);
	await writeManifest(
		scope.root,
		removal.removed.reduce(removeEntry, manifest),
	);

	const rows = targets.map((target) => resultRow(target, removal));
	const block = ui.block(rows);
	for (const row of rows) {
		block.row(row);
	}
	ui.close({
		command: "remove",
		counts: {
			removed: removal.removed.length,
			failed: removal.failed.length,
		},
	});
	ui.report(removeBody(manifest, removal));

	if (removal.failed.length > 0) {
		throw new ExitSignal(1);
	}
}

/**
 * The entries `key` names. Without `-y` and a terminal to ask at, refuses
 * before anything is deleted, naming the flag that answers the question.
 */
function keysFor(
	key: string,
	manifest: Manifest,
	options: RemoveOptions,
	ui: Ui,
): string[] {
	const keys = resolveTargetKeys(key, manifest, ui);
	if (!options.yes && ui.mode === "machine") {
		const fileCount = keys.flatMap((k) => manifest[k]?.files ?? []).length;
		ui.fail(
			`removing ${labelFor(keys, key)} deletes ${fileCount} file(s) — confirm with -y`,
			{ flags: ["-y"] },
		);
	}
	return keys;
}

/** A lone key names itself; several go by the key naming them. */
function labelFor(keys: string[], key: string): string {
	const [only] = keys;
	return keys.length === 1 && only !== undefined ? only : key;
}

/** The entries picked at a terminal; machine mode needs the key instead. */
async function pickKeys(
	manifest: Manifest,
	scope: ScopeName,
	ui: Ui,
	home: string,
): Promise<string[]> {
	if (ui.mode === "machine") {
		ui.fail(
			`remove needs the key of what to remove without a terminal: ${agntcCommand(scope, "remove", [])} <key>`,
			{ flags: ["<key>"] },
		);
	}
	const keys = await ui.multiselect<string>({
		message: "Select what to remove",
		options: Object.entries(manifest).map(([key, entry]) =>
			pickerChoice(key, entry, home),
		),
		required: false,
	});
	if (keys.length === 0) {
		return cancel(ui);
	}
	return keys;
}

/** An entry by its key, a local one's shortened, then its kind and its ref, dim; a narrow line drops the kind, then the ref. */
function pickerChoice(
	key: string,
	entry: ManifestEntry,
	home: string,
): Choice<string> {
	return {
		value: key,
		label: subjectOf(key, entry, home),
		cells: [
			{ text: entry.type ?? "skill", dim: true, drop: 1 },
			{ text: formatRefLabel(entry.ref, entry.commit), dim: true, drop: 2 },
		],
	};
}

function subjectOf(key: string, entry: ManifestEntry, home: string): string {
	return entry.commit === null ? homeShortened(key, home) : key;
}

/** Each entry with what its rows say of it, read before its files go. */
function describeTargets(
	keys: readonly string[],
	manifest: Manifest,
	installRoot: string,
	home: string,
): Promise<Target[]> {
	return Promise.all(
		keys.flatMap((key) => {
			const entry = manifest[key];
			return entry === undefined
				? []
				: [describeTarget(key, entry, installRoot, home)];
		}),
	);
}

async function describeTarget(
	key: string,
	entry: ManifestEntry,
	installRoot: string,
	home: string,
): Promise<Target> {
	const assets = await assetSummary(entry, installRoot);
	return {
		key,
		entry,
		subject: subjectOf(key, entry, home),
		kind: kindAndCounts(entry, assets),
	};
}

/** Asks under every entry's row, fitted together; no ends the run. */
async function confirmRemoval(
	targets: readonly Target[],
	ui: Ui,
): Promise<void> {
	const rows = targets.map(({ subject, kind, entry }) =>
		removalRow(subject, kind, entry.files),
	);
	const confirmed = await ui.block(rows).confirm(
		{ rows, noun: ENTRY },
		{
			message: removalQuestion(targets.map(({ entry }) => entry.files)),
		},
	);
	if (!confirmed) {
		cancel(ui);
	}
}

function cancel(ui: Ui): never {
	ui.cancel("Cancelled");
	throw new ExitSignal(0);
}

/** What became of the entry: removed, with what it installed, or failed, with why. */
function resultRow(
	{ key, entry, subject, kind }: Target,
	{ failed }: Removal,
): Row {
	const failure = failed.find((each) => each.key === key);
	return failure === undefined
		? removedRow(subject, kind, entry.files)
		: removeFailedRow(subject, failure.reason);
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

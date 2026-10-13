import { basename, join } from "node:path";
import { Command, Option } from "commander";
import {
	type ChoiceContext,
	type ChoiceOutcome,
	chooseItems,
	menuOption,
	offeredItems,
	optionLine,
	type Selection,
	type SelectionFlags,
	selectionFromFlags,
	strayNotices,
	unansweredMenu,
} from "../choose-items.js";
import {
	type ConflictPolicy,
	clearConflicts,
	conflictPolicy,
} from "../clear-conflicts.js";
import { commandAction, jsonOption } from "../command-action.js";
import { computeIncomingFiles } from "../compute-incoming-files.js";
import { copyItem } from "../copy-item.js";
import { checkEscapingSymlinks, PathTraversalError } from "../copy-safety.js";
import {
	type Discovery,
	discover,
	PackConflictError,
	StartPathError,
} from "../discover.js";
import { addBody, listingBody, type SourceJson } from "../documents.js";
import { errorMessage } from "../errors.js";
import { ExitSignal } from "../exit-signal.js";
import { cleanupTempDir, cloneSource } from "../git-clone.js";
import { fetchRemoteTags } from "../git-utils.js";
import {
	type InstallItem,
	itemLabel,
	itemPath,
	type KeyedItem,
	keyItems,
} from "../install-item.js";
import { promptForItems } from "../item-menu.js";
import {
	addEntry,
	buildManifestEntry,
	type Manifest,
	readManifest,
	removeEntry,
	writeManifest,
} from "../manifest.js";
import { nukeManifestFiles } from "../nuke-files.js";
import {
	type ParsedSource,
	parseSource,
	resolveCloneUrl,
} from "../source-parser.js";
import {
	formatRefLabel,
	type ItemIdentity,
	type ItemOutcome,
	pluralize,
	renderAddSummary,
} from "../summary.js";
import { interactiveUi, type Ui } from "../ui.js";
import { resolveLatestVersion, resolveVersion } from "../version-resolve.js";

export interface AddOptions extends SelectionFlags {
	/** Replace files in the way without asking. */
	overwrite?: boolean;
}

/** A source ready to install from: its files on disk and how it is recorded. */
interface FetchedSource {
	/** The manifest key prefix: `owner/repo`, or the local path. */
	key: string;
	root: string;
	startPath?: string;
	rootName: string;
	/** The `@ref` or `@constraint` the user typed, for suggested commands. */
	version?: string;
	ref: string | null;
	commit: string | null;
	cloneUrl: string | null;
	constraint: string | undefined;
}

interface TagResolutionResult {
	parsed: ParsedSource;
	constraint: string | undefined;
}

const ENGINE_ERRORS = [StartPathError, PathTraversalError, PackConflictError];

/** The flags that answer the menu when there's no terminal to show it on. */
const MENU_FLAGS = ["--skill", "--pack", "--all"];

export async function resolveTagConstraint(
	parsed: ParsedSource,
): Promise<TagResolutionResult> {
	if (parsed.type === "local-path") {
		return { parsed, constraint: undefined };
	}

	let updatedParsed = parsed;
	let derivedConstraint: string | undefined;
	const url = resolveCloneUrl(updatedParsed);

	if (updatedParsed.ref === null && updatedParsed.constraint === null) {
		// Bare add: resolve latest semver tag and auto-apply constraint
		const tags = await fetchRemoteTags(url);
		const latest = resolveLatestVersion(tags);
		if (latest !== null) {
			derivedConstraint = `^${latest.version}`;
			updatedParsed = { ...updatedParsed, ref: latest.tag };
		}
	} else if (updatedParsed.constraint != null) {
		// Explicit constraint: resolve best matching tag within bounds
		const tags = await fetchRemoteTags(url);
		const resolved = resolveVersion(updatedParsed.constraint, tags);
		if (resolved === null) {
			throw new Error(
				`No tags satisfy constraint ${updatedParsed.constraint} for ${updatedParsed.manifestKey}`,
			);
		}
		updatedParsed = { ...updatedParsed, ref: resolved.tag };
	}

	const constraint = updatedParsed.constraint ?? derivedConstraint;
	return { parsed: updatedParsed, constraint: constraint ?? undefined };
}

export async function runAdd(
	source: string,
	options: AddOptions = {},
	ui: Ui = interactiveUi,
): Promise<void> {
	ui.intro("agntc add");

	if (options.plugin) {
		ui.note("--plugin is now --pack");
	}
	const selection = selectionFromFlags(options);
	if (!selection.ok) {
		return ui.fail(selection.message);
	}

	let tempDir: string | undefined;

	try {
		const typed = await parseSource(source);
		const { parsed, constraint } = await resolveTagConstraint(typed);
		const fetched = await fetchSource(parsed, ui);
		tempDir = fetched.tempDir;

		const src = describeSource(typed, parsed, constraint, fetched);
		if (options.list) {
			await listSource(src, selection.selection, ui);
			return;
		}
		const items = await pickItems(src, selection.selection, ui);
		const policy = conflictPolicy(options.overwrite === true, ui.mode);
		await installItems(items, src, policy, ui);
	} catch (err) {
		if (err instanceof ExitSignal) {
			throw err;
		}
		ui.fail(errorMessage(err));
	} finally {
		if (tempDir) {
			await cleanupTempDir(tempDir).catch(() => {});
		}
	}
}

async function fetchSource(
	parsed: ParsedSource,
	ui: Ui,
): Promise<{ root: string; commit: string | null; tempDir?: string }> {
	if (parsed.type === "local-path") {
		return { root: parsed.resolvedPath, commit: null };
	}

	const spin = ui.spinner();
	spin.start("Cloning repository...");
	try {
		const { tempDir, commit } = await cloneSource(parsed);
		spin.stop("Cloned successfully");
		return { root: tempDir, commit, tempDir };
	} catch (err) {
		spin.stop("Clone failed");
		throw err;
	}
}

/**
 * `typed` is the source as the user wrote it, `parsed` the same source with
 * its version resolved.
 */
function describeSource(
	typed: ParsedSource,
	parsed: ParsedSource,
	constraint: string | undefined,
	fetched: { root: string; commit: string | null },
): FetchedSource {
	const version = typed.constraint ?? typed.ref;
	const common = {
		key: parsed.manifestKey,
		root: fetched.root,
		ref: parsed.ref,
		commit: fetched.commit,
		constraint,
		...(version !== null ? { version } : {}),
	};
	if (parsed.type === "local-path") {
		return {
			...common,
			rootName: basename(parsed.resolvedPath),
			cloneUrl: null,
		};
	}
	return {
		...common,
		rootName: parsed.repo,
		cloneUrl: parsed.cloneUrl,
		...(parsed.startPath !== undefined ? { startPath: parsed.startPath } : {}),
	};
}

function choiceContext(src: FetchedSource): ChoiceContext {
	return {
		source: src.key,
		rootName: src.rootName,
		...(src.version !== undefined ? { version: src.version } : {}),
	};
}

function sourceJson(src: FetchedSource): SourceJson {
	return {
		source: src.key,
		ref: src.ref,
		commit: src.commit,
		constraint: src.constraint ?? null,
	};
}

/** Shows what the source holds, as the menu would offer it, and installs nothing. */
async function listSource(
	src: FetchedSource,
	selection: Selection,
	ui: Ui,
): Promise<void> {
	const discovery = await discoverSource(src, selection, ui);
	const items = offeredItems(discovery);
	const lines = items.map((item) => optionLine(menuOption(item, src.rootName)));

	if (lines.length > 0) {
		ui.log.message(lines.join("\n"));
	}
	for (const notice of strayNotices(discovery, choiceContext(src))) {
		ui.log.warn(notice);
	}
	const packs = items.filter((item) => item.kind === "pack").length;
	ui.outro(
		`${src.key}@${formatRefLabel(src.ref, src.commit)} holds ${pluralize(packs, "pack")} and ${pluralize(items.length - packs, "skill")}`,
	);
	ui.report(listingBody(sourceJson(src), items, discovery.strays));
}

async function pickItems(
	src: FetchedSource,
	selection: Selection,
	ui: Ui,
): Promise<KeyedItem[]> {
	const discovery = await discoverSource(src, selection, ui);
	const choice = chooseItems(discovery, selection, choiceContext(src));
	for (const notice of choice.strayNotices) {
		ui.warn(notice);
	}

	const picked = await settle(choice.outcome, src, discovery, ui);
	const keyed = keyItems(picked, src.key, src.rootName);
	if (!keyed.ok) {
		return refuse(src, keyed.message, ui);
	}
	return keyed.items;
}

async function discoverSource(
	src: FetchedSource,
	selection: Selection,
	ui: Ui,
): Promise<Discovery> {
	try {
		return await discover(src.root, {
			...(src.startPath !== undefined ? { startPath: src.startPath } : {}),
			forcePack: selection.kind === "pack",
			rootName: src.rootName,
			onWarn: (message) => ui.warn(message),
		});
	} catch (err) {
		if (ENGINE_ERRORS.some((engineError) => err instanceof engineError)) {
			return refuse(src, errorMessage(err), ui);
		}
		throw err;
	}
}

async function settle(
	outcome: ChoiceOutcome,
	src: FetchedSource,
	discovery: Discovery,
	ui: Ui,
): Promise<InstallItem[]> {
	switch (outcome.kind) {
		case "refuse":
			return refuse(src, outcome.message, ui);
		case "install":
			for (const note of outcome.notes) {
				ui.note(note);
			}
			return outcome.items;
		case "menu": {
			if (ui.mode === "machine") {
				const offered = outcome.options.map(({ value }) => value);
				ui.report(listingBody(sourceJson(src), offered, discovery.strays));
				return refuse(src, unansweredMenu(outcome.options), ui, MENU_FLAGS);
			}
			const picked = await promptForItems(outcome.options, ui);
			if (picked.length === 0) {
				ui.cancel("Cancelled — nothing selected");
				throw new ExitSignal(0);
			}
			return picked;
		}
	}
}

function refuse(
	src: FetchedSource,
	message: string,
	ui: Ui,
	flags?: string[],
): never {
	return ui.fail(
		`${src.key}: ${message}`,
		flags !== undefined ? { flags } : {},
	);
}

/**
 * Installs each item as its own manifest entry. Every item is checked before
 * any install is touched; an item that fails or is stopped doesn't stop the
 * others, and the command exits non-zero after the summary if any did.
 */
async function installItems(
	items: KeyedItem[],
	src: FetchedSource,
	policy: ConflictPolicy,
	ui: Ui,
): Promise<void> {
	const projectDir = process.cwd();
	let manifest = await readManifest(projectDir);
	const outcomes: ItemOutcome[] = [];
	const cleared: KeyedItem[] = [];

	for (const keyed of items) {
		const checked = await checkItem(keyed, src, manifest, projectDir, {
			policy,
			ui,
		});
		manifest = checked.manifest;
		if (checked.outcome === null) {
			cleared.push(keyed);
		} else {
			outcomes.push(checked.outcome);
		}
	}

	if (cleared.length > 0) {
		const spin = ui.spinner();
		spin.start("Copying skill files...");
		for (const keyed of cleared) {
			const installed = await installKeyedItem(
				keyed,
				src,
				manifest,
				projectDir,
			);
			manifest = installed.manifest;
			outcomes.push(installed.outcome);
		}
		spin.stop("Copied successfully");
	}

	await writeManifest(projectDir, manifest);
	reportSummary(src, outcomes, ui);
	ui.report(addBody(sourceJson(src), outcomes));

	if (outcomes.some(failsTheRun)) {
		throw new ExitSignal(1);
	}
}

/** A failed item, or one stopped for want of a flag, makes the run exit non-zero. */
function failsTheRun(outcome: ItemOutcome): boolean {
	if (outcome.status === "installed") {
		return false;
	}
	return outcome.status === "failed" || outcome.flags !== undefined;
}

function identify({ item, key }: KeyedItem, rootName: string): ItemIdentity {
	return {
		label: itemLabel(item, rootName),
		key,
		kind: item.kind,
		path: itemPath(item),
	};
}

interface CheckedItem {
	manifest: Manifest;
	/** Why the item won't be copied, or null when it's clear to copy. */
	outcome: ItemOutcome | null;
}

/**
 * Clears an item for copying: the symlink-escape scan, then whatever files are
 * in its way, under the conflict policy. Files recorded under the item's own
 * key count as its own, so a reinstall doesn't trip either check.
 */
async function checkItem(
	keyed: KeyedItem,
	src: FetchedSource,
	manifest: Manifest,
	projectDir: string,
	{ policy, ui }: { policy: ConflictPolicy; ui: Ui },
): Promise<CheckedItem> {
	const identity = identify(keyed, src.rootName);
	const symlinkCheck = await checkEscapingSymlinks(
		join(src.root, identity.path),
		src.root,
	);
	if (!symlinkCheck.ok) {
		return {
			manifest,
			outcome: { ...identity, status: "failed", reason: symlinkCheck.message },
		};
	}

	const conflicts = await clearConflicts(
		{
			incomingFiles: await computeIncomingFiles(keyed.item, src.root),
			manifest,
			key: keyed.key,
			projectDir,
		},
		policy,
		ui,
	);
	return {
		manifest: conflicts.manifest,
		outcome:
			conflicts.stop === null
				? null
				: { ...identity, status: "skipped", ...conflicts.stop },
	};
}

/**
 * Removes the files of an earlier install under the item's key, then copies
 * the item. A failed copy drops the key's entry, since its files are gone. A
 * failed removal keeps the entry, so whatever is left stays tracked.
 */
async function installKeyedItem(
	keyed: KeyedItem,
	src: FetchedSource,
	manifest: Manifest,
	projectDir: string,
): Promise<{ manifest: Manifest; outcome: ItemOutcome }> {
	const { item, key, sourceSubpath } = keyed;
	const identity = identify(keyed, src.rootName);
	const failed = (reason: string): ItemOutcome => ({
		...identity,
		status: "failed",
		reason,
	});

	const existing = manifest[key];
	if (existing) {
		try {
			await nukeManifestFiles(projectDir, existing.files);
		} catch (err) {
			return {
				manifest,
				outcome: failed(
					`couldn't remove its earlier install: ${errorMessage(err)}`,
				),
			};
		}
	}

	try {
		const { copiedFiles, assetCounts } = await copyItem(
			item,
			src.root,
			projectDir,
		);
		const entry = buildManifestEntry({
			ref: src.ref,
			commit: src.commit,
			files: copiedFiles,
			type: item.kind,
			cloneUrl: src.cloneUrl,
			constraint: src.constraint,
			sourceSubpath,
		});
		return {
			manifest: addEntry(manifest, key, entry),
			outcome: {
				...identity,
				status: "installed",
				assetCounts,
				files: copiedFiles,
			},
		};
	} catch (err) {
		const reason = errorMessage(err);
		return {
			manifest: removeEntry(manifest, key),
			outcome: failed(
				existing ? `${reason}; its earlier install was removed` : reason,
			),
		};
	}
}

function reportSummary(
	src: FetchedSource,
	outcomes: ItemOutcome[],
	ui: Ui,
): void {
	const summary = renderAddSummary({
		sourceKey: src.key,
		ref: src.ref,
		commit: src.commit,
		outcomes,
	});
	if (summary.installed.length > 0) {
		ui.log.success(summary.installed.join("\n"));
	}
	if (summary.skipped.length > 0) {
		ui.log.warn(summary.skipped.join("\n"));
	}
	if (summary.failed.length > 0) {
		ui.log.error(summary.failed.join("\n"));
	}
	ui.outro(summary.headline);
}

export const addCommand = new Command("add")
	.description("Install skills and packs from a git repo or local path")
	.argument("<source>", "Git repo (owner/repo[/path]) or local path")
	.option("--skill <names...>", "Install only the named skills")
	.option("--pack", "Install the source path as one pack")
	.option("--all", "Install everything found")
	.option("--list", "Show what the source holds without installing anything")
	.option("--overwrite", "Replace files in the way without asking")
	.addOption(new Option("--plugin", "Renamed to --pack").hideHelp())
	.addOption(jsonOption())
	.action(
		commandAction("add", (ui, source: string, options: AddOptions) =>
			runAdd(source, options, ui),
		),
	);

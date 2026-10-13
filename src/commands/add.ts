import { basename, join } from "node:path";
import { Command, Option } from "commander";
import {
	absorptionNote,
	claimFiles,
	skillsInInstalledPacks,
	takenOverRemoved,
} from "../absorb.js";
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
import { commandAction, globalOption, jsonOption } from "../command-action.js";
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
import type { SourceId } from "../entry-source.js";
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
	commandTitle,
	projectScope,
	type Scope,
	type ScopeName,
} from "../scope.js";
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
	scope: Scope = projectScope(),
): Promise<void> {
	ui.intro(commandTitle("add", scope.name));

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
			await listSource(src, selection.selection, scope.name, ui);
			return;
		}
		const installed = await readManifest(scope.root);
		const items = await pickItems(
			src,
			selection.selection,
			installed,
			scope.name,
			ui,
		);
		const policy = conflictPolicy(options.overwrite === true, ui.mode);
		await installItems(items, src, installed, { policy, scope, ui });
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

function choiceContext(
	src: FetchedSource,
	scope: ScopeName,
	packed?: ReadonlyMap<string, string>,
): ChoiceContext {
	return {
		source: src.key,
		rootName: src.rootName,
		scope,
		...(src.version !== undefined ? { version: src.version } : {}),
		...(packed !== undefined ? { packed } : {}),
	};
}

function sourceIdOfFetched(src: FetchedSource): SourceId {
	return src.cloneUrl === null
		? { kind: "local", root: src.root, exact: true }
		: { kind: "remote", cloneUrl: src.cloneUrl };
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
	scope: ScopeName,
	ui: Ui,
): Promise<void> {
	const discovery = await discoverSource(src, selection, ui);
	const items = offeredItems(discovery);
	const lines = items.map((item) => optionLine(menuOption(item, src.rootName)));

	if (lines.length > 0) {
		ui.log.message(lines.join("\n"));
	}
	for (const notice of strayNotices(discovery, choiceContext(src, scope))) {
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
	manifest: Manifest,
	scope: ScopeName,
	ui: Ui,
): Promise<KeyedItem[]> {
	const discovery = await discoverSource(src, selection, ui);
	const packed = skillsInInstalledPacks(
		discovery,
		manifest,
		sourceIdOfFetched(src),
	);
	const choice = chooseItems(
		discovery,
		selection,
		choiceContext(src, scope, packed),
	);
	for (const notice of choice.strayNotices) {
		ui.warn(notice);
	}

	const picked = await settle(choice.outcome, src, discovery, ui);
	const keyed = await keyItems(picked, src.key, src.rootName, src.root);
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
			for (const note of outcome.notes) {
				ui.note(note);
			}
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
	installed: Manifest,
	{ policy, scope, ui }: InstallContext,
): Promise<void> {
	const installRoot = scope.root;
	let manifest = installed;
	const outcomes: ItemOutcome[] = [];
	const cleared: ClearedItem[] = [];
	const ctx = { policy, ui, source: sourceIdOfFetched(src) };

	for (const keyed of items) {
		const checked = await checkItem(keyed, src, manifest, installRoot, ctx);
		manifest = checked.manifest;
		if (checked.outcome === null) {
			cleared.push({ keyed, absorbs: checked.absorbs });
		} else {
			outcomes.push(checked.outcome);
		}
	}

	const notes: string[] = [];
	if (cleared.length > 0) {
		const spin = ui.spinner();
		spin.start("Copying skill files...");
		for (const item of cleared) {
			const installed = await installKeyedItem(
				item,
				src,
				manifest,
				installRoot,
			);
			manifest = installed.manifest;
			outcomes.push(installed.outcome);
			notes.push(...installed.notes);
		}
		spin.stop("Copied successfully");
	}
	for (const note of notes) {
		ui.note(note);
	}

	await writeManifest(installRoot, manifest);
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

interface InstallContext {
	policy: ConflictPolicy;
	scope: Scope;
	ui: Ui;
}

interface CheckContext {
	policy: ConflictPolicy;
	ui: Ui;
	/** Where the items come from, for what a pack absorbs. */
	source: SourceId;
}

/** An item clear to copy, with the loose skills it takes over. */
interface ClearedItem {
	keyed: KeyedItem;
	absorbs: string[];
}

interface CheckedItem {
	manifest: Manifest;
	/** Why the item won't be copied, or null when it's clear to copy. */
	outcome: ItemOutcome | null;
	/** The loose skills from its own source a pack takes over. */
	absorbs: string[];
}

/**
 * Clears an item for copying: the symlink-escape scan, then whatever files are
 * in its way, under the conflict policy. Files recorded under the item's own
 * key count as its own, so a reinstall doesn't trip either check, and so do a
 * pack's loose skills from its own source, which it absorbs.
 */
async function checkItem(
	keyed: KeyedItem,
	src: FetchedSource,
	manifest: Manifest,
	installRoot: string,
	{ policy, ui, source }: CheckContext,
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
			absorbs: [],
		};
	}

	const incoming = await computeIncomingFiles(keyed.item, src.root);
	const absorbs =
		keyed.item.kind === "pack"
			? claimFiles(incoming, manifest, keyed.key, source).absorbed
			: [];
	const absorbed = new Set(
		absorbs.flatMap((key) => manifest[key]?.files ?? []),
	);
	const conflicts = await clearConflicts(
		{
			incomingFiles: incoming.filter((file) => !absorbed.has(file)),
			manifest,
			key: keyed.key,
			projectDir: installRoot,
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
		absorbs,
	};
}

interface InstalledItem {
	manifest: Manifest;
	outcome: ItemOutcome;
	notes: string[];
}

/**
 * Removes the files of an earlier install under the item's key and of the
 * loose skills it absorbs, then copies the item. Once their files are removed
 * the absorbed entries go, copy or no copy, and a failed copy drops the key's
 * entry too. A failed removal keeps every entry, so whatever is left stays
 * tracked.
 */
async function installKeyedItem(
	{ keyed, absorbs }: ClearedItem,
	src: FetchedSource,
	manifest: Manifest,
	installRoot: string,
): Promise<InstalledItem> {
	const { item, key, sourceSubpath } = keyed;
	const identity = identify(keyed, src.rootName);
	const failed = (reason: string): ItemOutcome => ({
		...identity,
		status: "failed",
		reason,
	});

	const existing = manifest[key];
	const replaced = [key, ...absorbs].flatMap((k) => manifest[k]?.files ?? []);
	if (replaced.length > 0) {
		try {
			await nukeManifestFiles(installRoot, replaced);
		} catch (err) {
			return {
				manifest,
				outcome: failed(
					`couldn't remove its earlier install: ${errorMessage(err)}`,
				),
				notes: [],
			};
		}
	}
	const rest = absorbs.reduce(removeEntry, manifest);

	try {
		const { copiedFiles, assetCounts } = await copyItem(
			item,
			src.root,
			installRoot,
		);
		const entry = buildManifestEntry({
			ref: src.ref,
			commit: src.commit,
			files: copiedFiles,
			type: item.kind,
			cloneUrl: src.cloneUrl,
			constraint: src.constraint,
			sourceSubpath,
			localRoot: src.cloneUrl === null ? src.root : undefined,
		});
		return {
			manifest: addEntry(rest, key, entry),
			outcome: {
				...identity,
				status: "installed",
				assetCounts,
				files: copiedFiles,
			},
			notes: absorbs.map((looseKey) => absorptionNote(key, looseKey)),
		};
	} catch (err) {
		const removed = [
			...(existing ? ["its earlier install was removed"] : []),
			...(absorbs.length > 0 ? [takenOverRemoved(absorbs)] : []),
		];
		return {
			manifest: removeEntry(rest, key),
			outcome: failed([errorMessage(err), ...removed].join("; ")),
			notes: [],
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
	.addOption(globalOption())
	.addOption(jsonOption())
	.action(
		commandAction("add", (ui, scope, source: string, options: AddOptions) =>
			runAdd(source, options, ui, scope),
		),
	);

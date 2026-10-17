import { homedir } from "node:os";
import { basename, join } from "node:path";
import { Command, Option } from "commander";
import {
	absorptionNote,
	claimFiles,
	skillsInInstalledPacks,
	takenOverRemoved,
} from "../absorb.js";
import {
	addedRow,
	addTally,
	holdings,
	leftOut,
	listedRow,
	notedRow,
	pickedDetail,
	sourceHead,
	sourceRow,
	sourceSubject,
} from "../add-render.js";
import {
	type ChoiceContext,
	type ChoiceOutcome,
	chooseItems,
	menuOption,
	offeredItems,
	type Selection,
	type SelectionFlags,
	type SkillNote,
	type StrayNotice,
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
import { checkItemLinks, copyItem } from "../copy-item.js";
import { type CopySource, PathTraversalError } from "../copy-safety.js";
import {
	type Discovery,
	discover,
	PackConflictError,
	StartPathError,
} from "../discover.js";
import { addBody, listingBody, type SourceJson } from "../documents.js";
import {
	installedFrom,
	isSameSource,
	type SourceId,
	sourceIdOf,
} from "../entry-source.js";
import { errorMessage } from "../errors.js";
import { ExitSignal } from "../exit-signal.js";
import { cleanupTempDir, cloneSource } from "../git-clone.js";
import { fetchDefaultBranch, fetchRemoteTags } from "../git-utils.js";
import {
	type InstallItem,
	itemLabel,
	itemPath,
	type KeyedItem,
	keyItems,
	pathLabel,
} from "../install-item.js";
import { installPathMatcher } from "../install-paths.js";
import { promptForItems } from "../item-menu.js";
import {
	addEntry,
	buildManifestEntry,
	type Manifest,
	type ManifestEntry,
	readManifest,
	removeEntry,
	writeManifest,
} from "../manifest.js";
import {
	failure,
	machineOnly,
	plainText,
	type SubjectMessage,
	sentence,
} from "../message.js";
import { nukeManifestFiles } from "../nuke-files.js";
import {
	agntcCommand,
	homeShortened,
	projectScope,
	type Scope,
	type ScopeName,
} from "../scope.js";
import {
	addSourceFor,
	locateSource,
	type ParsedSource,
	parseSource,
	resolveCloneUrl,
} from "../source-parser.js";
import type { ItemIdentity, ItemOutcome } from "../summary.js";
import { adviceItem, remedyItem } from "../terminal/next.js";
import type { Row, RowHead } from "../terminal/types.js";
import { type Block, type BlockTask, interactiveUi, type Ui } from "../ui.js";
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
	/** The newest semver tag a remote add with no version typed resolved to. */
	latestRelease?: string;
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

const COPYING = "copying…";

/**
 * The source's row as the run draws it: the block it hangs in, measured from
 * every item it may hold, its head, what the source holds, and what the
 * choice said of its skills.
 */
interface SourceView {
	block: Block;
	head: RowHead;
	held: string;
	notes: SkillNote[];
}

/** The items picked to install, keyed, and how many the menu offered when there was one. */
interface Picked {
	items: KeyedItem[];
	view: SourceView;
	offered?: number;
}

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
	ui: Ui = interactiveUi(),
	scope: Scope = projectScope(),
): Promise<void> {
	ui.header();

	if (options.plugin) {
		ui.note(sentence("--plugin is now --pack"));
	}
	const selection = selectionFromFlags(options);
	if (!selection.ok) {
		return ui.fail(failure(selection.message));
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
		const picked = await pickItems(
			src,
			selection.selection,
			installed,
			scope,
			ui,
		);
		const policy = conflictPolicy(options.overwrite === true, ui.mode);
		await installItems(picked, src, installed, { policy, scope, ui });
	} catch (err) {
		if (err instanceof ExitSignal) {
			throw err;
		}
		ui.fail(failure(errorMessage(err)));
	} finally {
		if (tempDir) {
			await cleanupTempDir(tempDir).catch(() => {});
		}
	}
}

/** A remote source clones under progress of its own, which clears however the clone ends. */
async function fetchSource(
	parsed: ParsedSource,
	ui: Ui,
): Promise<{ root: string; commit: string | null; tempDir?: string }> {
	if (parsed.type === "local-path") {
		return { root: parsed.resolvedPath, commit: null };
	}

	const cloning = ui.block([]).task({ text: `Cloning ${parsed.manifestKey}…` });
	try {
		const { tempDir, commit } = await cloneSource(parsed);
		return { root: tempDir, commit, tempDir };
	} finally {
		cloning.clear();
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
		...(version === null && parsed.ref !== null
			? { latestRelease: parsed.ref }
			: {}),
	};
}

function choiceContext(
	src: FetchedSource,
	scope: ScopeName,
	packed?: ReadonlyMap<string, string>,
): ChoiceContext {
	return {
		source:
			src.cloneUrl === null ? src.key : addSourceFor(src.key, src.cloneUrl),
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

/** The source's row head: its key, a local one's folder shortened against the home folder. */
function headOf(src: FetchedSource): RowHead {
	const subject =
		src.cloneUrl === null ? homeShortened(src.key, homedir()) : src.key;
	return sourceHead(subject, src);
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
	// The listing's own strays tell machine mode of them, never its warnings.
	if (ui.mode === "interactive") {
		tellStrays(strayNotices(discovery, choiceContext(src, scope)), ui);
	}
	const row = listedRow(
		headOf(src),
		holdings(items),
		items.map((item) => menuOption(item, src.rootName)),
	);
	ui.block([row]).row(row);
	ui.close({ command: "add", counts: {} });
	ui.report(listingBody(sourceJson(src), items, discovery.strays));
}

/**
 * A stray's `--pack` line goes to Next, its words to machine mode alone; a
 * stray with none is a warning.
 */
function tellStrays(notices: readonly StrayNotice[], ui: Ui): void {
	for (const notice of notices) {
		if ("subject" in notice) {
			ui.warn(machineOnly(notice.plain));
			ui.next(adviceItem(notice));
		} else {
			ui.warn(notice);
		}
	}
}

async function pickItems(
	src: FetchedSource,
	selection: Selection,
	manifest: Manifest,
	scope: Scope,
	ui: Ui,
): Promise<Picked> {
	const discovery = await discoverSource(src, selection, ui);
	const packed = await skillsInInstalledPacks(
		discovery,
		manifest,
		sourceIdOfFetched(src),
		scope.root,
	);
	const choice = chooseItems(
		discovery,
		selection,
		choiceContext(src, scope.name, packed),
	);
	tellStrays(choice.strayNotices, ui);

	const { outcome } = choice;
	const view = sourceView(src, outcome, offeredItems(discovery), ui);
	const draw = drawIn(view.block);
	const items = await whileNoted(view, draw, async () => {
		const picked = await settle(outcome, src, discovery, view, ui);
		const keyed = await keyItems(picked, src.key, src.rootName, src.root);
		if (!keyed.ok) {
			tellNotesOnStop(view, draw);
			return refuse(src, keyed.message, ui);
		}
		return keyed.items;
	});
	return {
		items,
		view,
		...(outcome.kind === "menu" ? { offered: outcome.options.length } : {}),
	};
}

/** The source's row as a run that stops before installing leaves it, every skill left out told. */
function unchangedRow({ head, held, notes }: SourceView): Row {
	return notedRow(head, held, notes);
}

/**
 * A run stopping before the source's own row draws it unchanged with the
 * skills the choice left out, so the error under it doesn't take them with
 * it. With none, the error tells it all.
 */
function tellNotesOnStop(view: SourceView, draw: (row: Row) => void): void {
	if (leftOut(view.notes).length > 0) {
		draw(unchangedRow(view));
	}
}

/**
 * Runs a step after the choice, telling its notes should it throw. A step
 * that stopped the run (an `ExitSignal`) has told it already.
 */
async function whileNoted<T>(
	view: SourceView,
	draw: (row: Row) => void,
	step: () => Promise<T>,
): Promise<T> {
	try {
		return await step();
	} catch (err) {
		if (!(err instanceof ExitSignal)) {
			tellNotesOnStop(view, draw);
		}
		throw err;
	}
}

/** Draws a row straight into the block. */
function drawIn(block: Block): (row: Row) => void {
	return (row) => block.row(row);
}

/**
 * The block the source's row hangs in, measured from every item the choice
 * may install and every skill it says something of.
 */
function sourceView(
	src: FetchedSource,
	outcome: ChoiceOutcome,
	offered: readonly InstallItem[],
	ui: Ui,
): SourceView {
	const head = headOf(src);
	const notes = notesOf(outcome);
	const names = choiceItems(outcome).map((item) =>
		itemLabel(item, src.rootName),
	);
	return {
		block: ui.block([sourceSubject(head, names, notes)]),
		head,
		held: holdings(offered),
		notes,
	};
}

/** What a choice may install: its items, or everything its menu offers. */
function choiceItems(outcome: ChoiceOutcome): InstallItem[] {
	switch (outcome.kind) {
		case "install":
			return outcome.items;
		case "menu":
			return outcome.options.map(({ value }) => value);
		case "refuse":
			return [];
	}
}

function notesOf(outcome: ChoiceOutcome): SkillNote[] {
	return outcome.kind === "refuse" ? [] : outcome.notes;
}

/** Machine mode's notes; at a terminal, the source's row tells them. */
function tellNotes(notes: readonly SkillNote[], ui: Ui): void {
	for (const { plain } of notes) {
		ui.note(machineOnly(plain));
	}
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
			onWarn: (message) => ui.warn(sentence(message)),
		});
	} catch (err) {
		if (err instanceof StartPathError) {
			return refuse(src, await startPathMessage(err, src), ui);
		}
		if (ENGINE_ERRORS.some((engineError) => err instanceof engineError)) {
			return refuse(src, errorMessage(err), ui);
		}
		throw err;
	}
}

/**
 * A start path that isn't at the latest release, which an add with no version
 * resolves to, may be on the default branch already: says how to add it from
 * there. Naming that branch takes an `ls-remote`, never a second clone.
 */
async function startPathMessage(
	err: StartPathError,
	src: FetchedSource,
): Promise<string> {
	if (src.latestRelease === undefined || src.cloneUrl === null) {
		return err.message;
	}
	const branch = await fetchDefaultBranch(src.cloneUrl).catch(() => null);
	const fromBranch = locateSource(
		addSourceFor(src.key, src.cloneUrl),
		src.startPath ?? "",
		branch ?? "<branch>",
	);
	return `${err.message} at ${src.latestRelease}, the latest release — to add it from the default branch, use ${fromBranch}, or name a version`;
}

/**
 * The items to install: the choice's, or the menu's pick under the source's
 * row, which stays drawn, unchanged, when nothing is picked.
 */
async function settle(
	outcome: ChoiceOutcome,
	src: FetchedSource,
	discovery: Discovery,
	view: SourceView,
	ui: Ui,
): Promise<InstallItem[]> {
	switch (outcome.kind) {
		case "refuse":
			return refuse(src, outcome.message, ui);
		case "install":
			tellNotes(outcome.notes, ui);
			return outcome.items;
		case "menu": {
			tellNotes(outcome.notes, ui);
			if (ui.mode === "machine") {
				const offered = outcome.options.map(({ value }) => value);
				ui.report(listingBody(sourceJson(src), offered, discovery.strays));
				return refuse(src, unansweredMenu(outcome.options), ui, MENU_FLAGS);
			}
			const asked = sourceRow(view.head, view.held, outcome.notes);
			const picked = await promptForItems(outcome.options, asked, view.block);
			if (picked.length === 0) {
				view.block.row(unchangedRow(view));
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
		failure(`${src.key}: ${message}`),
		flags !== undefined ? { flags } : {},
	);
}

/**
 * Installs each item as its own manifest entry, then draws the source's row.
 * An item that fails or is stopped doesn't stop the others, and the command
 * exits non-zero after the close if any did.
 */
async function installItems(
	picked: Picked,
	src: FetchedSource,
	installed: Manifest,
	context: InstallContext,
): Promise<void> {
	const { items, view, offered } = picked;
	const { ui } = context;
	const row = sourceRowDrawer(view);
	const outcomes = await whileNoted(view, row.draw, () =>
		checkAndCopy(items, src, installed, context, row.copying),
	);
	row.draw(
		addedRow(
			view.head,
			offered === undefined ? view.held : pickedDetail(outcomes, offered),
			inItemOrder(outcomes, items),
			view.notes,
		),
	);
	queueRemedies(outcomes, ui);
	ui.close({ command: "add", counts: addTally(outcomes) });
	ui.report(addBody(sourceJson(src), outcomes));

	if (outcomes.some(failsTheRun)) {
		throw new ExitSignal(1);
	}
}

/** The source's row, drawn once: settling the copying when it spins, else straight into its block. */
function sourceRowDrawer(view: SourceView): {
	copying: () => void;
	draw: (row: Row) => void;
} {
	let task: BlockTask | undefined;
	return {
		copying: () => {
			task = view.block.task({ ...view.head, text: COPYING });
		},
		draw: (row) =>
			task === undefined ? view.block.row(row) : task.settle(row),
	};
}

/**
 * Every item is checked before any install is touched; then those clear to
 * copy are copied, under progress in the source's row, and the manifest
 * written. The outcomes, in the order they came.
 */
async function checkAndCopy(
	items: readonly KeyedItem[],
	src: FetchedSource,
	installed: Manifest,
	{ policy, scope, ui }: InstallContext,
	copying: () => void,
): Promise<ItemOutcome[]> {
	const installRoot = scope.root;
	let manifest = installed;
	const outcomes: ItemOutcome[] = [];
	const cleared: ClearedItem[] = [];
	const ctx = {
		policy,
		ui,
		source: sourceIdOfFetched(src),
		scope: scope.name,
	};

	for (const keyed of items) {
		const checked = await checkItem(keyed, src, manifest, installRoot, ctx);
		manifest = checked.manifest;
		if (checked.outcome === null) {
			cleared.push({ keyed, absorbs: checked.absorbs });
		} else {
			outcomes.push(checked.outcome);
		}
	}

	if (cleared.length > 0) {
		copying();
	}
	const notes: string[] = [];
	for (const item of cleared) {
		const installed = await installKeyedItem(item, src, manifest, installRoot);
		manifest = installed.manifest;
		outcomes.push(installed.outcome);
		notes.push(...installed.notes);
	}
	for (const note of notes) {
		ui.note(sentence(note));
	}

	await writeManifest(installRoot, manifest);
	return outcomes;
}

/** The outcomes in the order of the items they're about, as the menu listed them. */
function inItemOrder(
	outcomes: readonly ItemOutcome[],
	items: readonly KeyedItem[],
): ItemOutcome[] {
	const order = new Map(items.map(({ key }, index) => [key, index]));
	return [...outcomes].sort(
		(a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0),
	);
}

/** What the reader can do about an item that didn't install, under Next. */
function queueRemedies(outcomes: readonly ItemOutcome[], ui: Ui): void {
	for (const outcome of outcomes) {
		const item =
			outcome.status !== "installed" && outcome.message !== undefined
				? remedyItem(outcome.message)
				: null;
		if (item !== null) {
			ui.next(item);
		}
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
	scope: ScopeName;
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
 * Clears an item for copying: its key, the symlink-escape scan, then whatever
 * files are in its way, under the conflict policy. Files recorded under the
 * item's own key count as its own, so a reinstall doesn't trip either check,
 * and so do a pack's loose skills from its own source, which it absorbs.
 */
async function checkItem(
	keyed: KeyedItem,
	src: FetchedSource,
	manifest: Manifest,
	installRoot: string,
	{ policy, ui, source, scope }: CheckContext,
): Promise<CheckedItem> {
	const identity = identify(keyed, src.rootName);
	const refusal =
		keyTaken(keyed, src, manifest, scope) ??
		(await escapingSymlink(keyed, src));
	if (refusal !== null) {
		return {
			manifest,
			outcome: {
				...identity,
				status: "failed",
				reason: plainText(refusal),
				...(typeof refusal === "string" ? {} : { message: refusal }),
			},
			absorbs: [],
		};
	}

	const incoming = keyed.claims.map(({ target }) => target);
	const absorbs =
		keyed.item.kind === "pack"
			? claimFiles(keyed.item.pack, incoming, manifest, keyed.key, source)
					.absorbed
			: [];
	const isAbsorbed = installPathMatcher(
		absorbs.flatMap((key) => manifest[key]?.files ?? []),
	);
	const conflicts = await clearConflicts(
		{
			incomingFiles: incoming.filter((file) => !isAbsorbed(file)),
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
			conflicts.stop === null ? null : { ...identity, ...conflicts.stop },
		absorbs,
	};
}

/**
 * Why the item can't install under its key: the entry already there isn't an
 * earlier install of it, being from another repo (keys don't name the host),
 * another type or another path. Replacing that entry is the user's call:
 * remove it, then add, as its remedy says.
 */
function keyTaken(
	{ key, item }: KeyedItem,
	src: FetchedSource,
	manifest: Manifest,
	scope: ScopeName,
): SubjectMessage | null {
	const holder = manifest[key];
	if (holder === undefined) {
		return null;
	}
	const type = holder.type ?? "skill";
	const from = installedFrom(key, holder);
	const otherRepo = otherRemoteSource(key, holder, src);
	if (
		otherRepo === null &&
		type === item.kind &&
		from === sourcePathOf(item, src)
	) {
		return null;
	}
	const where = otherRepo ?? pathLabel(from, src.rootName);
	const remove = agntcCommand(scope, "remove", [key]);
	const detail = `already installed from ${where}, as a ${type}`;
	const text = `${key} is ${detail}`;
	return {
		subject: key,
		detail,
		text,
		remedy: {
			lead: "To replace it:",
			steps: [{ command: remove }, { words: "then add again" }],
		},
		plain: `${text}; to replace it: ${remove}, then add again`,
	};
}

/** The clone URL a remote entry was installed from, when it isn't `src`'s repo. */
function otherRemoteSource(
	key: string,
	holder: ManifestEntry,
	src: FetchedSource,
): string | null {
	const held = sourceIdOf(key, holder);
	if (held.kind !== "remote" || src.cloneUrl === null) {
		return null;
	}
	return isSameSource(held, sourceIdOfFetched(src)) ? null : held.cloneUrl;
}

/** Where an item comes from, as `installedFrom` gives it for an entry. */
function sourcePathOf(item: InstallItem, src: FetchedSource): string {
	const path = itemPath(item);
	return src.commit === null ? join(src.root, path) : path;
}

async function escapingSymlink(
	{ item }: KeyedItem,
	src: FetchedSource,
): Promise<string | null> {
	const check = await checkItemLinks(item, copySourceOf(src));
	return check.ok ? null : check.message;
}

/** What an item is copied from: a fetched source with no commit is a local folder. */
function copySourceOf(src: FetchedSource): CopySource {
	return { root: src.root, local: src.commit === null };
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
			copySourceOf(src),
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

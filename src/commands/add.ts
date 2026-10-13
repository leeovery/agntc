import { basename, join } from "node:path";
import * as p from "@clack/prompts";
import { Command, Option } from "commander";
import {
	type ChoiceOutcome,
	chooseItems,
	type Selection,
	type SelectionFlags,
	selectionFromFlags,
} from "../choose-items.js";
import { checkFileCollisions } from "../collision-check.js";
import { resolveCollisions } from "../collision-resolve.js";
import { computeIncomingFiles } from "../compute-incoming-files.js";
import { copyItem } from "../copy-item.js";
import { checkEscapingSymlinks, PathTraversalError } from "../copy-safety.js";
import {
	type Discovery,
	discover,
	PackConflictError,
	StartPathError,
} from "../discover.js";
import { errorMessage } from "../errors.js";
import { ExitSignal, withExitSignal } from "../exit-signal.js";
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
import { type ItemOutcome, renderAddSummary } from "../summary.js";
import { checkUnmanagedConflicts } from "../unmanaged-check.js";
import { resolveUnmanagedConflicts } from "../unmanaged-resolve.js";
import { resolveLatestVersion, resolveVersion } from "../version-resolve.js";

export type AddOptions = SelectionFlags;

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
): Promise<void> {
	p.intro("agntc add");

	if (options.plugin) {
		p.log.info("--plugin is now --pack");
	}
	const selection = selectionFromFlags(options);
	if (!selection.ok) {
		p.cancel(selection.message);
		throw new ExitSignal(1);
	}

	let tempDir: string | undefined;

	try {
		const typed = await parseSource(source);
		const { parsed, constraint } = await resolveTagConstraint(typed);
		const fetched = await fetchSource(parsed);
		tempDir = fetched.tempDir;

		const src = describeSource(typed, parsed, constraint, fetched);
		const items = await pickItems(src, selection.selection);
		await installItems(items, src);
	} catch (err) {
		if (err instanceof ExitSignal) {
			throw err;
		}
		p.cancel(errorMessage(err));
		throw new ExitSignal(1);
	} finally {
		if (tempDir) {
			await cleanupTempDir(tempDir).catch(() => {});
		}
	}
}

async function fetchSource(
	parsed: ParsedSource,
): Promise<{ root: string; commit: string | null; tempDir?: string }> {
	if (parsed.type === "local-path") {
		return { root: parsed.resolvedPath, commit: null };
	}

	const spin = p.spinner();
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

async function pickItems(
	src: FetchedSource,
	selection: Selection,
): Promise<KeyedItem[]> {
	const discovery = await discoverSource(src, selection);
	const { strayNotices, outcome } = chooseItems(discovery, selection, {
		source: src.key,
		rootName: src.rootName,
		...(src.version !== undefined ? { version: src.version } : {}),
	});
	for (const notice of strayNotices) {
		p.log.warn(notice);
	}

	const keyed = keyItems(await settle(outcome, src), src.key, src.rootName);
	if (!keyed.ok) {
		return refuse(src, keyed.message);
	}
	return keyed.items;
}

async function discoverSource(
	src: FetchedSource,
	selection: Selection,
): Promise<Discovery> {
	try {
		return await discover(src.root, {
			...(src.startPath !== undefined ? { startPath: src.startPath } : {}),
			forcePack: selection.kind === "pack",
			rootName: src.rootName,
			onWarn: (message) => p.log.warn(message),
		});
	} catch (err) {
		if (ENGINE_ERRORS.some((engineError) => err instanceof engineError)) {
			return refuse(src, errorMessage(err));
		}
		throw err;
	}
}

async function settle(
	outcome: ChoiceOutcome,
	src: FetchedSource,
): Promise<InstallItem[]> {
	switch (outcome.kind) {
		case "refuse":
			return refuse(src, outcome.message);
		case "install":
			for (const note of outcome.notes) {
				p.log.info(note);
			}
			return outcome.items;
		case "menu": {
			const picked = await promptForItems(outcome.options);
			if (picked.length === 0) {
				p.cancel("Cancelled — nothing selected");
				throw new ExitSignal(0);
			}
			return picked;
		}
	}
}

function refuse(src: FetchedSource, message: string): never {
	p.cancel(`${src.key}: ${message}`);
	throw new ExitSignal(1);
}

/**
 * Installs each item as its own manifest entry. Every item is checked before
 * any install is touched; an item that fails or is skipped doesn't stop the
 * others, and the command exits non-zero after the summary if any failed.
 */
async function installItems(
	items: KeyedItem[],
	src: FetchedSource,
): Promise<void> {
	const projectDir = process.cwd();
	let manifest = await readManifest(projectDir);
	const outcomes: ItemOutcome[] = [];
	const cleared: KeyedItem[] = [];

	for (const keyed of items) {
		const checked = await checkItem(keyed, src, manifest, projectDir);
		manifest = checked.manifest;
		if (checked.outcome === null) {
			cleared.push(keyed);
		} else {
			outcomes.push(checked.outcome);
		}
	}

	if (cleared.length > 0) {
		const spin = p.spinner();
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
	reportSummary(src, outcomes);

	if (outcomes.some((outcome) => outcome.status === "failed")) {
		throw new ExitSignal(1);
	}
}

interface CheckedItem {
	manifest: Manifest;
	/** Why the item won't be copied, or null when it's clear to copy. */
	outcome: ItemOutcome | null;
}

/**
 * Clears an item for copying: the symlink-escape scan, then the collision and
 * unmanaged-file checks with their prompts. Files recorded under the item's own
 * key count as its own, so a reinstall doesn't trip either check.
 */
async function checkItem(
	{ item, key }: KeyedItem,
	src: FetchedSource,
	manifest: Manifest,
	projectDir: string,
): Promise<CheckedItem> {
	const label = itemLabel(item, src.rootName);
	const symlinkCheck = await checkEscapingSymlinks(
		join(src.root, itemPath(item)),
		src.root,
	);
	if (!symlinkCheck.ok) {
		return {
			manifest,
			outcome: { label, status: "failed", reason: symlinkCheck.message },
		};
	}

	const conflicts = await runConflictChecks({
		incomingFiles: await computeIncomingFiles(item, src.root),
		manifest,
		pluginKey: key,
		projectDir,
	});
	return {
		manifest: conflicts.updatedManifest,
		outcome: conflicts.proceed
			? null
			: { label, status: "skipped", reason: "conflict not resolved" },
	};
}

/**
 * Removes the files of an earlier install under the item's key, then copies
 * the item. A failed copy drops the key's entry, since its files are gone. A
 * failed removal keeps the entry, so whatever is left stays tracked.
 */
async function installKeyedItem(
	{ item, key, sourceSubpath }: KeyedItem,
	src: FetchedSource,
	manifest: Manifest,
	projectDir: string,
): Promise<{ manifest: Manifest; outcome: ItemOutcome }> {
	const label = itemLabel(item, src.rootName);
	const failed = (reason: string): ItemOutcome => ({
		label,
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
			outcome: { label, status: "installed", kind: item.kind, assetCounts },
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

function reportSummary(src: FetchedSource, outcomes: ItemOutcome[]): void {
	const summary = renderAddSummary({
		sourceKey: src.key,
		ref: src.ref,
		commit: src.commit,
		outcomes,
	});
	if (summary.installed.length > 0) {
		p.log.success(summary.installed.join("\n"));
	}
	if (summary.skipped.length > 0) {
		p.log.warn(summary.skipped.join("\n"));
	}
	if (summary.failed.length > 0) {
		p.log.error(summary.failed.join("\n"));
	}
	p.outro(summary.headline);
}

interface ConflictCheckResult {
	updatedManifest: Manifest;
	proceed: boolean;
}

async function runConflictChecks(opts: {
	incomingFiles: string[];
	manifest: Manifest;
	pluginKey: string;
	projectDir: string;
}): Promise<ConflictCheckResult> {
	const { incomingFiles, pluginKey, projectDir } = opts;
	let currentManifest = opts.manifest;

	const collisions = checkFileCollisions(
		incomingFiles,
		currentManifest,
		pluginKey,
	);
	if (collisions.size > 0) {
		const resolution = await resolveCollisions(
			collisions,
			currentManifest,
			projectDir,
		);
		currentManifest = resolution.updatedManifest;
		if (!resolution.resolved) {
			return { updatedManifest: currentManifest, proceed: false };
		}
	}

	const unmanagedConflicts = await checkUnmanagedConflicts(
		incomingFiles,
		currentManifest,
		projectDir,
	);
	if (unmanagedConflicts.length > 0) {
		const unmanagedResolution = await resolveUnmanagedConflicts([
			{ pluginKey, files: unmanagedConflicts },
		]);
		if (unmanagedResolution.cancelled.length > 0) {
			return { updatedManifest: currentManifest, proceed: false };
		}
	}

	return { updatedManifest: currentManifest, proceed: true };
}

export const addCommand = new Command("add")
	.description("Install skills and packs from a git repo or local path")
	.argument("<source>", "Git repo (owner/repo[/path]) or local path")
	.option("--skill <names...>", "Install only the named skills")
	.option("--pack", "Install the source path as one pack")
	.option("--all", "Install everything found")
	.addOption(new Option("--plugin", "Renamed to --pack").hideHelp())
	.action(
		withExitSignal(async (source: string, options: AddOptions) => {
			await runAdd(source, options);
		}),
	);

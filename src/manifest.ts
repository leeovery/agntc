import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { identifyAssetType, isUnderRoot, targetDir } from "./asset-targets.js";
import { errorMessage, isNodeError } from "./errors.js";
import type { Ui } from "./ui.js";

/** What an entry installed: one skill, or a pack of skills, agents and hooks. */
export type EntryType = "skill" | "pack";

export interface ManifestEntry {
	ref: string | null;
	commit: string | null;
	installedAt: string;
	files: string[];
	type?: EntryType;
	cloneUrl: string | null;
	constraint?: string;
	/**
	 * The item's clone-relative source path, recorded only when the key doesn't
	 * spell it: a skill keyed `owner/repo/<name>` that lives at
	 * `<clone>/skills/<name>`. `update` prefers it over the path derived from
	 * the key ({@link resolveGuardedSourceDir}); entries without it re-copy from the
	 * key-derived path.
	 */
	sourceSubpath?: string;
	/**
	 * The folder a local entry was added from, which its key doesn't mark.
	 * Entries from before it was recorded derive it ({@link localSourceRoot}).
	 */
	localRoot?: string;
}

export type Manifest = Record<string, ManifestEntry>;

/**
 * Fields a call site supplies to {@link buildManifestEntry}: everything in
 * {@link ManifestEntry} except the `installedAt` stamp, which the factory owns.
 * `constraint` stays optional so the factory can omit it from the literal when
 * absent (preserving the byte-identical entry shape).
 */
export type ManifestEntryInput = Omit<ManifestEntry, "installedAt">;

/**
 * Single constructor for {@link ManifestEntry}, owning the `installedAt`
 * `new Date().toISOString()` stamp and the conditional `constraint` /
 * `sourceSubpath` spreads so a shape change is made once. Each optional field is
 * included only when defined; an absent or `undefined` value is omitted from the
 * literal (matching every call site's prior `!= null` behaviour, given both are
 * `string | undefined`). `sourceSubpath` is omitted for the common case
 * (root-child members and standalone entries whose segment === basename),
 * preserving the byte-identical entry shape they have today.
 */
export function buildManifestEntry(fields: ManifestEntryInput): ManifestEntry {
	const { constraint, sourceSubpath, localRoot, ...rest } = fields;
	return {
		...rest,
		installedAt: new Date().toISOString(),
		...(constraint !== undefined && { constraint }),
		...(sourceSubpath !== undefined && { sourceSubpath }),
		...(localRoot !== undefined && { localRoot }),
	};
}

const AGNTC_DIR = ".agntc";
const MANIFEST_FILE = "manifest.json";

export async function readManifest(installRoot: string): Promise<Manifest> {
	const manifestPath = join(installRoot, AGNTC_DIR, MANIFEST_FILE);

	let raw: string;
	try {
		raw = await readFile(manifestPath, "utf-8");
	} catch (err: unknown) {
		if (isNodeError(err) && err.code === "ENOENT") {
			return {};
		}
		throw err;
	}

	const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>;

	for (const entry of Object.values(parsed)) {
		normalizeLegacyEntry(entry);
	}

	return parsed as unknown as Manifest;
}

/**
 * Brings an entry written by an older agntc up to the current shape, in memory
 * only; the next writeManifest persists it. Reads a v1 `plugin` as a pack,
 * backfills `cloneUrl` and a missing `type` (derived solely from local files —
 * never re-clone, re-detect or read config) and drops the per-agent `agents`
 * list.
 */
function normalizeLegacyEntry(entry: Record<string, unknown>): void {
	if (!("cloneUrl" in entry)) {
		entry.cloneUrl = null;
	}
	if (!("type" in entry)) {
		entry.type = deriveTypeFromFiles((entry.files as string[]) ?? []);
	} else if (entry.type === "plugin") {
		entry.type = "pack";
	}
	delete entry.agents;
}

/**
 * Derives a legacy entry's {@link ManifestEntry.type} from its installed local
 * files alone. Total and non-throwing.
 *
 * - Any agents- or hooks-owned file -> `pack`.
 * - Otherwise, more than one distinct skill directory -> `pack`.
 * - Otherwise (<=1 skill dir, no agents/hooks, empty, or unrecognised) ->
 *   `skill`.
 */
export function deriveTypeFromFiles(files: string[]): EntryType {
	const skillDirs = new Set<string>();

	for (const file of files) {
		const assetType = identifyAssetType(file);
		if (assetType === "agents" || assetType === "hooks") {
			return "pack";
		}
		const skillDir = skillDirName(file);
		if (skillDir !== null) {
			skillDirs.add(skillDir);
		}
	}

	return skillDirs.size > 1 ? "pack" : "skill";
}

/**
 * Skill roots that older, multi-agent manifests may record files under. Read
 * only by the type backfill; nothing installs there.
 */
const LEGACY_SKILL_ROOTS = [".agents/skills", ".cursor/skills"];

const SKILL_ROOTS = [targetDir("skills"), ...LEGACY_SKILL_ROOTS];

/**
 * Extracts the `<name>` segment from a skills-owned path of the form
 * `<skills-root>/<name>/...`. Returns null when the path is under no skills
 * root or no segment follows it.
 */
function skillDirName(filePath: string): string | null {
	const root = SKILL_ROOTS.find((r) => isUnderRoot(filePath, r));
	if (root === undefined) {
		return null;
	}
	const remainder = filePath.slice(root.length).replace(/^\/+/, "");
	const [name] = remainder.split("/");
	return name === undefined || name === "" ? null : name;
}

export async function writeManifest(
	installRoot: string,
	manifest: Manifest,
): Promise<void> {
	const dirPath = join(installRoot, AGNTC_DIR);
	await mkdir(dirPath, { recursive: true });

	const content = `${JSON.stringify(manifest, null, 2)}\n`;
	const tempPath = join(dirPath, `.manifest-${randomUUID()}.tmp`);

	await writeFile(tempPath, content, "utf-8");
	await rename(tempPath, join(dirPath, MANIFEST_FILE));
}

export function addEntry(
	manifest: Manifest,
	key: string,
	entry: ManifestEntry,
): Manifest {
	return { ...manifest, [key]: entry };
}

export function removeEntry(manifest: Manifest, key: string): Manifest {
	const { [key]: _, ...rest } = manifest;
	return rest;
}

export async function readManifestOrExit(
	installRoot: string,
	ui: Ui,
): Promise<Manifest> {
	return readManifest(installRoot).catch((err: unknown) =>
		ui.fail(`Failed to read manifest: ${errorMessage(err)}`),
	);
}

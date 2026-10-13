import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { identifyAssetType, targetDir } from "./asset-targets.js";
import { errorMessage, isNodeError } from "./errors.js";
import { ExitSignal } from "./exit-signal.js";
import type { DetectedType } from "./type-detection.js";

export interface ManifestEntry {
	ref: string | null;
	commit: string | null;
	installedAt: string;
	files: string[];
	type?: "skill" | "plugin";
	cloneUrl: string | null;
	constraint?: string;
	/**
	 * The unit's clone-relative source path, recorded ONLY when it diverges from
	 * the manifest-key's basename segment — i.e. a skills-only collection member
	 * keyed `owner/repo/<name>` whose source actually lives at
	 * `<clone>/skills/<name>` (cycle-9 regression fix). `update` re-clones and
	 * reconstructs the source dir from the manifest key via
	 * {@link getSourceDirFromKey}; for a basename-keyed skills-only member that
	 * derives the WRONG dir (`<clone>/<name>`), so derive-before-delete finds no
	 * SKILL.md and aborts. The update source-resolver
	 * (clone-reinstall `cloneAndReinstall`) PREFERS this stored subpath when
	 * present, falling back to the key-derived dir when absent. Identity stays the
	 * basename (key + install destination unchanged); this records only WHERE to
	 * re-copy from. OPTIONAL and backward-compatible: root-child members and all
	 * standalone entries (segment === basename) omit it and round-trip via the key
	 * exactly as before; legacy manifests without it remain valid.
	 */
	sourceSubpath?: string;
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
	const { constraint, sourceSubpath, ...rest } = fields;
	return {
		...rest,
		installedAt: new Date().toISOString(),
		...(constraint !== undefined && { constraint }),
		...(sourceSubpath !== undefined && { sourceSubpath }),
	};
}

/**
 * Maps the resolved {@link DetectedType} of a standalone-installable unit to the
 * value persisted in {@link ManifestEntry.type}. Only the two standalone
 * variants reach the manifest write point (collection/not-agntc are routed or
 * exit earlier), so the param is the narrowed {@link DetectedType} variant —
 * anchoring the mapping to the union so a future structural variant forces a
 * compile error here. The `bare-skill` -> `skill` mapping is the seam: the
 * manifest never stores the literal `bare-skill`.
 */
export function manifestTypeFromDetected(
	t: Extract<DetectedType, { type: "bare-skill" | "plugin" }>,
): "skill" | "plugin" {
	return t.type === "bare-skill" ? "skill" : "plugin";
}

const AGNTC_DIR = ".agntc";
const MANIFEST_FILE = "manifest.json";

export async function readManifest(projectDir: string): Promise<Manifest> {
	const manifestPath = join(projectDir, AGNTC_DIR, MANIFEST_FILE);

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
 * only; the next writeManifest persists it. Backfills `cloneUrl` and `type`
 * (derived solely from local files — anti-drift: never re-clone/re-detect/read
 * config) and drops the per-agent `agents` list.
 */
function normalizeLegacyEntry(entry: Record<string, unknown>): void {
	if (!("cloneUrl" in entry)) {
		entry.cloneUrl = null;
	}
	if (!("type" in entry)) {
		entry.type = deriveTypeFromFiles((entry.files as string[]) ?? []);
	}
	delete entry.agents;
}

/**
 * Derives a legacy entry's {@link ManifestEntry.type} from its installed local
 * files alone (anti-drift: no clone/detect/config read). Total and non-throwing.
 *
 * - Any agents- or hooks-owned file -> `plugin`.
 * - Otherwise, more than one distinct skill directory -> `plugin`.
 * - Otherwise (<=1 skill dir, no agents/hooks, empty, or unrecognised) ->
 *   `skill` (lenient default; single-skill ambiguity resolved to skill).
 */
export function deriveTypeFromFiles(files: string[]): "skill" | "plugin" {
	const skillDirs = new Set<string>();

	for (const file of files) {
		const assetType = identifyAssetType(file);
		if (assetType === "agents" || assetType === "hooks") {
			return "plugin";
		}
		const skillDir = skillDirName(file);
		if (skillDir !== null) {
			skillDirs.add(skillDir);
		}
	}

	return skillDirs.size > 1 ? "plugin" : "skill";
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
	const root = SKILL_ROOTS.find((r) => filePath.startsWith(r));
	if (root === undefined) {
		return null;
	}
	const remainder = filePath.slice(root.length).replace(/^\/+/, "");
	const [name] = remainder.split("/");
	return name === undefined || name === "" ? null : name;
}

export async function writeManifest(
	projectDir: string,
	manifest: Manifest,
): Promise<void> {
	const dirPath = join(projectDir, AGNTC_DIR);
	await mkdir(dirPath, { recursive: true });

	const content = JSON.stringify(manifest, null, 2) + "\n";
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
	projectDir: string,
): Promise<Manifest> {
	return readManifest(projectDir).catch((err: unknown) => {
		p.log.error(`Failed to read manifest: ${errorMessage(err)}`);
		throw new ExitSignal(1);
	});
}

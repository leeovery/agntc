import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
import { identifyFileOwnership } from "./drivers/identify.js";
import { getDriver } from "./drivers/registry.js";
import type { AgentId } from "./drivers/types.js";
import { errorMessage, isNodeError } from "./errors.js";
import { ExitSignal } from "./exit-signal.js";

export interface ManifestEntry {
	ref: string | null;
	commit: string | null;
	installedAt: string;
	agents: AgentId[];
	files: string[];
	type?: "skill" | "plugin";
	cloneUrl: string | null;
	constraint?: string;
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
 * `new Date().toISOString()` stamp and the conditional `constraint` spread so a
 * shape change is made once. `constraint` is included only when defined; an
 * absent or `undefined` value is omitted from the literal (matching every call
 * site's prior `constraint != null` behaviour, given constraints are always
 * `string | undefined`).
 */
export function buildManifestEntry(fields: ManifestEntryInput): ManifestEntry {
	const { constraint, ...rest } = fields;
	return {
		...rest,
		installedAt: new Date().toISOString(),
		...(constraint !== undefined && { constraint }),
	};
}

/**
 * Maps the resolved {@link DetectedType} of a standalone-installable unit to the
 * value persisted in {@link ManifestEntry.type}. Only the two standalone
 * variants reach the manifest write point (collection/not-agntc are routed or
 * exit earlier), so the narrowed param avoids importing DetectedType here. The
 * `bare-skill` -> `skill` mapping is the seam: the manifest never stores the
 * literal `bare-skill`.
 */
export function manifestTypeFromDetected(
	t: "bare-skill" | "plugin",
): "skill" | "plugin" {
	return t === "bare-skill" ? "skill" : "plugin";
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

	// Backfill cloneUrl for manifests written before this field existed.
	for (const entry of Object.values(parsed)) {
		if (!("cloneUrl" in entry)) {
			entry.cloneUrl = null;
		}
	}

	// Backfill type for manifests written before this field existed. Derived
	// solely from local files (anti-drift: never re-clone/re-detect/read config).
	// Mutated in-memory only; persisted on the next writeManifest.
	for (const entry of Object.values(parsed)) {
		if (!("type" in entry)) {
			entry.type = deriveTypeFromFiles((entry.files as string[]) ?? []);
		}
	}

	return parsed as unknown as Manifest;
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
		const ownership = identifyFileOwnership(file);
		if (ownership === null) {
			continue;
		}
		if (ownership.assetType === "agents" || ownership.assetType === "hooks") {
			return "plugin";
		}
		const skillDir = skillDirName(file, ownership.agentId);
		if (skillDir !== null) {
			skillDirs.add(skillDir);
		}
	}

	return skillDirs.size > 1 ? "plugin" : "skill";
}

/**
 * Extracts the `<name>` segment from a skills-owned path of the form
 * `<skills-target>/<name>/...`. Returns null when no segment follows the target.
 */
function skillDirName(filePath: string, agentId: AgentId): string | null {
	const targetDir = getDriver(agentId).getTargetDir("skills");
	if (targetDir === null) {
		return null;
	}
	const remainder = filePath.slice(targetDir.length).replace(/^\/+/, "");
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

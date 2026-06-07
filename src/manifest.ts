import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as p from "@clack/prompts";
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

	return parsed as unknown as Manifest;
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

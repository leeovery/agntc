import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export interface ManifestEntry {
  ref: string | null;
  commit: string | null;
  installedAt: string;
  agents: string[];
  files: string[];
}

export type Manifest = Record<string, ManifestEntry>;

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

  return JSON.parse(raw) as Manifest;
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

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && "code" in err;
}

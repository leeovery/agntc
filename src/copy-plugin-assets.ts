import { cp, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { type AssetType, targetDir } from "./asset-targets.js";
import { rollbackCopiedFiles } from "./copy-rollback.js";
import { readDirEntries } from "./fs-utils.js";

export interface CopyPluginAssetsInput {
	sourceDir: string;
	assetDirs: AssetType[];
	projectDir: string;
}

export type AssetCounts = Partial<Record<AssetType, number>>;

export interface CopyPluginAssetsResult {
	copiedFiles: string[];
	assetCounts: AssetCounts;
}

export async function copyPluginAssets(
	input: CopyPluginAssetsInput,
): Promise<CopyPluginAssetsResult> {
	const { sourceDir, assetDirs, projectDir } = input;
	const copiedFilesSet = new Set<string>();
	const assetCounts: AssetCounts = {};

	try {
		for (const assetDir of assetDirs) {
			const dir = targetDir(assetDir);
			assetCounts[assetDir] = await copyAssetDir(
				join(sourceDir, assetDir),
				join(projectDir, dir),
				dir,
				copiedFilesSet,
			);
		}
	} catch (err) {
		await rollbackCopiedFiles([...copiedFilesSet], projectDir);
		throw err;
	}

	return {
		copiedFiles: [...copiedFilesSet],
		assetCounts,
	};
}

async function copyAssetDir(
	assetSourceDir: string,
	destBaseDir: string,
	relTargetDir: string,
	copiedFilesSet: Set<string>,
): Promise<number> {
	const topEntries = await readDirEntries(assetSourceDir);

	for (const entry of topEntries) {
		const src = join(assetSourceDir, entry.name);
		const dest = join(destBaseDir, entry.name);

		if (entry.isDirectory) {
			await mkdir(dest, { recursive: true });
			await cp(src, dest, { recursive: true });
			await collectDirPaths(
				dest,
				`${relTargetDir}/${entry.name}`,
				copiedFilesSet,
			);
		} else {
			await mkdir(destBaseDir, { recursive: true });
			await cp(src, dest);
			copiedFilesSet.add(`${relTargetDir}/${entry.name}`);
		}
	}

	return topEntries.length;
}

async function collectDirPaths(
	dir: string,
	relPrefix: string,
	set: Set<string>,
): Promise<void> {
	set.add(relPrefix + "/");

	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries) {
		const entryRel = relPrefix + "/" + entry.name;
		if (entry.isDirectory()) {
			await collectDirPaths(join(dir, entry.name), entryRel, set);
		} else {
			set.add(entryRel);
		}
	}
}

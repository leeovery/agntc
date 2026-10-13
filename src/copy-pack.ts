import { cp, mkdir, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type AssetCounts, targetDir } from "./asset-targets.js";
import { copyBareSkill } from "./copy-bare-skill.js";
import { rollbackCopiedFiles } from "./copy-rollback.js";
import type { FoundPack } from "./discover.js";
import { type DirEntry, readDirEntries } from "./fs-utils.js";
import { assertNoLinkInTheWay } from "./install-paths.js";

export interface CopyResult {
	copiedFiles: string[];
	assetCounts: AssetCounts;
}

/**
 * Copies a pack: each of its skills flat into `.claude/skills/<name>`, the
 * `.md` files of its top-level `agents/` into `.claude/agents/`, and its
 * top-level `hooks/` into `.claude/hooks/`. Everything copied so far is rolled
 * back if any copy fails.
 */
export async function copyPack(
	pack: FoundPack,
	root: string,
	installRoot: string,
): Promise<CopyResult> {
	const packDir = join(root, pack.path);
	const copiedFiles: string[] = [];
	const assetCounts: AssetCounts = { skills: pack.skills.length };

	try {
		for (const skill of pack.skills) {
			const result = await copyBareSkill({
				sourceDir: join(root, skill.path),
				projectDir: installRoot,
				skillName: skill.name,
			});
			copiedFiles.push(...result.copiedFiles);
		}
		if (pack.assetDirs.includes("agents")) {
			assetCounts.agents = await copyAgents(
				join(packDir, "agents"),
				installRoot,
				copiedFiles,
			);
		}
		if (pack.assetDirs.includes("hooks")) {
			assetCounts.hooks = await copyHooks(
				join(packDir, "hooks"),
				installRoot,
				copiedFiles,
			);
		}
	} catch (err) {
		await rollbackCopiedFiles(copiedFiles, installRoot);
		throw err;
	}

	return { copiedFiles, assetCounts };
}

/**
 * The `.md` files beneath an `agents/` folder as `/`-joined paths relative to
 * it, sorted. Hidden entries and anything that isn't a regular file or a real
 * directory are skipped, matching what discovery counts as an agent.
 */
export async function listAgentFiles(agentsDir: string): Promise<string[]> {
	const files: string[] = [];
	await collectAgentFiles(agentsDir, "", files);
	return files.sort();
}

export function agentTarget(relPath: string): string {
	return `${targetDir("agents")}/${relPath}`;
}

/** A `hooks/` folder's top-level entries that install: hidden ones are skipped. */
export async function listHookEntries(hooksDir: string): Promise<DirEntry[]> {
	const entries = await readDirEntries(hooksDir);
	return entries.filter((entry) => !isHidden(entry.name));
}

/** The install paths a pack's top-level `hooks/` entries claim. */
export function hookTarget(entry: DirEntry): string {
	const target = `${targetDir("hooks")}/${entry.name}`;
	return entry.isDirectory ? `${target}/` : target;
}

async function collectAgentFiles(
	dir: string,
	prefix: string,
	files: string[],
): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	for (const entry of entries) {
		if (isHidden(entry.name)) {
			continue;
		}
		const relPath = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
		if (entry.isDirectory()) {
			await collectAgentFiles(join(dir, entry.name), relPath, files);
		} else if (entry.isFile() && entry.name.endsWith(".md")) {
			files.push(relPath);
		}
	}
}

async function copyAgents(
	agentsDir: string,
	installRoot: string,
	copiedFiles: string[],
): Promise<number> {
	const agents = await listAgentFiles(agentsDir);
	for (const relPath of agents) {
		const target = agentTarget(relPath);
		const dest = join(installRoot, target);
		await assertNoLinkInTheWay(installRoot, target);
		copiedFiles.push(target);
		await mkdir(dirname(dest), { recursive: true });
		await cp(join(agentsDir, relPath), dest);
	}
	return agents.length;
}

/**
 * Copies every visible entry of `hooks/`, skipping hidden entries at any depth,
 * recording a copied directory and everything inside it.
 */
async function copyHooks(
	hooksDir: string,
	installRoot: string,
	copiedFiles: string[],
): Promise<number> {
	const entries = await listHookEntries(hooksDir);
	for (const entry of entries) {
		const source = join(hooksDir, entry.name);
		const target = hookTarget(entry);
		const dest = join(installRoot, target);
		await assertNoLinkInTheWay(installRoot, target);
		copiedFiles.push(target);
		await mkdir(entry.isDirectory ? dest : dirname(dest), { recursive: true });
		await cp(source, dest, {
			recursive: entry.isDirectory,
			filter: (path) => !isHidden(basename(path)),
		});
		if (entry.isDirectory) {
			await collectDirContents(source, target, copiedFiles);
		}
	}
	return entries.length;
}

async function collectDirContents(
	dir: string,
	relPrefix: string,
	copiedFiles: string[],
): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const entry of entries.filter(({ name }) => !isHidden(name))) {
		const relPath = `${relPrefix}${entry.name}`;
		if (entry.isDirectory()) {
			copiedFiles.push(`${relPath}/`);
			await collectDirContents(
				join(dir, entry.name),
				`${relPath}/`,
				copiedFiles,
			);
		} else {
			copiedFiles.push(relPath);
		}
	}
}

function isHidden(name: string): boolean {
	return name.startsWith(".");
}

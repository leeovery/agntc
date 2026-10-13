import { cp, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
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
	projectDir: string,
): Promise<CopyResult> {
	const packDir = join(root, pack.path);
	const copiedFiles: string[] = [];
	const assetCounts: AssetCounts = { skills: pack.skills.length };

	try {
		for (const skill of pack.skills) {
			const result = await copyBareSkill({
				sourceDir: join(root, skill.path),
				projectDir,
				skillName: skill.name,
			});
			copiedFiles.push(...result.copiedFiles);
		}
		if (pack.assetDirs.includes("agents")) {
			assetCounts.agents = await copyAgents(
				join(packDir, "agents"),
				projectDir,
				copiedFiles,
			);
		}
		if (pack.assetDirs.includes("hooks")) {
			assetCounts.hooks = await copyHooks(
				join(packDir, "hooks"),
				projectDir,
				copiedFiles,
			);
		}
	} catch (err) {
		await rollbackCopiedFiles(copiedFiles, projectDir);
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
		if (entry.name.startsWith(".")) {
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
	projectDir: string,
	copiedFiles: string[],
): Promise<number> {
	const agents = await listAgentFiles(agentsDir);
	for (const relPath of agents) {
		const target = agentTarget(relPath);
		const dest = join(projectDir, target);
		await assertNoLinkInTheWay(projectDir, target);
		copiedFiles.push(target);
		await mkdir(dirname(dest), { recursive: true });
		await cp(join(agentsDir, relPath), dest);
	}
	return agents.length;
}

/**
 * Copies every top-level entry of `hooks/`, recording a copied directory and
 * everything inside it.
 */
async function copyHooks(
	hooksDir: string,
	projectDir: string,
	copiedFiles: string[],
): Promise<number> {
	const entries = await readDirEntries(hooksDir);
	for (const entry of entries) {
		const target = hookTarget(entry);
		const dest = join(projectDir, target);
		await assertNoLinkInTheWay(projectDir, target);
		copiedFiles.push(target);
		await mkdir(entry.isDirectory ? dest : dirname(dest), { recursive: true });
		await cp(join(hooksDir, entry.name), dest, {
			recursive: entry.isDirectory,
		});
		if (entry.isDirectory) {
			await collectDirContents(dest, target, copiedFiles);
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
	for (const entry of entries) {
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

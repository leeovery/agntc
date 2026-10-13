import { copyFile, mkdir, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { type AssetCounts, targetDir } from "./asset-targets.js";
import { copyBareSkill } from "./copy-bare-skill.js";
import { rollbackCopiedFiles } from "./copy-rollback.js";
import {
	type CopySource,
	type CopyStep,
	planCopy,
	writeCopy,
} from "./copy-safety.js";
import type { FoundPack } from "./discover.js";
import type { DirEntry } from "./fs-utils.js";
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
	source: CopySource,
	installRoot: string,
): Promise<CopyResult> {
	const packDir = join(source.root, pack.path);
	const copiedFiles: string[] = [];
	const assetCounts: AssetCounts = { skills: pack.skills.length };

	try {
		for (const skill of pack.skills) {
			const result = await copyBareSkill({
				sourceDir: join(source.root, skill.path),
				source,
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
				source,
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

/**
 * A `hooks/` folder's top-level entries that install: its regular files and
 * real folders, hidden ones aside. A link at the top never installs.
 */
export async function listHookEntries(hooksDir: string): Promise<DirEntry[]> {
	const entries = await readdir(hooksDir, { withFileTypes: true }).catch(
		() => [],
	);
	return entries
		.filter(
			(entry) =>
				!isHidden(entry.name) && (entry.isFile() || entry.isDirectory()),
		)
		.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory() }));
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
		await copyFile(join(agentsDir, relPath), dest);
	}
	return agents.length;
}

/**
 * Copies every entry of `hooks/` that installs, skipping hidden entries at any
 * depth, recording a copied directory and everything inside it.
 */
async function copyHooks(
	hooksDir: string,
	source: CopySource,
	installRoot: string,
	copiedFiles: string[],
): Promise<number> {
	const entries = await listHookEntries(hooksDir);
	for (const entry of entries) {
		const from = join(hooksDir, entry.name);
		const steps: CopyStep[] = entry.isDirectory
			? await planCopy(from, source, isVisible)
			: [{ kind: "file", path: "", from }];
		const target = hookTarget(entry);
		const dest = join(installRoot, target);
		await assertNoLinkInTheWay(installRoot, target);
		copiedFiles.push(...steps.map((step) => installedPath(target, step)));
		await mkdir(dirname(dest), { recursive: true });
		await writeCopy(steps, dest);
	}
	return entries.length;
}

function installedPath(target: string, { kind, path }: CopyStep): string {
	if (path === "") {
		return target;
	}
	return kind === "dir" ? `${target}${path}/` : `${target}${path}`;
}

function isVisible(path: string): boolean {
	return !path.split("/").some(isHidden);
}

function isHidden(name: string): boolean {
	return name.startsWith(".");
}

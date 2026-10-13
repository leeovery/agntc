import {
	access,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkFileCollisions } from "../../src/collision-check.js";
import { computeIncomingFiles } from "../../src/compute-incoming-files.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyItem } from "../../src/copy-item.js";
import {
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../../src/copy-safety.js";
import { discover } from "../../src/discover.js";
import {
	type InstallItem,
	type KeyedItem,
	keyItems,
} from "../../src/install-item.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import {
	addEntry,
	readManifest,
	removeEntry,
	writeManifest,
} from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { executeNukeAndReinstall } from "../../src/nuke-reinstall-pipeline.js";
import { projectScope } from "../../src/scope.js";
import { resolveGuardedSourceDir } from "../../src/source-parser.js";
import { checkUnmanagedConflicts } from "../../src/unmanaged-check.js";

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

async function createFile(base: string, ...segments: string[]): Promise<void> {
	const filePath = join(base, ...segments);
	const dir = filePath.substring(0, filePath.lastIndexOf("/"));
	await mkdir(dir, { recursive: true });
	await writeFile(filePath, `content of ${segments.join("/")}`);
}

async function createJson(
	base: string,
	fileName: string,
	data: unknown,
): Promise<void> {
	await mkdir(base, { recursive: true });
	await writeFile(join(base, fileName), JSON.stringify(data, null, 2));
}

/** Bundles a folder as one pack, as `add --pack` does. */
async function bundle(dir: string, rootName: string): Promise<InstallItem> {
	const { packs } = await discover(dir, { forcePack: true, rootName });
	return { kind: "pack", pack: packs[0]! };
}

async function keyed(
	items: InstallItem[],
	sourceKey: string,
	root: string,
): Promise<KeyedItem[]> {
	const result = await keyItems(items, sourceKey, "repo", root);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.items;
}

/**
 * Reads the manifest file straight off disk, bypassing readManifest's
 * read-time backfill — so a "type" present here was genuinely persisted by a
 * writeManifest, not derived in memory on read.
 */
/** Where update reads an entry from in a re-cloned tree. */
function updateSourceDirOf(
	cloneRoot: string,
	key: string,
	sourceSubpath: string | undefined,
): string {
	const guarded = resolveGuardedSourceDir(cloneRoot, key, sourceSubpath);
	if (!guarded.ok) {
		throw new Error(guarded.message);
	}
	return guarded.sourceDir;
}

async function readRawManifest(projectDir: string): Promise<Manifest> {
	const raw = await readFile(
		join(projectDir, ".agntc", "manifest.json"),
		"utf-8",
	);
	return JSON.parse(raw) as Manifest;
}

describe("integration: core workflows", () => {
	let testDir: string;
	let projectDir: string;
	let sourceDir: string;

	beforeEach(async () => {
		testDir = await mkdtemp(join(tmpdir(), "agntc-integration-"));
		projectDir = join(testDir, "project");
		sourceDir = join(testDir, "source");
		await mkdir(projectDir, { recursive: true });
		await mkdir(sourceDir, { recursive: true });
	});

	afterEach(async () => {
		await rm(testDir, { recursive: true, force: true });
	});

	describe("bare skill add", () => {
		it("computes incoming files, copies skill, and writes manifest with consistent paths", async () => {
			// Set up a bare skill source: agntc.json + SKILL.md + reference
			const skillDir = join(sourceDir, "go-development");
			await createJson(skillDir, "agntc.json", { agents: ["claude"] });
			await createFile(skillDir, "SKILL.md");
			await createFile(skillDir, "references", "guide.md");

			// 1. Compute incoming files (predict what will be copied)
			const incomingFiles = await computeIncomingFiles(
				{
					kind: "skill",
					skill: { name: "go-development", path: "go-development" },
				},
				sourceDir,
			);

			expect(incomingFiles).toEqual([".claude/skills/go-development/"]);

			// 2. Check collisions against empty manifest
			const manifest: Manifest = {};
			const collisions = checkFileCollisions(incomingFiles, manifest);
			expect(collisions.size).toBe(0);

			// 3. Check unmanaged conflicts (nothing on disk yet)
			const unmanagedConflicts = await checkUnmanagedConflicts(
				incomingFiles,
				manifest,
				projectDir,
			);
			expect(unmanagedConflicts).toEqual([]);

			// 4. Copy the bare skill
			const copyResult = await copyBareSkill({
				sourceDir: skillDir,
				cloneRoot: sourceDir,
				projectDir,
			});

			// 5. Verify files on disk
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/go-development/SKILL.md"),
				),
			).toBe(true);
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/go-development/references/guide.md"),
				),
			).toBe(true);
			// agntc.json excluded
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/go-development/agntc.json"),
				),
			).toBe(false);

			// 6. Verify copied files match computed incoming files (path format consistency)
			expect(copyResult.copiedFiles).toEqual(incomingFiles);

			// 7. Write manifest
			const entry: ManifestEntry = {
				ref: null,
				commit: "abc123",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				cloneUrl: null,
			};
			const updatedManifest = addEntry(manifest, "owner/go-development", entry);
			await writeManifest(projectDir, updatedManifest);

			// 8. Read manifest back and verify
			const savedManifest = await readManifest(projectDir);
			expect(savedManifest["owner/go-development"]).toBeDefined();
			expect(savedManifest["owner/go-development"]!.files).toEqual([
				".claude/skills/go-development/",
			]);
		});
	});

	describe("pack add with collision detection", () => {
		it("detects collision when two packs produce overlapping file paths", async () => {
			const packADir = join(sourceDir, "pack-a");
			await createFile(packADir, "skills", "planning", "SKILL.md");

			const packBDir = join(sourceDir, "pack-b");
			await createFile(packBDir, "skills", "planning", "SKILL.md");
			await createFile(packBDir, "skills", "review", "SKILL.md");

			const packA = await bundle(packADir, "pack-a");
			const copyResultA = await copyItem(packA, packADir, projectDir);

			const entryA: ManifestEntry = {
				ref: null,
				commit: "aaa111",
				installedAt: new Date().toISOString(),
				files: copyResultA.copiedFiles,
				type: "pack",
				cloneUrl: null,
			};
			const manifest: Manifest = addEntry({}, "owner/pack-a", entryA);
			await writeManifest(projectDir, manifest);

			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(true);

			const packBIncoming = await computeIncomingFiles(
				await bundle(packBDir, "pack-b"),
				packBDir,
			);

			const collisions = checkFileCollisions(packBIncoming, manifest);
			expect(collisions.get("owner/pack-a")).toEqual([
				".claude/skills/planning/",
			]);
		});
	});

	describe("update migrates a legacy multi-agent entry to .claude", () => {
		async function writeLegacyManifest(
			entries: Record<string, Record<string, unknown>>,
		): Promise<void> {
			await createJson(join(projectDir, ".agntc"), "manifest.json", entries);
		}

		it("nukes the .agents and .cursor copies and reinstalls the skill into .claude only", async () => {
			const skillDir = join(sourceDir, "multi-agent-skill");
			await createJson(skillDir, "agntc.json", {});
			await createFile(skillDir, "SKILL.md");
			await createFile(skillDir, "references", "cheatsheet.md");

			const legacyFiles = [
				".claude/skills/multi-agent-skill/",
				".agents/skills/multi-agent-skill/",
				".cursor/skills/multi-agent-skill/",
			];
			for (const dir of legacyFiles) {
				await createFile(projectDir, dir, "SKILL.md");
			}
			await writeLegacyManifest({
				"owner/multi-agent-skill": {
					ref: null,
					commit: "v1hash",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: legacyFiles,
					cloneUrl: null,
				},
			});

			let manifest = await readManifest(projectDir);
			const entry = manifest["owner/multi-agent-skill"]!;
			expect(entry.type).toBe("skill");

			const result = await executeNukeAndReinstall({
				key: "owner/multi-agent-skill",
				sourceDir: skillDir,
				cloneRoot: skillDir,
				existingEntry: entry,
				installed: { "owner/multi-agent-skill": entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");

			expect(
				await fileExists(join(projectDir, ".agents/skills/multi-agent-skill")),
			).toBe(false);
			expect(
				await fileExists(join(projectDir, ".cursor/skills/multi-agent-skill")),
			).toBe(false);
			expect(
				await fileExists(
					join(
						projectDir,
						".claude/skills/multi-agent-skill/references/cheatsheet.md",
					),
				),
			).toBe(true);
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/multi-agent-skill/agntc.json"),
				),
			).toBe(false);

			manifest = addEntry(manifest, "owner/multi-agent-skill", result.entry);
			await writeManifest(projectDir, manifest);

			const saved = (await readRawManifest(projectDir))[
				"owner/multi-agent-skill"
			]!;
			expect(saved).not.toHaveProperty("agents");
			expect(saved.files).toEqual([".claude/skills/multi-agent-skill/"]);
			expect(saved.commit).toBe("v2hash");
		});

		it("moves a Codex-only v1 plugin entry into .claude as a pack", async () => {
			const pluginDir = join(sourceDir, "codex-plugin");
			await createJson(pluginDir, "agntc.json", { agents: ["codex"] });
			await createFile(pluginDir, "skills", "alpha", "SKILL.md");
			await createFile(pluginDir, "skills", "beta", "SKILL.md");

			const codexFiles = [".agents/skills/alpha/", ".agents/skills/beta/"];
			for (const dir of codexFiles) {
				await createFile(projectDir, dir, "SKILL.md");
			}
			await writeLegacyManifest({
				"owner/codex-plugin": {
					ref: null,
					commit: "v1hash",
					installedAt: "2026-01-15T10:00:00.000Z",
					files: codexFiles,
					cloneUrl: null,
				},
			});

			const entry = (await readManifest(projectDir))["owner/codex-plugin"]!;
			expect(entry.type).toBe("pack");

			const result = await executeNukeAndReinstall({
				key: "owner/codex-plugin",
				sourceDir: pluginDir,
				cloneRoot: pluginDir,
				existingEntry: entry,
				installed: { "owner/codex-plugin": entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");

			expect(await fileExists(join(projectDir, ".agents/skills/alpha"))).toBe(
				false,
			);
			expect(await fileExists(join(projectDir, ".agents/skills/beta"))).toBe(
				false,
			);
			expect(
				await fileExists(join(projectDir, ".claude/skills/alpha/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/skills/beta/SKILL.md")),
			).toBe(true);
			expect(result.entry.files.every((f) => f.startsWith(".claude/"))).toBe(
				true,
			);
			expect(result.entry).not.toHaveProperty("agents");
		});
	});

	describe("remove", () => {
		it("adds a pack then removes it, verifying files deleted and manifest cleaned", async () => {
			const packDir = join(sourceDir, "workflow-pack");
			await createFile(packDir, "skills", "planning", "SKILL.md");
			await createFile(packDir, "skills", "planning", "references", "guide.md");
			await createFile(packDir, "agents", "executor.md");
			await createFile(packDir, "hooks", "pre-commit.sh");

			const copyResult = await copyItem(
				await bundle(packDir, "workflow-pack"),
				packDir,
				projectDir,
			);

			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/planning/references/guide.md"),
				),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/agents/executor.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh")),
			).toBe(true);

			const entry: ManifestEntry = {
				ref: "v1.0",
				commit: "xyz789",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "pack",
				cloneUrl: null,
			};
			let manifest: Manifest = addEntry({}, "owner/workflow-pack", entry);
			await writeManifest(projectDir, manifest);

			const savedManifest = await readManifest(projectDir);
			expect(savedManifest["owner/workflow-pack"]).toBeDefined();

			await nukeManifestFiles(projectDir, entry.files);
			manifest = removeEntry(manifest, "owner/workflow-pack");
			await writeManifest(projectDir, manifest);

			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(false);
			expect(
				await fileExists(join(projectDir, ".claude/agents/executor.md")),
			).toBe(false);
			expect(
				await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh")),
			).toBe(false);

			const finalManifest = await readManifest(projectDir);
			expect(Object.keys(finalManifest)).toHaveLength(0);
		});
	});

	describe("discovery drives what installs and how it is keyed", () => {
		it("(a) installs a root skill under the repo name as a skill", async () => {
			const skillDir = join(sourceDir, "configless-skill");
			await createFile(skillDir, "SKILL.md");
			await createFile(skillDir, "references", "guide.md");

			const discovery = await discover(skillDir, { rootName: "my-skill" });
			expect(discovery.skills).toEqual([{ name: "my-skill", path: "" }]);

			const [root] = await keyed(
				discovery.skills.map((skill) => ({ kind: "skill", skill }) as const),
				"owner/my-skill",
				skillDir,
			);
			const { copiedFiles } = await copyItem(root!.item, skillDir, projectDir);

			expect(root!.key).toBe("owner/my-skill");
			expect(root!.sourceSubpath).toBeUndefined();
			expect(copiedFiles).toEqual([".claude/skills/my-skill/"]);
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/my-skill/references/guide.md"),
				),
			).toBe(true);
		});

		it("(b) reads a v1 multi-asset root without a type as loose skills plus a stray", async () => {
			const repoDir = join(sourceDir, "v1-plugin");
			await createFile(repoDir, "skills", "planning", "SKILL.md");
			await createFile(repoDir, "agents", "executor.md");

			const discovery = await discover(repoDir, { rootName: "v1-plugin" });

			expect(discovery.packs).toEqual([]);
			expect(discovery.skills.map((skill) => skill.path)).toEqual([
				"skills/planning",
			]);
			expect(discovery.strays).toEqual([{ path: "", assetDirs: ["agents"] }]);
		});

		it("(d) keys each skill of a skills/ root by folder name, recording its path", async () => {
			const repoDir = join(sourceDir, "skills-only-repo");
			await createFile(repoDir, "skills", "alpha", "SKILL.md");
			await createFile(repoDir, "skills", "alpha", "references", "g.md");
			await createFile(repoDir, "skills", "beta", "SKILL.md");

			const discovery = await discover(repoDir, {
				rootName: "skills-only-repo",
			});
			const items = await keyed(
				discovery.skills.map((skill) => ({ kind: "skill", skill }) as const),
				"owner/skills-only-repo",
				repoDir,
			);

			expect(
				items.map(({ key, sourceSubpath }) => ({ key, sourceSubpath })),
			).toEqual([
				{ key: "owner/skills-only-repo/alpha", sourceSubpath: "skills/alpha" },
				{ key: "owner/skills-only-repo/beta", sourceSubpath: "skills/beta" },
			]);
			for (const { item } of items) {
				await copyItem(item, repoDir, projectDir);
			}
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/alpha/references/g.md"),
				),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/skills/beta/SKILL.md")),
			).toBe(true);
		});

		it("(e) --pack bundles the same skills/ root as one pack keyed by the repo", async () => {
			const repoDir = join(sourceDir, "skills-only-bundle");
			await createFile(repoDir, "skills", "alpha", "SKILL.md");
			await createFile(repoDir, "skills", "beta", "SKILL.md");

			const [item] = await keyed(
				[await bundle(repoDir, "skills-only-bundle")],
				"owner/skills-only-bundle",
				repoDir,
			);
			const { copiedFiles } = await copyItem(item!.item, repoDir, projectDir);

			expect(item!.key).toBe("owner/skills-only-bundle");
			expect(copiedFiles).toEqual([
				".claude/skills/alpha/",
				".claude/skills/beta/",
			]);
		});

		it("(f) updates a nested skill end-to-end via the stored sourceSubpath", async () => {
			const repoDir = join(sourceDir, "skills-only-updatable");
			await createFile(repoDir, "skills", "alpha", "SKILL.md");
			await createFile(repoDir, "skills", "beta", "SKILL.md");

			const discovery = await discover(repoDir, { rootName: "repo" });
			const [alpha] = await keyed(
				discovery.skills.map((skill) => ({ kind: "skill", skill }) as const),
				"owner/skills-only-updatable",
				repoDir,
			);
			const copyResult = await copyItem(alpha!.item, repoDir, projectDir);
			const key = alpha!.key;
			const entry: ManifestEntry = {
				ref: null,
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "skill",
				cloneUrl: null,
				...(alpha!.sourceSubpath
					? { sourceSubpath: alpha!.sourceSubpath }
					: {}),
			};
			let manifest = addEntry({}, key, entry);
			await writeManifest(projectDir, manifest);
			expect(entry.sourceSubpath).toBe("skills/alpha");

			const reclonedDir = join(sourceDir, "skills-only-updatable-v2");
			await createFile(reclonedDir, "skills", "alpha", "SKILL.md");
			await createFile(reclonedDir, "skills", "alpha", "references", "new.md");
			await createFile(reclonedDir, "skills", "beta", "SKILL.md");

			const result = await executeNukeAndReinstall({
				key,
				sourceDir: updateSourceDirOf(reclonedDir, key, entry.sourceSubpath),
				cloneRoot: reclonedDir,
				existingEntry: entry,
				installed: { [key]: entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/alpha/references/new.md"),
				),
			).toBe(true);
			expect(result.entry.type).toBe("skill");
			expect(result.entry.sourceSubpath).toBe("skills/alpha");

			manifest = addEntry(manifest, key, result.entry);
			await writeManifest(projectDir, manifest);
			const saved = await readRawManifest(projectDir);
			expect(saved[key]!.sourceSubpath).toBe("skills/alpha");
			expect(saved[key]!.commit).toBe("v2hash");
		});

		it("(g) updates a top-level skill via the key-derived path (no sourceSubpath)", async () => {
			const repoDir = join(sourceDir, "member-dirs-repo");
			await createFile(repoDir, "alpha", "SKILL.md");
			await createFile(repoDir, "beta", "SKILL.md");

			const discovery = await discover(repoDir, { rootName: "repo" });
			const [alpha] = await keyed(
				discovery.skills.map((skill) => ({ kind: "skill", skill }) as const),
				"owner/member-dirs-repo",
				repoDir,
			);
			expect(alpha!.sourceSubpath).toBeUndefined();
			const copyResult = await copyItem(alpha!.item, repoDir, projectDir);
			const key = alpha!.key;
			const entry: ManifestEntry = {
				ref: null,
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "skill",
				cloneUrl: null,
			};

			const reclonedDir = join(sourceDir, "member-dirs-repo-v2");
			await createFile(reclonedDir, "alpha", "SKILL.md");
			await createFile(reclonedDir, "alpha", "references", "new.md");

			const updateSourceDir = updateSourceDirOf(reclonedDir, key, undefined);
			expect(updateSourceDir).toBe(join(reclonedDir, "alpha"));

			const result = await executeNukeAndReinstall({
				key,
				sourceDir: updateSourceDir,
				cloneRoot: reclonedDir,
				existingEntry: entry,
				installed: { [key]: entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/alpha/references/new.md"),
				),
			).toBe(true);
			expect("sourceSubpath" in result.entry).toBe(false);
		});
	});

	describe("legacy type backfill round-trip", () => {
		it("(c) derives type on read for a typeless legacy entry and persists it on next write", async () => {
			// A legacy manifest with NO `type` field. The files imply a pack
			// (agents/ ownership), so the backfill must derive `pack`.
			const legacyManifest = {
				"owner/legacy-plugin": {
					ref: "v1.0",
					commit: "legacyhash",
					installedAt: new Date().toISOString(),
					files: [".claude/skills/planning/", ".claude/agents/executor.md"],
					cloneUrl: null,
				},
			};
			await createJson(
				join(projectDir, ".agntc"),
				"manifest.json",
				legacyManifest,
			);

			// Sanity: the on-disk file genuinely has no `type` before any read.
			const before = await readRawManifest(projectDir);
			expect("type" in before["owner/legacy-plugin"]!).toBe(false);

			// readManifest derives the type in memory.
			const read = await readManifest(projectDir);
			expect(read["owner/legacy-plugin"]!.type).toBe("pack");

			// The next write persists the backfilled in-memory manifest.
			await writeManifest(projectDir, read);

			// Read the raw file back and assert the derived type is PERSISTED.
			const after = await readRawManifest(projectDir);
			expect(after["owner/legacy-plugin"]!.type).toBe("pack");
		});

		it("(c2) backfills a single-skill legacy entry to type 'skill' and persists it", async () => {
			const legacyManifest = {
				"owner/legacy-skill": {
					ref: null,
					commit: null,
					installedAt: new Date().toISOString(),
					files: [".claude/skills/go-development/"],
					cloneUrl: null,
				},
			};
			await createJson(
				join(projectDir, ".agntc"),
				"manifest.json",
				legacyManifest,
			);

			// Sanity: the on-disk file genuinely has no `type` before any read.
			const before = await readRawManifest(projectDir);
			expect("type" in before["owner/legacy-skill"]!).toBe(false);

			const read = await readManifest(projectDir);
			expect(read["owner/legacy-skill"]!.type).toBe("skill");

			await writeManifest(projectDir, read);

			const after = await readRawManifest(projectDir);
			expect(after["owner/legacy-skill"]!.type).toBe("skill");
		});
	});

	describe("derive-before-delete abort leaves install intact", () => {
		it("(d) aborts update when a recorded pack's folder now contains declared packs", async () => {
			const packDir = join(sourceDir, "reshaped-pack");
			await createFile(packDir, "skills", "planning", "SKILL.md");
			await createFile(packDir, "agents", "executor.md");

			const copyResult = await copyItem(
				await bundle(packDir, "reshaped-pack"),
				packDir,
				projectDir,
			);

			const entry: ManifestEntry = {
				ref: "v1.0",
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "pack",
				cloneUrl: null,
			};
			const manifest = addEntry({}, "owner/reshaped-pack", entry);
			await writeManifest(projectDir, manifest);

			const reshapedDir = join(sourceDir, "reshaped-pack-v2");
			await createJson(join(reshapedDir, "laravel"), "agntc.json", {
				type: "pack",
			});
			await createFile(
				reshapedDir,
				"laravel",
				"skills",
				"planning",
				"SKILL.md",
			);

			const result = await executeNukeAndReinstall({
				key: "owner/reshaped-pack",
				sourceDir: reshapedDir,
				cloneRoot: reshapedDir,
				existingEntry: entry,
				installed: { "owner/reshaped-pack": entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result).toEqual({
				status: "aborted",
				reason: "its folder now contains packs",
			});

			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/agents/executor.md")),
			).toBe(true);

			const saved = await readManifest(projectDir);
			const savedEntry = saved["owner/reshaped-pack"];
			expect(savedEntry!.commit).toBe("v1hash");
			expect(savedEntry!.type).toBe("pack");
			expect(savedEntry!.files).toEqual(entry.files);
		});

		it("(d2) finds a recorded skill gone, install intact, when its source no longer holds a skill by its name", async () => {
			const skillDir = join(sourceDir, "reshaped-skill");
			await createFile(skillDir, "SKILL.md");

			const copyResult = await copyBareSkill({
				sourceDir: skillDir,
				cloneRoot: sourceDir,
				projectDir,
			});

			const entry: ManifestEntry = {
				ref: "v1.0",
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "skill",
				cloneUrl: null,
			};
			const manifest = addEntry({}, "owner/reshaped-skill", entry);
			await writeManifest(projectDir, manifest);

			// Reshape: no root SKILL.md, and the only skill left has another name.
			const reshapedDir = join(sourceDir, "reshaped-skill-v2");
			await createFile(reshapedDir, "skills", "planning", "SKILL.md");

			const result = await executeNukeAndReinstall({
				key: "owner/reshaped-skill",
				sourceDir: reshapedDir,
				cloneRoot: reshapedDir,
				existingEntry: entry,
				installed: { "owner/reshaped-skill": entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result).toEqual({ status: "gone" });

			// Install intact: removing it is the caller's question to ask.
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/reshaped-skill/SKILL.md"),
				),
			).toBe(true);

			// Manifest entry unchanged.
			const saved = await readManifest(projectDir);
			expect(saved["owner/reshaped-skill"]).toBeDefined();
			expect(saved["owner/reshaped-skill"]!.commit).toBe("v1hash");
			expect(saved["owner/reshaped-skill"]!.files).toEqual(entry.files);
		});

		it("(d3) follows a skill that moved within its source and records where it went", async () => {
			const skillDir = join(sourceDir, "moving-skill");
			await createFile(skillDir, "SKILL.md");
			const copyResult = await copyBareSkill({
				sourceDir: skillDir,
				cloneRoot: sourceDir,
				projectDir,
			});
			const entry: ManifestEntry = {
				ref: "v1.0",
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "skill",
				cloneUrl: null,
			};

			const movedDir = join(sourceDir, "moving-skill-v2");
			await createFile(movedDir, "skills", "moving-skill", "SKILL.md");
			await createFile(movedDir, "skills", "moving-skill", "notes.md");

			const result = await executeNukeAndReinstall({
				key: "owner/moving-skill",
				sourceDir: movedDir,
				cloneRoot: movedDir,
				existingEntry: entry,
				installed: { "owner/moving-skill": entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");
			expect(result.entry.sourceSubpath).toBe("skills/moving-skill");
			expect(result.notes).toEqual([
				"owner/moving-skill moved from moving-skill to skills/moving-skill",
			]);
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/moving-skill/notes.md"),
				),
			).toBe(true);
		});

		it("(d4) aborts a pack update, install intact, when a file agntc didn't install sits at a new skill's target", async () => {
			const packDir = join(sourceDir, "growing-pack");
			await createFile(packDir, "skills", "planning", "SKILL.md");
			await createFile(packDir, "agents", "executor.md");
			const copyResult = await copyItem(
				await bundle(packDir, "growing-pack"),
				packDir,
				projectDir,
			);
			const entry: ManifestEntry = {
				ref: null,
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "pack",
				cloneUrl: null,
			};

			const grownDir = join(sourceDir, "growing-pack-v2");
			await createFile(grownDir, "skills", "planning", "SKILL.md");
			await createFile(grownDir, "skills", "review", "SKILL.md");
			await createFile(grownDir, "agents", "executor.md");
			await createFile(projectDir, ".claude", "skills", "review", "mine.md");

			const result = await executeNukeAndReinstall({
				key: "owner/growing-pack",
				sourceDir: grownDir,
				cloneRoot: grownDir,
				existingEntry: entry,
				installed: { "owner/growing-pack": entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result).toEqual({
				status: "aborted",
				reason:
					"files agntc didn't install are in the way: .claude/skills/review/",
				inTheWay: true,
			});
			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/agents/executor.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/skills/review/mine.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/skills/review/SKILL.md")),
			).toBe(false);
		});

		it("(d5) a pack update takes over a loose skill installed from the same source", async () => {
			const looseDir = join(sourceDir, "repo-v1", "review");
			await createFile(looseDir, "SKILL.md");
			const loose = await copyBareSkill({
				sourceDir: looseDir,
				cloneRoot: sourceDir,
				projectDir,
			});
			const looseEntry: ManifestEntry = {
				ref: null,
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: loose.copiedFiles,
				type: "skill",
				cloneUrl: null,
			};
			const packEntry: ManifestEntry = {
				...looseEntry,
				files: [],
				type: "pack",
			};

			const repoDir = join(sourceDir, "repo-v2");
			await createFile(repoDir, "tools", "skills", "planning", "SKILL.md");
			await createFile(repoDir, "tools", "skills", "review", "SKILL.md");
			await createFile(repoDir, "tools", "skills", "review", "added.md");
			await createFile(repoDir, "tools", "agents", "executor.md");

			const result = await executeNukeAndReinstall({
				key: "owner/repo/tools",
				sourceDir: join(repoDir, "tools"),
				cloneRoot: repoDir,
				existingEntry: packEntry,
				installed: {
					"owner/repo/review": looseEntry,
					"owner/repo/tools": packEntry,
				},
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");
			expect(result.absorbed).toEqual(["owner/repo/review"]);
			expect(result.notes).toEqual([
				"owner/repo/tools now includes review, installed on its own before",
			]);
			expect(result.copiedFiles).toContain(".claude/skills/review/");
			expect(
				await fileExists(join(projectDir, ".claude/skills/review/added.md")),
			).toBe(true);
		});
	});

	describe("copy-safety guard-level pre-flight gates a real copy", () => {
		it("(e) aborts before any copy when a source symlink escapes the clone root", async () => {
			// A secret outside the clone root.
			const secretDir = join(testDir, "secret");
			await createFile(secretDir, "credentials.txt");

			// Source dir with a root SKILL.md and a symlink escaping the clone.
			const skillDir = join(sourceDir, "evil-skill");
			await createFile(skillDir, "SKILL.md");
			await symlink(
				join(secretDir, "credentials.txt"),
				join(skillDir, "leak.txt"),
			);

			// Pre-flight scan is the gate: cloneRoot is the source root.
			let aborted = false;
			let copied = false;
			try {
				await scanForEscapingSymlinks(skillDir, sourceDir);
				// Only reached if the gate passed — would proceed to copy.
				await copyBareSkill({
					sourceDir: skillDir,
					cloneRoot: sourceDir,
					projectDir,
				});
				copied = true;
			} catch (err) {
				if (err instanceof SymlinkEscapeError) {
					aborted = true;
				} else {
					throw err;
				}
			}

			expect(aborted).toBe(true);
			expect(copied).toBe(false);

			// Nothing copied to the destination, no manifest written.
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/evil-skill/SKILL.md"),
				),
			).toBe(false);
			expect(await fileExists(join(projectDir, ".agntc/manifest.json"))).toBe(
				false,
			);
		});

		it("(e2) permits a within-clone symlink so the copy proceeds", async () => {
			// Control case: a symlink that stays inside the clone root passes the
			// gate, proving the pre-flight gates on escape, not on symlink presence.
			const skillDir = join(sourceDir, "safe-skill");
			await createFile(skillDir, "SKILL.md");
			await createFile(skillDir, "real.txt");
			await symlink(join(skillDir, "real.txt"), join(skillDir, "alias.txt"));

			// Should not throw.
			await scanForEscapingSymlinks(skillDir, sourceDir);
		});
	});

	describe("copy-safety pipeline-level blocked outcome aborts update before nuke", () => {
		it("(e3) blocks an update on an escaping symlink, leaving the recorded install intact", async () => {
			// Arrange a genuine recorded install: real files on disk + a real
			// manifest entry for the key (bare-skill install via the real driver).
			const skillDir = join(sourceDir, "guarded-skill");
			await createFile(skillDir, "SKILL.md");
			await createFile(skillDir, "references", "guide.md");

			const copyResult = await copyBareSkill({
				sourceDir: skillDir,
				cloneRoot: sourceDir,
				projectDir,
			});

			const entry: ManifestEntry = {
				ref: "v1.0",
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "skill",
				cloneUrl: null,
			};
			const manifest = addEntry({}, "owner/guarded-skill", entry);
			await writeManifest(projectDir, manifest);

			// A secret outside the clone root the symlink will escape to.
			const secretDir = join(testDir, "secret");
			await createFile(secretDir, "credentials.txt");

			// Stage the re-cloned source tree the pipeline re-copies from. Keep the
			// root SKILL.md so the recorded-skill derive predicate WOULD pass — the
			// block must come from the symlink pre-flight, not a missing SKILL.md.
			const reclonedDir = join(sourceDir, "guarded-skill-v2");
			await createFile(reclonedDir, "SKILL.md");
			await symlink(
				join(secretDir, "credentials.txt"),
				join(reclonedDir, "leak.txt"),
			);

			// Snapshot the on-disk install + the raw manifest entry BEFORE the call.
			const installedSkillMd = join(
				projectDir,
				".claude/skills/guarded-skill/SKILL.md",
			);
			const installedGuide = join(
				projectDir,
				".claude/skills/guarded-skill/references/guide.md",
			);
			expect(await fileExists(installedSkillMd)).toBe(true);
			expect(await fileExists(installedGuide)).toBe(true);
			const entryBefore = (await readRawManifest(projectDir))[
				"owner/guarded-skill"
			];
			expect(entryBefore).toBeDefined();

			// Drive the production update pipeline (the same entry point `update`
			// uses) against the existing recorded install.
			const result = await executeNukeAndReinstall({
				key: "owner/guarded-skill",
				sourceDir: reclonedDir,
				cloneRoot: reclonedDir,
				existingEntry: entry,
				installed: { "owner/guarded-skill": entry },
				scope: projectScope(projectDir),
				newCommit: "v2hash",
			});

			// Blocked by the symlink-escape pre-flight (not aborted, not removed).
			expect(result.status).toBe("blocked");

			// Aborted BEFORE nuke: the existing install is still fully on disk.
			expect(await fileExists(installedSkillMd)).toBe(true);
			expect(await fileExists(installedGuide)).toBe(true);

			// Manifest entry unchanged from the pre-call snapshot (verified raw).
			const entryAfter = (await readRawManifest(projectDir))[
				"owner/guarded-skill"
			];
			expect(entryAfter).toEqual(entryBefore);
		});
	});
});

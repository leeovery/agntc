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
import { copyPluginAssets } from "../../src/copy-plugin-assets.js";
import {
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../../src/copy-safety.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import {
	addEntry,
	manifestTypeFromDetected,
	readManifest,
	removeEntry,
	writeManifest,
} from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { executeNukeAndReinstall } from "../../src/nuke-reinstall-pipeline.js";
import { resolveUpdateSourceDir } from "../../src/source-parser.js";
import { detectType } from "../../src/type-detection.js";
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

/**
 * Reads the manifest file straight off disk, bypassing readManifest's
 * read-time backfill — so a "type" present here was genuinely persisted by a
 * writeManifest, not derived in memory on read.
 */
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
			const incomingFiles = await computeIncomingFiles({
				type: "bare-skill",
				sourceDir: skillDir,
			});

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

	describe("plugin add with collision detection", () => {
		it("detects collision when two plugins produce overlapping file paths", async () => {
			// Plugin A: has skills/planning/ directory
			const pluginADir = join(sourceDir, "plugin-a");
			await createJson(pluginADir, "agntc.json", { agents: ["claude"] });
			await createFile(pluginADir, "skills", "planning", "SKILL.md");

			// Plugin B: also has skills/planning/ directory
			const pluginBDir = join(sourceDir, "plugin-b");
			await createJson(pluginBDir, "agntc.json", { agents: ["claude"] });
			await createFile(pluginBDir, "skills", "planning", "SKILL.md");
			await createFile(pluginBDir, "skills", "review", "SKILL.md");

			// Install plugin A first
			const pluginAIncoming = await computeIncomingFiles({
				type: "plugin",
				sourceDir: pluginADir,
				assetDirs: ["skills"],
			});

			const copyResultA = await copyPluginAssets({
				sourceDir: pluginADir,
				assetDirs: ["skills"],
				projectDir,
			});

			// Write manifest for plugin A
			const entryA: ManifestEntry = {
				ref: null,
				commit: "aaa111",
				installedAt: new Date().toISOString(),
				files: copyResultA.copiedFiles,
				cloneUrl: null,
			};
			const manifest: Manifest = addEntry({}, "owner/plugin-a", entryA);
			await writeManifest(projectDir, manifest);

			// Verify plugin A files exist on disk
			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(true);

			// Now compute incoming files for plugin B
			const pluginBIncoming = await computeIncomingFiles({
				type: "plugin",
				sourceDir: pluginBDir,
				assetDirs: ["skills"],
			});

			// Check collisions -- planning/ should collide with plugin A
			const collisions = checkFileCollisions(pluginBIncoming, manifest);
			expect(collisions.size).toBeGreaterThan(0);
			expect(collisions.has("owner/plugin-a")).toBe(true);

			// The overlapping path should be the planning skill directory
			const overlappingPaths = collisions.get("owner/plugin-a")!;
			expect(overlappingPaths).toContain(".claude/skills/planning/");
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
				projectDir,
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

		it("moves a Codex-only plugin entry into .claude", async () => {
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
			expect(entry.type).toBe("plugin");

			const result = await executeNukeAndReinstall({
				key: "owner/codex-plugin",
				sourceDir: pluginDir,
				cloneRoot: pluginDir,
				existingEntry: entry,
				projectDir,
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
		it("adds a plugin then removes it, verifying files deleted and manifest cleaned", async () => {
			// Set up a plugin with skills and agents
			const pluginDir = join(sourceDir, "workflow-plugin");
			await createJson(pluginDir, "agntc.json", { agents: ["claude"] });
			await createFile(pluginDir, "skills", "planning", "SKILL.md");
			await createFile(
				pluginDir,
				"skills",
				"planning",
				"references",
				"guide.md",
			);
			await createFile(pluginDir, "agents", "executor.md");
			await createFile(pluginDir, "hooks", "pre-commit.sh");

			// Install the plugin
			const copyResult = await copyPluginAssets({
				sourceDir: pluginDir,
				assetDirs: ["skills", "agents", "hooks"],
				projectDir,
			});

			// Verify files exist on disk
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

			// Write manifest
			const entry: ManifestEntry = {
				ref: "v1.0",
				commit: "xyz789",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				cloneUrl: null,
			};
			let manifest: Manifest = addEntry({}, "owner/workflow-plugin", entry);
			await writeManifest(projectDir, manifest);

			// Verify manifest is written
			const savedManifest = await readManifest(projectDir);
			expect(savedManifest["owner/workflow-plugin"]).toBeDefined();

			// Now remove: nuke files and update manifest
			await nukeManifestFiles(projectDir, entry.files);
			manifest = removeEntry(manifest, "owner/workflow-plugin");
			await writeManifest(projectDir, manifest);

			// Verify all plugin files are gone
			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(false);
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/planning/references/guide.md"),
				),
			).toBe(false);
			expect(
				await fileExists(join(projectDir, ".claude/agents/executor.md")),
			).toBe(false);
			expect(
				await fileExists(join(projectDir, ".claude/hooks/pre-commit.sh")),
			).toBe(false);

			// Verify manifest no longer has the entry
			const finalManifest = await readManifest(projectDir);
			expect(finalManifest["owner/workflow-plugin"]).toBeUndefined();
			expect(Object.keys(finalManifest)).toHaveLength(0);
		});
	});

	describe("configless install: detection drives manifest type", () => {
		it("(a) installs a configless bare skill and persists type 'skill'", async () => {
			// Source dir: root SKILL.md, NO agntc.json.
			const skillDir = join(sourceDir, "configless-skill");
			await createFile(skillDir, "SKILL.md");
			await createFile(skillDir, "references", "guide.md");

			// Real type detection drives the manifest `type` write (no agntc.json).
			const detected = await detectType(skillDir, {});
			expect(detected.type).toBe("bare-skill");
			if (detected.type !== "bare-skill") throw new Error("unexpected");

			// Copy via the bare-skill path (real driver routing).
			const copyResult = await copyBareSkill({
				sourceDir: skillDir,
				projectDir,
			});

			expect(
				await fileExists(
					join(projectDir, ".claude/skills/configless-skill/SKILL.md"),
				),
			).toBe(true);

			// Write manifest with the detection-derived type.
			const entry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: manifestTypeFromDetected(detected),
				cloneUrl: null,
			};
			const manifest = addEntry({}, "owner/configless-skill", entry);
			await writeManifest(projectDir, manifest);

			// Read the manifest back from disk and assert the persisted type.
			const saved = await readRawManifest(projectDir);
			expect(saved["owner/configless-skill"]!.type).toBe("skill");
			expect(saved["owner/configless-skill"]!.files).toEqual([
				".claude/skills/configless-skill/",
			]);
		});

		it("(b) installs a configless multi-asset plugin and persists type 'plugin'", async () => {
			// Source dir: skills/ + agents/ asset dirs, NO agntc.json.
			const pluginDir = join(sourceDir, "configless-plugin");
			await createFile(pluginDir, "skills", "planning", "SKILL.md");
			await createFile(pluginDir, "agents", "executor.md");

			// Real type detection classifies multi-asset structure as plugin.
			const detected = await detectType(pluginDir, {});
			expect(detected.type).toBe("plugin");
			if (detected.type !== "plugin") throw new Error("unexpected");
			expect(detected.assetDirs).toEqual(["skills", "agents"]);

			// Copy via the plugin path (real driver routing).
			const copyResult = await copyPluginAssets({
				sourceDir: pluginDir,
				assetDirs: detected.assetDirs,
				projectDir,
			});

			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/agents/executor.md")),
			).toBe(true);

			// Write manifest with the detection-derived type.
			const entry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: manifestTypeFromDetected(detected),
				cloneUrl: null,
			};
			const manifest = addEntry({}, "owner/configless-plugin", entry);
			await writeManifest(projectDir, manifest);

			// Read the manifest back from disk and assert the persisted type.
			const saved = await readRawManifest(projectDir);
			expect(saved["owner/configless-plugin"]!.type).toBe("plugin");
		});

		it("(d) flag-free populated skills-only root enumerates inner skills and installs each as a bare skill", async () => {
			// Source dir: root holds ONLY skills/ with N populated inner skills,
			// NO agntc.json and NO --plugin → Vercel discoverSkills default.
			const repoDir = join(sourceDir, "skills-only-repo");
			await createFile(repoDir, "skills", "alpha", "SKILL.md");
			await createFile(repoDir, "skills", "alpha", "references", "g.md");
			await createFile(repoDir, "skills", "beta", "SKILL.md");

			// Real detection enumerates the inner skills as collection members,
			// carrying the dir-relative segment skills/<name> (NOT empty plugins).
			const detected = await detectType(repoDir, {});
			expect(detected).toEqual({
				type: "collection",
				plugins: ["skills/alpha", "skills/beta"],
			});
			if (detected.type !== "collection") throw new Error("unexpected");

			// Install every enumerated member as a bare skill (real driver routing),
			// keyed owner/repo/<basename> — NOT owner/repo/skills/<name>.
			let manifest: Manifest = {};
			for (const segment of detected.plugins) {
				const memberDir = join(repoDir, segment);
				const memberName = segment.slice(segment.lastIndexOf("/") + 1);

				// Each inner unit resolves to a bare skill on its own root.
				const memberDetected = await detectType(memberDir, {});
				expect(memberDetected.type).toBe("bare-skill");

				const copyResult = await copyBareSkill({
					sourceDir: memberDir,
					projectDir,
				});

				const entry: ManifestEntry = {
					ref: null,
					commit: null,
					installedAt: new Date().toISOString(),
					files: copyResult.copiedFiles,
					type: manifestTypeFromDetected(memberDetected),
					cloneUrl: null,
				};
				manifest = addEntry(
					manifest,
					`owner/skills-only-repo/${memberName}`,
					entry,
				);
			}
			await writeManifest(projectDir, manifest);

			// Each selected skill landed at the bare-skill location.
			expect(
				await fileExists(join(projectDir, ".claude/skills/alpha/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/alpha/references/g.md"),
				),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/skills/beta/SKILL.md")),
			).toBe(true);

			// Manifest keys are the basenames; each persists type 'skill' with the
			// bare-skill file paths.
			const saved = await readRawManifest(projectDir);
			expect(Object.keys(saved).sort()).toEqual([
				"owner/skills-only-repo/alpha",
				"owner/skills-only-repo/beta",
			]);
			expect(saved["owner/skills-only-repo/alpha"]!.type).toBe("skill");
			expect(saved["owner/skills-only-repo/alpha"]!.files).toEqual([
				".claude/skills/alpha/",
			]);
			expect(saved["owner/skills-only-repo/beta"]!.type).toBe("skill");
		});

		it("(e) --plugin / type:plugin bundles the same skills-only root as a single plugin", async () => {
			// Same populated skills-only root, but the install-time override
			// (--plugin) or author override (config type:plugin) bundles the whole
			// skills/ dir as ONE plugin — the enumeration must NOT happen.
			const repoDir = join(sourceDir, "skills-only-bundle");
			await createFile(repoDir, "skills", "alpha", "SKILL.md");
			await createFile(repoDir, "skills", "beta", "SKILL.md");

			// Both overrides resolve identically to a single plugin over skills/.
			const viaFlag = await detectType(repoDir, { forcePlugin: true });
			const viaConfig = await detectType(repoDir, { configType: "plugin" });
			expect(viaFlag).toEqual({ type: "plugin", assetDirs: ["skills"] });
			expect(viaConfig).toEqual({ type: "plugin", assetDirs: ["skills"] });
			if (viaFlag.type !== "plugin") throw new Error("unexpected");

			// Bundle install: each inner skill copies to the bare-skill location as
			// a plugin asset (whole repo = one manifest entry, keyed owner/repo).
			const copyResult = await copyPluginAssets({
				sourceDir: repoDir,
				assetDirs: viaFlag.assetDirs,
				projectDir,
			});

			const entry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: manifestTypeFromDetected(viaFlag),
				cloneUrl: null,
			};
			const manifest = addEntry({}, "owner/skills-only-bundle", entry);
			await writeManifest(projectDir, manifest);

			// Both inner skills installed, but under ONE plugin entry — not split.
			expect(
				await fileExists(join(projectDir, ".claude/skills/alpha/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/skills/beta/SKILL.md")),
			).toBe(true);

			const saved = await readRawManifest(projectDir);
			expect(Object.keys(saved)).toEqual(["owner/skills-only-bundle"]);
			expect(saved["owner/skills-only-bundle"]!.type).toBe("plugin");
		});

		it("(f) updates a flag-free skills-only collection member end-to-end via the stored sourceSubpath", async () => {
			// REGRESSION (cycle-9): a skills-only inner skill installs keyed by
			// basename (owner/repo/<name>) but its source lives at
			// <clone>/skills/<name>. The update source-resolver reconstructs the dir
			// from the basename key -> <clone>/<name> (WRONG), so derive-before-delete
			// finds no SKILL.md and aborts every update. The fix records the divergent
			// segment in entry.sourceSubpath and the resolver prefers it.

			// --- INSTALL: flag-free populated skills-only root, members keyed by
			//     basename, with sourceSubpath capturing the divergent segment.
			const repoDir = join(sourceDir, "skills-only-updatable");
			await createFile(repoDir, "skills", "alpha", "SKILL.md");
			await createFile(repoDir, "skills", "alpha", "references", "g.md");
			await createFile(repoDir, "skills", "beta", "SKILL.md");

			const detected = await detectType(repoDir, {});
			expect(detected).toEqual({
				type: "collection",
				plugins: ["skills/alpha", "skills/beta"],
			});
			if (detected.type !== "collection") throw new Error("unexpected");

			let manifest: Manifest = {};
			for (const segment of detected.plugins) {
				const memberDir = join(repoDir, segment);
				const memberName = segment.slice(segment.lastIndexOf("/") + 1);

				const memberDetected = await detectType(memberDir, {});
				expect(memberDetected.type).toBe("bare-skill");

				const copyResult = await copyBareSkill({
					sourceDir: memberDir,
					projectDir,
				});

				// The member's dir-relative segment (skills/<name>) diverges from the
				// basename key, so it must be recorded as sourceSubpath.
				const entry: ManifestEntry = {
					ref: null,
					commit: "v1hash",
					installedAt: new Date().toISOString(),
					files: copyResult.copiedFiles,
					type: manifestTypeFromDetected(memberDetected),
					cloneUrl: null,
					sourceSubpath: segment,
				};
				manifest = addEntry(
					manifest,
					`owner/skills-only-updatable/${memberName}`,
					entry,
				);
			}
			await writeManifest(projectDir, manifest);

			// Member keyed by basename; sourceSubpath persisted on disk.
			const savedAfterInstall = await readRawManifest(projectDir);
			expect(savedAfterInstall["owner/skills-only-updatable/alpha"]!.type).toBe(
				"skill",
			);
			expect(
				savedAfterInstall["owner/skills-only-updatable/alpha"]!.sourceSubpath,
			).toBe("skills/alpha");

			// --- UPDATE: re-clone has the member at <clone>/skills/alpha and adds a
			//     new file to prove the refresh actually re-copies the right dir.
			const reclonedDir = join(sourceDir, "skills-only-updatable-v2");
			await createFile(reclonedDir, "skills", "alpha", "SKILL.md");
			await createFile(reclonedDir, "skills", "alpha", "references", "g.md");
			await createFile(reclonedDir, "skills", "alpha", "references", "new.md");
			await createFile(reclonedDir, "skills", "beta", "SKILL.md");

			const key = "owner/skills-only-updatable/alpha";
			const entry = manifest[key]!;

			// Resolve the source dir via the SAME function cloneAndReinstall uses —
			// prefer the stored sourceSubpath, fall back to the key-derived dir.
			// Before the fix this falls back to <clone>/alpha (no SKILL.md) and aborts.
			const updateSourceDir = resolveUpdateSourceDir(
				reclonedDir,
				key,
				entry.sourceSubpath,
			);

			const result = await executeNukeAndReinstall({
				key,
				sourceDir: updateSourceDir,
				cloneRoot: reclonedDir,
				existingEntry: entry,
				projectDir,
				newCommit: "v2hash",
			});

			// Update SUCCEEDS (derive-before-delete located SKILL.md at the relocated
			// source), not aborted.
			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");

			// Files refreshed at the bare-skill destination, including the
			// newly-added reference (proves the right subdir was re-copied).
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/alpha/references/new.md"),
				),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/skills/alpha/SKILL.md")),
			).toBe(true);

			// Manifest entry intact: basename identity preserved, sourceSubpath
			// survives the round-trip (so the NEXT update still resolves correctly).
			expect(result.entry.type).toBe("skill");
			expect(result.entry.sourceSubpath).toBe("skills/alpha");
			expect(result.entry.commit).toBe("v2hash");

			manifest = addEntry(manifest, key, result.entry);
			await writeManifest(projectDir, manifest);
			const savedAfterUpdate = await readRawManifest(projectDir);
			expect(savedAfterUpdate[key]!.sourceSubpath).toBe("skills/alpha");
			expect(savedAfterUpdate[key]!.commit).toBe("v2hash");
		});

		it("(g) updates a genuine root-child collection member via the key-derived fallback (no sourceSubpath)", async () => {
			// Regression guard for the new branch: a root-child member whose dir IS
			// its basename (owner/repo/alpha -> <clone>/alpha) carries NO
			// sourceSubpath and must keep resolving via getSourceDirFromKey.
			const repoDir = join(sourceDir, "member-dirs-repo");
			await createFile(repoDir, "alpha", "SKILL.md");
			await createFile(repoDir, "alpha", "references", "g.md");
			await createFile(repoDir, "beta", "SKILL.md");

			const memberDir = join(repoDir, "alpha");
			const memberDetected = await detectType(memberDir, {});
			expect(memberDetected.type).toBe("bare-skill");

			const copyResult = await copyBareSkill({
				sourceDir: memberDir,
				projectDir,
			});

			// Root-child member: segment === basename, so NO sourceSubpath recorded.
			const entry: ManifestEntry = {
				ref: null,
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "skill",
				cloneUrl: null,
			};
			const key = "owner/member-dirs-repo/alpha";
			let manifest = addEntry({}, key, entry);
			await writeManifest(projectDir, manifest);

			expect("sourceSubpath" in entry).toBe(false);

			// Re-clone has the member at the SAME basename-derived dir, plus a new file.
			const reclonedDir = join(sourceDir, "member-dirs-repo-v2");
			await createFile(reclonedDir, "alpha", "SKILL.md");
			await createFile(reclonedDir, "alpha", "references", "g.md");
			await createFile(reclonedDir, "alpha", "references", "new.md");
			await createFile(reclonedDir, "beta", "SKILL.md");

			// Same resolution function as cloneAndReinstall — with no sourceSubpath it
			// MUST fall back to the key-derived dir (<clone>/alpha).
			const updateSourceDir = resolveUpdateSourceDir(
				reclonedDir,
				key,
				entry.sourceSubpath,
			);
			expect(updateSourceDir).toBe(join(reclonedDir, "alpha"));

			const result = await executeNukeAndReinstall({
				key,
				sourceDir: updateSourceDir,
				cloneRoot: reclonedDir,
				existingEntry: entry,
				projectDir,
				newCommit: "v2hash",
			});

			expect(result.status).toBe("success");
			if (result.status !== "success") throw new Error("unexpected");
			expect(
				await fileExists(
					join(projectDir, ".claude/skills/alpha/references/new.md"),
				),
			).toBe(true);
			// No sourceSubpath introduced for a root-child entry.
			expect("sourceSubpath" in result.entry).toBe(false);

			manifest = addEntry(manifest, key, result.entry);
			await writeManifest(projectDir, manifest);
			const saved = await readRawManifest(projectDir);
			expect("sourceSubpath" in saved[key]!).toBe(false);
		});
	});

	describe("legacy type backfill round-trip", () => {
		it("(c) derives type on read for a typeless legacy entry and persists it on next write", async () => {
			// Write a legacy manifest with NO `type` field. The files imply a plugin
			// (agents/ ownership), so the backfill must derive `plugin`.
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
			expect(read["owner/legacy-plugin"]!.type).toBe("plugin");

			// The next write persists the backfilled in-memory manifest.
			await writeManifest(projectDir, read);

			// Read the raw file back and assert the derived type is PERSISTED.
			const after = await readRawManifest(projectDir);
			expect(after["owner/legacy-plugin"]!.type).toBe("plugin");
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
		it("(d) aborts update when a recorded plugin's source no longer has any asset dir", async () => {
			// Install a recorded plugin (skills/ + agents/).
			const pluginDir = join(sourceDir, "reshaped-plugin");
			await createFile(pluginDir, "skills", "planning", "SKILL.md");
			await createFile(pluginDir, "agents", "executor.md");

			const copyResult = await copyPluginAssets({
				sourceDir: pluginDir,
				assetDirs: ["skills", "agents"],
				projectDir,
			});

			const entry: ManifestEntry = {
				ref: "v1.0",
				commit: "v1hash",
				installedAt: new Date().toISOString(),
				files: copyResult.copiedFiles,
				type: "plugin",
				cloneUrl: null,
			};
			const manifest = addEntry({}, "owner/reshaped-plugin", entry);
			await writeManifest(projectDir, manifest);

			// Reshape the source so NO asset dir remains (recorded-plugin predicate
			// fails): a fresh tree with only a root SKILL.md.
			const reshapedDir = join(sourceDir, "reshaped-plugin-v2");
			await createFile(reshapedDir, "SKILL.md");

			const result = await executeNukeAndReinstall({
				key: "owner/reshaped-plugin",
				sourceDir: reshapedDir,
				cloneRoot: reshapedDir,
				existingEntry: entry,
				projectDir,
				newCommit: "v2hash",
			});

			// Aborted, not removed.
			expect(result.status).toBe("aborted");
			if (result.status !== "aborted") throw new Error("unexpected");
			expect(result.recordedType).toBe("plugin");

			// Existing install intact on disk.
			expect(
				await fileExists(join(projectDir, ".claude/skills/planning/SKILL.md")),
			).toBe(true);
			expect(
				await fileExists(join(projectDir, ".claude/agents/executor.md")),
			).toBe(true);

			// Manifest entry unchanged (not removed, original commit/type preserved).
			const saved = await readManifest(projectDir);
			const savedEntry = saved["owner/reshaped-plugin"];
			expect(savedEntry).toBeDefined();
			expect(savedEntry!.commit).toBe("v1hash");
			expect(savedEntry!.type).toBe("plugin");
			expect(savedEntry!.files).toEqual(entry.files);
		});

		it("(d2) aborts update when a recorded skill's source no longer has a root SKILL.md", async () => {
			const skillDir = join(sourceDir, "reshaped-skill");
			await createFile(skillDir, "SKILL.md");

			const copyResult = await copyBareSkill({
				sourceDir: skillDir,
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

			// Reshape: source now has asset dirs and NO root SKILL.md.
			const reshapedDir = join(sourceDir, "reshaped-skill-v2");
			await createFile(reshapedDir, "skills", "planning", "SKILL.md");

			const result = await executeNukeAndReinstall({
				key: "owner/reshaped-skill",
				sourceDir: reshapedDir,
				cloneRoot: reshapedDir,
				existingEntry: entry,
				projectDir,
				newCommit: "v2hash",
			});

			expect(result.status).toBe("aborted");
			if (result.status !== "aborted") throw new Error("unexpected");
			expect(result.recordedType).toBe("skill");

			// Install intact.
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
				await copyBareSkill({ sourceDir: skillDir, projectDir });
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
				projectDir,
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

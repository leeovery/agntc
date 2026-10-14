import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { CANCEL } = vi.hoisted(() => ({ CANCEL: Symbol("cancel") }));

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("../helpers/clack-mock.js");
	return mockClack({
		multiselect: vi.fn(),
		select: vi.fn(),
		confirm: vi.fn(),
		note: vi.fn(),
		isCancel: vi.fn((value: unknown) => value === CANCEL),
	});
});

vi.mock("../../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-clone.js")>()),
	cloneSource: vi.fn(),
}));

vi.mock("../../src/git-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-utils.js")>()),
	lsRemote: vi.fn(),
	fetchRemoteTags: vi.fn(),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/update-check.js")>()),
	resolveGroupTarget: vi.fn(),
}));

import * as p from "@clack/prompts";
import { runAdd } from "../../src/commands/add.js";
import { runUpdate } from "../../src/commands/update.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { cloneSource } from "../../src/git-clone.js";
import { fetchRemoteTags, lsRemote } from "../../src/git-utils.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import type { ParsedSource } from "../../src/source-parser.js";
import { MachineUi } from "../../src/ui.js";
import { resolveGroupTarget } from "../../src/update-check.js";

const mockCloneSource = vi.mocked(cloneSource);
const mockLsRemote = vi.mocked(lsRemote);
const mockFetchRemoteTags = vi.mocked(fetchRemoteTags);
const mockResolveGroupTarget = vi.mocked(resolveGroupTarget);
const mockMultiselect = vi.mocked(p.multiselect);
const mockLog = vi.mocked(p.log);
const mockOutro = vi.mocked(p.outro);

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);
const PACK = { type: "pack" };

let testDir: string;
let projectDir: string;
/** The upstream tree each `owner/repo` clones from. */
let upstream: Map<string, string>;

beforeEach(async () => {
	vi.clearAllMocks();
	testDir = await mkdtemp(join(tmpdir(), "agntc-add-update-"));
	projectDir = join(testDir, "project");
	await mkdir(projectDir, { recursive: true });
	vi.spyOn(process, "cwd").mockReturnValue(projectDir);
	upstream = new Map();

	mockFetchRemoteTags.mockResolvedValue([]);
	mockCloneSource.mockImplementation(async (parsed: ParsedSource) => {
		if (parsed.type === "local-path") {
			throw new Error("local sources aren't cloned");
		}
		const fixture = upstream.get(`${parsed.owner}/${parsed.repo}`);
		if (fixture === undefined) {
			throw new Error(`no upstream for ${parsed.owner}/${parsed.repo}`);
		}
		const tempDir = await mkdtemp(join(testDir, "clone-"));
		await cp(fixture, tempDir, { recursive: true });
		return { tempDir, commit: NEW_SHA };
	});
	mockResolveGroupTarget.mockResolvedValue({
		kind: "head",
		resolvedSha: NEW_SHA,
	});
	mockLsRemote.mockImplementation(
		remoteRefs((ref) => (ref === "HEAD" ? NEW_SHA : undefined)),
	);
});

afterEach(async () => {
	vi.restoreAllMocks();
	await rm(testDir, { recursive: true, force: true });
});

/** Writes an upstream repo; a value that isn't a string is written as JSON. */
async function repo(
	name: string,
	files: Record<string, string | object>,
): Promise<string> {
	const dir = join(testDir, "upstream", name);
	await rm(dir, { recursive: true, force: true });
	await write(dir, files);
	upstream.set(name, dir);
	return dir;
}

async function write(
	base: string,
	files: Record<string, string | object>,
): Promise<void> {
	await mkdir(base, { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		const full = join(base, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(
			full,
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
}

async function installed(path: string): Promise<boolean> {
	return access(join(projectDir, path)).then(
		() => true,
		() => false,
	);
}

async function savedManifest(): Promise<Manifest> {
	const raw = await readFile(
		join(projectDir, ".agntc", "manifest.json"),
		"utf-8",
	);
	return JSON.parse(raw) as Manifest;
}

/** `ls-remote <url> <refs...>`: a line for each ref `shaOf` knows. */
function remoteRefs(shaOf: (ref: string) => string | undefined) {
	return async ([, ...refs]: string[]) => ({
		stdout: refs
			.flatMap((ref) => {
				const sha = shaOf(ref);
				return sha === undefined ? [] : [`${sha}\t${ref}`];
			})
			.join("\n"),
		stderr: "",
	});
}

async function updateError(key?: string): Promise<unknown> {
	return runUpdate(key).catch((error: unknown) => error);
}

function warnings(): string[] {
	return mockLog.warn.mock.calls.map(([message]) => String(message));
}

function menuLabels(): string[] {
	const [options] = mockMultiselect.mock.calls[0]!;
	return options.options.map((option) => String(option.label));
}

describe("integration: add and update", () => {
	it("installs a skill carrying agents/openai.yaml as a skill, SKILL.md and all", async () => {
		await repo("avdlee/swift-skill", {
			"SKILL.md": "---\nname: swift\n---\n",
			"agents/openai.yaml": "model: gpt",
		});

		await runAdd("avdlee/swift-skill");

		expect(await installed(".claude/skills/swift-skill/SKILL.md")).toBe(true);
		expect(
			await installed(".claude/skills/swift-skill/agents/openai.yaml"),
		).toBe(true);
		expect(await installed(".claude/agents")).toBe(false);
		expect(await savedManifest()).toEqual({
			"avdlee/swift-skill": expect.objectContaining({
				type: "skill",
				files: [".claude/skills/swift-skill/"],
				ref: null,
				commit: NEW_SHA,
				cloneUrl: "https://github.com/avdlee/swift-skill.git",
			}),
		});
		expect(warnings()).toEqual([]);
	});

	describe("a v1-style plugin root", () => {
		const V1_PLUGIN = {
			"skills/a/SKILL.md": "",
			"skills/b/SKILL.md": "",
			"agents/reviewer.md": "",
			"hooks/pre.sh": "",
		};

		it("without a type gives loose skills, after a notice naming its agents and hooks", async () => {
			await repo("owner/v1-plugin", V1_PLUGIN);
			mockMultiselect.mockResolvedValue([0, 1]);

			await runAdd("owner/v1-plugin");

			expect(warnings()).toEqual([
				"v1-plugin has agents/ and hooks/ that won't be installed — to install them as a pack: npx agntc add owner/v1-plugin --pack",
			]);
			expect(mockLog.warn.mock.invocationCallOrder[0]).toBeLessThan(
				mockMultiselect.mock.invocationCallOrder[0]!,
			);
			const manifest = await savedManifest();
			expect(Object.keys(manifest)).toEqual([
				"owner/v1-plugin/a",
				"owner/v1-plugin/b",
			]);
			expect(manifest["owner/v1-plugin/a"]).toMatchObject({
				type: "skill",
				sourceSubpath: "skills/a",
				files: [".claude/skills/a/"],
			});
			expect(await installed(".claude/agents")).toBe(false);
			expect(await installed(".claude/hooks")).toBe(false);
		});

		it('with type "plugin" installs as one pack without a menu', async () => {
			await repo("owner/v1-plugin", {
				...V1_PLUGIN,
				"agntc.json": { type: "plugin" },
			});

			await runAdd("owner/v1-plugin");

			expect(mockMultiselect).not.toHaveBeenCalled();
			const manifest = await savedManifest();
			expect(Object.keys(manifest)).toEqual(["owner/v1-plugin"]);
			expect(manifest["owner/v1-plugin"]).toMatchObject({ type: "pack" });
			expect([...manifest["owner/v1-plugin"]!.files].sort()).toEqual([
				".claude/agents/reviewer.md",
				".claude/hooks/pre.sh",
				".claude/skills/a/",
				".claude/skills/b/",
			]);
			expect(await installed(".claude/agents/reviewer.md")).toBe(true);
		});
	});

	it("installs a declared pack named by owner/repo/path, at the latest tag", async () => {
		await repo("leeovery/agentic-skills", {
			"laravel/agntc.json": PACK,
			"laravel/skills/api/SKILL.md": "",
			"laravel/skills/models/SKILL.md": "",
			"laravel/agents/architect.md": "",
			"nuxt/agntc.json": PACK,
			"nuxt/skills/pages/SKILL.md": "",
		});
		mockFetchRemoteTags.mockResolvedValue(["v1.0.0", "v1.2.0"]);

		await runAdd("leeovery/agentic-skills/laravel");

		expect(mockCloneSource).toHaveBeenCalledWith(
			expect.objectContaining({ ref: "v1.2.0", startPath: "laravel" }),
		);
		expect(mockMultiselect).not.toHaveBeenCalled();
		const manifest = await savedManifest();
		expect(manifest).toEqual({
			"leeovery/agentic-skills/laravel": expect.objectContaining({
				type: "pack",
				ref: "v1.2.0",
				constraint: "^1.2.0",
				files: [
					".claude/skills/api/",
					".claude/skills/models/",
					".claude/agents/architect.md",
				],
			}),
		});
		expect(manifest["leeovery/agentic-skills/laravel"]).not.toHaveProperty(
			"sourceSubpath",
		);
		expect(await installed(".claude/skills/pages")).toBe(false);
	});

	describe("a skills/<category>/<skill> repo", () => {
		const CATEGORISED = {
			"skills/frontend/react/SKILL.md":
				"---\ndescription: |\n  React patterns.\n  More detail.\n---\n",
			"skills/frontend/vue/SKILL.md": "",
			"skills/backend/laravel/SKILL.md": "",
		};

		it("offers each skill by path and installs what's picked", async () => {
			await repo("owner/categorised", CATEGORISED);
			mockMultiselect.mockResolvedValue([1]);

			await runAdd("owner/categorised");

			expect(menuLabels()).toEqual([
				"skills/backend/laravel",
				"skills/frontend/react",
				"skills/frontend/vue",
			]);
			expect(mockMultiselect.mock.calls[0]![0].options[1]).toMatchObject({
				hint: "React patterns.",
			});
			expect(await savedManifest()).toEqual({
				"owner/categorised/react": expect.objectContaining({
					type: "skill",
					sourceSubpath: "skills/frontend/react",
					files: [".claude/skills/react/"],
				}),
			});
		});

		it("installs named skills with --skill and no menu", async () => {
			await repo("owner/categorised", CATEGORISED);

			await runAdd("owner/categorised", { skill: ["vue", "laravel"] });

			expect(mockMultiselect).not.toHaveBeenCalled();
			expect(Object.keys(await savedManifest())).toEqual([
				"owner/categorised/vue",
				"owner/categorised/laravel",
			]);
			expect(await installed(".claude/skills/laravel/SKILL.md")).toBe(true);
		});
	});

	it("updates a pack entry so a skill added upstream arrives and a removed one goes", async () => {
		await repo("owner/packs", {
			"laravel/agntc.json": PACK,
			"laravel/skills/api/SKILL.md": "",
			"laravel/skills/models/SKILL.md": "",
		});
		mockCloneSource.mockImplementationOnce(async () => {
			const tempDir = await mkdtemp(join(testDir, "clone-"));
			await cp(upstream.get("owner/packs")!, tempDir, { recursive: true });
			return { tempDir, commit: OLD_SHA };
		});
		await runAdd("owner/packs/laravel");
		expect(await installed(".claude/skills/models/SKILL.md")).toBe(true);

		await repo("owner/packs", {
			"laravel/agntc.json": PACK,
			"laravel/skills/api/SKILL.md": "v2",
			"laravel/skills/jobs/SKILL.md": "",
		});
		await runUpdate();

		expect(await installed(".claude/skills/models")).toBe(false);
		expect(await installed(".claude/skills/jobs/SKILL.md")).toBe(true);
		expect(
			await readFile(join(projectDir, ".claude/skills/api/SKILL.md"), "utf-8"),
		).toBe("v2");
		expect((await savedManifest())["owner/packs/laravel"]).toMatchObject({
			type: "pack",
			commit: NEW_SHA,
			files: [".claude/skills/api/", ".claude/skills/jobs/"],
		});
	});

	describe("loose skills from one repo", () => {
		const SKILLS = ["a", "b", "c"];

		async function publish(text: string): Promise<string> {
			return repo(
				"owner/repo",
				Object.fromEntries(
					SKILLS.map((name) => [`skills/${name}/SKILL.md`, text]),
				),
			);
		}

		async function skillText(name: string): Promise<string> {
			return readFile(
				join(projectDir, `.claude/skills/${name}/SKILL.md`),
				"utf-8",
			);
		}

		beforeEach(async () => {
			const v1 = await publish("v1");
			mockCloneSource.mockImplementationOnce(async () => {
				const tempDir = await mkdtemp(join(testDir, "clone-"));
				await cp(v1, tempDir, { recursive: true });
				return { tempDir, commit: OLD_SHA };
			});
			await runAdd("owner/repo", { skill: SKILLS });
			await publish("v2");
			mockCloneSource.mockClear();
		});

		it("update owner/repo clones the repo once and updates every skill", async () => {
			await runUpdate("owner/repo");

			expect(mockCloneSource).toHaveBeenCalledOnce();
			expect(mockResolveGroupTarget).toHaveBeenCalledOnce();
			for (const name of SKILLS) {
				expect(await skillText(name)).toBe("v2");
			}
			const manifest = await savedManifest();
			expect(
				SKILLS.map((name) => manifest[`owner/repo/${name}`]?.commit),
			).toEqual([NEW_SHA, NEW_SHA, NEW_SHA]);
		});

		it("update with one skill's exact key updates that skill alone, through the single-key path", async () => {
			await runUpdate("owner/repo/b");

			expect(mockResolveGroupTarget).not.toHaveBeenCalled();
			expect(mockCloneSource).toHaveBeenCalledOnce();
			expect(await skillText("b")).toBe("v2");
			expect(await skillText("a")).toBe("v1");
			expect(await skillText("c")).toBe("v1");
			const manifest = await savedManifest();
			expect(
				SKILLS.map((name) => manifest[`owner/repo/${name}`]?.commit),
			).toEqual([OLD_SHA, NEW_SHA, OLD_SHA]);
			expect(mockOutro).toHaveBeenCalledWith(
				expect.stringContaining("owner/repo/b"),
			);
		});
	});

	describe("a v1 manifest", () => {
		async function writeV1Manifest(entries: Record<string, object>) {
			await write(join(projectDir, ".agntc"), { "manifest.json": entries });
		}

		function v1Entry(fields: object) {
			return {
				ref: null,
				commit: OLD_SHA,
				installedAt: "2026-01-15T10:00:00.000Z",
				cloneUrl: null,
				agents: ["claude"],
				...fields,
			};
		}

		it("updates plugin members as packs and skills-only members as skills", async () => {
			await repo("leeovery/agentic-skills", {
				"laravel/skills/api/SKILL.md": "",
				"laravel/skills/queues/SKILL.md": "",
				"laravel/agents/architect.md": "",
				"skills/react/SKILL.md": "v2",
			});
			await write(projectDir, {
				".claude/skills/api/SKILL.md": "",
				".claude/agents/architect.md": "",
				".claude/skills/react/SKILL.md": "v1",
			});
			await writeV1Manifest({
				"leeovery/agentic-skills/laravel": v1Entry({
					type: "plugin",
					files: [".claude/skills/api/", ".claude/agents/architect.md"],
				}),
				"leeovery/agentic-skills/react": v1Entry({
					type: "skill",
					sourceSubpath: "skills/react",
					files: [".claude/skills/react/"],
				}),
			});

			await runUpdate();

			const manifest = await savedManifest();
			expect(manifest["leeovery/agentic-skills/laravel"]).toMatchObject({
				type: "pack",
				commit: NEW_SHA,
				files: [
					".claude/skills/api/",
					".claude/skills/queues/",
					".claude/agents/architect.md",
				],
			});
			expect(manifest["leeovery/agentic-skills/laravel"]).not.toHaveProperty(
				"agents",
			);
			expect(manifest["leeovery/agentic-skills/react"]).toMatchObject({
				type: "skill",
				sourceSubpath: "skills/react",
				commit: NEW_SHA,
			});
			expect(
				await readFile(
					join(projectDir, ".claude/skills/react/SKILL.md"),
					"utf-8",
				),
			).toBe("v2");
		});

		it("reinstalls a skill v1 installed as a plugin as that skill, dropping its stray agent", async () => {
			await repo("avdlee/skills", {
				"swift/SKILL.md": "",
				"swift/agents/openai.yaml": "",
			});
			await write(projectDir, { ".claude/agents/openai.yaml": "" });
			await writeV1Manifest({
				"avdlee/skills/swift": v1Entry({
					type: "plugin",
					files: [".claude/agents/openai.yaml"],
				}),
			});

			await runUpdate();

			expect(await installed(".claude/agents/openai.yaml")).toBe(false);
			expect(await installed(".claude/skills/swift/SKILL.md")).toBe(true);
			expect(await installed(".claude/skills/swift/agents/openai.yaml")).toBe(
				true,
			);
			expect((await savedManifest())["avdlee/skills/swift"]).toMatchObject({
				type: "skill",
				files: [".claude/skills/swift/"],
			});
			expect(mockLog.info).toHaveBeenCalledWith(
				"avdlee/skills/swift is a single skill — reinstalled as a skill",
			);
		});

		describe("with an entry whose path is gone upstream", () => {
			async function arrangeGone(): Promise<void> {
				await repo("owner/repo", { "kept/SKILL.md": "v2" });
				await write(projectDir, {
					".claude/skills/kept/SKILL.md": "v1",
					".claude/skills/gone/SKILL.md": "v1",
				});
				await writeV1Manifest({
					"owner/repo/kept": v1Entry({
						type: "skill",
						files: [".claude/skills/kept/"],
					}),
					"owner/repo/gone": v1Entry({
						type: "plugin",
						files: [".claude/skills/gone/"],
					}),
				});
			}

			async function keptUpdated(): Promise<void> {
				const manifest = await savedManifest();
				expect(manifest["owner/repo/kept"]).toMatchObject({ commit: NEW_SHA });
				expect(
					await readFile(
						join(projectDir, ".claude/skills/kept/SKILL.md"),
						"utf-8",
					),
				).toBe("v2");
			}

			it("asks, and on no leaves it installed while its sibling updates", async () => {
				await arrangeGone();
				vi.mocked(p.confirm).mockResolvedValue(false);

				const err = await runUpdate().catch((error: unknown) => error);

				expect(err).toBeUndefined();
				expect(p.confirm).toHaveBeenCalledExactlyOnceWith({
					message: "owner/repo/gone is gone upstream — remove it?",
					initialValue: false,
				});
				expect(await installed(".claude/skills/gone/SKILL.md")).toBe(true);
				expect(await savedManifest()).toHaveProperty("owner/repo/gone");
				await keptUpdated();
			});

			it("on yes removes its files and its entry while its sibling updates", async () => {
				await arrangeGone();
				vi.mocked(p.confirm).mockResolvedValue(true);

				const err = await runUpdate().catch((error: unknown) => error);

				expect(err).toBeUndefined();
				expect(await installed(".claude/skills/gone")).toBe(false);
				expect(await savedManifest()).not.toHaveProperty("owner/repo/gone");
				await keptUpdated();
			});
		});
	});

	describe("a pack whose skills/ holds support folders, shaped like agentic-workflows", () => {
		const KEY = "leeovery/agentic-workflows";
		const WORKFLOWS = {
			"agntc.json": PACK,
			"README.md": "",
			"package.json": "{}",
			"tests/engine.test.ts": "",
			"agents/workflow-reviewer.md": "",
			"skills/README.md": "",
			"skills/workflow-start/SKILL.md": "",
			"skills/workflow-start/references/routing.md": "",
			"skills/workflow-planning-process/SKILL.md": "",
			"skills/workflow-shared/references/casing-conventions.md": "v1",
			"skills/workflow-shared/references/composing-a-raise.md": "",
			"skills/workflow-gates/.claude-plugin/plugin.json": "{}",
			"skills/workflow-gates/hooks/hooks.json": "{}",
			"skills/workflow-gates/hooks/guard.ts": "",
			"skills/workflow-gates/tests/guard.test.ts": "",
			"skills/workflow-gates/README.md": "",
			"skills/workflow-gates/tsconfig.json": "{}",
		};
		const SKILLS = [
			".claude/skills/workflow-planning-process/SKILL.md",
			".claude/skills/workflow-start/SKILL.md",
			".claude/skills/workflow-start/references/routing.md",
		];
		const SHARED = [
			".claude/skills/workflow-shared/references/casing-conventions.md",
			".claude/skills/workflow-shared/references/composing-a-raise.md",
		];
		const GATES = [
			".claude/skills/workflow-gates/.claude-plugin/plugin.json",
			".claude/skills/workflow-gates/README.md",
			".claude/skills/workflow-gates/hooks/guard.ts",
			".claude/skills/workflow-gates/hooks/hooks.json",
			".claude/skills/workflow-gates/tsconfig.json",
		];

		/** Every file under `.claude/`, install-root-relative and sorted. */
		async function installedFiles(): Promise<string[]> {
			const entries = await readdir(join(projectDir, ".claude"), {
				recursive: true,
				withFileTypes: true,
			});
			return entries
				.filter((entry) => entry.isFile())
				.map((entry) =>
					relative(projectDir, join(entry.parentPath, entry.name)),
				)
				.sort();
		}

		function sharedText(): Promise<string> {
			return readFile(
				join(
					projectDir,
					".claude/skills/workflow-shared/references/casing-conventions.md",
				),
				"utf-8",
			);
		}

		/** Upstream after a release: one support folder changed, one added, one trimmed. */
		async function release(): Promise<void> {
			const { "skills/workflow-gates/tests/guard.test.ts": _, ...kept } =
				WORKFLOWS;
			await repo(KEY, {
				...kept,
				"skills/workflow-shared/references/casing-conventions.md": "v2",
				"skills/workflow-gates-rows/.claude-plugin/plugin.json": "{}",
				"skills/workflow-gates-rows/hooks/hooks.json": "{}",
			});
		}

		async function addAtOldCommit(): Promise<void> {
			const dir = await repo(KEY, WORKFLOWS);
			mockCloneSource.mockImplementationOnce(async () => {
				const tempDir = await mkdtemp(join(testDir, "clone-"));
				await cp(dir, tempDir, { recursive: true });
				return { tempDir, commit: OLD_SHA };
			});
			await runAdd(KEY);
		}

		it("add installs its skills, its agents and every support folder whole, and nothing else", async () => {
			await addAtOldCommit();

			expect(await installedFiles()).toEqual(
				[
					".claude/agents/workflow-reviewer.md",
					...SKILLS,
					...SHARED,
					...GATES,
					".claude/skills/workflow-gates/tests/guard.test.ts",
				].sort(),
			);
			expect(await savedManifest()).toEqual({
				[KEY]: expect.objectContaining({
					type: "pack",
					commit: OLD_SHA,
					files: [
						".claude/skills/workflow-planning-process/",
						".claude/skills/workflow-start/",
						".claude/skills/workflow-gates/",
						".claude/skills/workflow-shared/",
						".claude/agents/workflow-reviewer.md",
					],
				}),
			});
			expect(mockLog.success).toHaveBeenCalledWith(
				"agentic-workflows (pack · 2 skills, 2 folders, 1 agent)",
			);
		});

		it("update replaces each support folder whole, bringing in a new one", async () => {
			await addAtOldCommit();
			await release();

			await runUpdate();

			expect(await installedFiles()).toEqual(
				[
					".claude/agents/workflow-reviewer.md",
					...SKILLS,
					...SHARED,
					...GATES,
					".claude/skills/workflow-gates-rows/.claude-plugin/plugin.json",
					".claude/skills/workflow-gates-rows/hooks/hooks.json",
				].sort(),
			);
			expect(await sharedText()).toBe("v2");
			expect((await savedManifest())[KEY]).toMatchObject({
				type: "pack",
				commit: NEW_SHA,
				files: [
					".claude/skills/workflow-planning-process/",
					".claude/skills/workflow-start/",
					".claude/skills/workflow-gates/",
					".claude/skills/workflow-gates-rows/",
					".claude/skills/workflow-shared/",
					".claude/agents/workflow-reviewer.md",
				],
			});
		});

		it("update keeps the support folders a v1 manifest recorded, folder by folder and file by file", async () => {
			await repo(KEY, WORKFLOWS);
			await write(projectDir, {
				".claude/agents/workflow-reviewer.md": "",
				".claude/skills/workflow-start/SKILL.md": "",
				".claude/skills/workflow-shared/references/casing-conventions.md": "v0",
				".claude/skills/workflow-gates/README.md": "",
			});
			await write(join(projectDir, ".agntc"), {
				"manifest.json": {
					[KEY]: {
						ref: null,
						commit: OLD_SHA,
						installedAt: "2026-01-15T10:00:00.000Z",
						agents: ["claude"],
						type: "plugin",
						files: [
							".claude/skills/workflow-start/",
							".claude/skills/workflow-start/SKILL.md",
							".claude/skills/workflow-shared/",
							".claude/skills/workflow-shared/references/",
							".claude/skills/workflow-shared/references/casing-conventions.md",
							".claude/skills/workflow-gates/",
							".claude/skills/workflow-gates/README.md",
							".claude/agents/workflow-reviewer.md",
						],
					},
				},
			});

			await runUpdate();

			expect(await sharedText()).toBe("v1");
			expect(await installedFiles()).toEqual(
				[
					".claude/agents/workflow-reviewer.md",
					...SKILLS,
					...SHARED,
					...GATES,
					".claude/skills/workflow-gates/tests/guard.test.ts",
				].sort(),
			);
			expect((await savedManifest())[KEY]).toMatchObject({
				type: "pack",
				commit: NEW_SHA,
				files: [
					".claude/skills/workflow-planning-process/",
					".claude/skills/workflow-start/",
					".claude/skills/workflow-gates/",
					".claude/skills/workflow-shared/",
					".claude/agents/workflow-reviewer.md",
				],
			});
		});

		it("update brings back the support folders a 0.5 manifest lost", async () => {
			await repo(KEY, WORKFLOWS);
			await write(projectDir, {
				".claude/agents/workflow-reviewer.md": "",
				".claude/skills/workflow-start/SKILL.md": "",
				".claude/skills/workflow-planning-process/SKILL.md": "",
			});
			await write(join(projectDir, ".agntc"), {
				"manifest.json": {
					[KEY]: {
						ref: null,
						commit: OLD_SHA,
						installedAt: "2026-10-13T10:00:00.000Z",
						type: "pack",
						cloneUrl: "https://github.com/leeovery/agentic-workflows.git",
						files: [
							".claude/skills/workflow-planning-process/",
							".claude/skills/workflow-start/",
							".claude/agents/workflow-reviewer.md",
						],
					},
				},
			});

			await runUpdate();

			expect(await installedFiles()).toEqual(
				[
					".claude/agents/workflow-reviewer.md",
					...SKILLS,
					...SHARED,
					...GATES,
					".claude/skills/workflow-gates/tests/guard.test.ts",
				].sort(),
			);
			expect((await savedManifest())[KEY]).toMatchObject({
				type: "pack",
				commit: NEW_SHA,
				files: [
					".claude/skills/workflow-planning-process/",
					".claude/skills/workflow-start/",
					".claude/skills/workflow-gates/",
					".claude/skills/workflow-shared/",
					".claude/agents/workflow-reviewer.md",
				],
			});
		});

		describe("installed by v1 for Claude and Codex", () => {
			const V1_ENTRY = {
				ref: null,
				commit: OLD_SHA,
				installedAt: "2026-01-15T10:00:00.000Z",
				agents: ["claude", "codex"],
				type: "plugin",
				files: [
					".claude/skills/README.md",
					".claude/skills/workflow-start/",
					".claude/skills/workflow-start/SKILL.md",
					".claude/skills/workflow-shared/",
					".claude/skills/workflow-shared/references/",
					".claude/skills/workflow-shared/references/casing-conventions.md",
					".claude/skills/workflow-gates/",
					".claude/skills/workflow-gates/README.md",
					".agents/skills/workflow-start/",
					".agents/skills/workflow-shared/",
					".claude/agents/workflow-reviewer.md",
				],
			};

			async function installV1(): Promise<void> {
				await write(projectDir, {
					".claude/skills/README.md": "",
					".claude/skills/workflow-start/SKILL.md": "v0",
					".claude/skills/workflow-shared/references/casing-conventions.md":
						"v0",
					".claude/skills/workflow-gates/README.md": "",
					".agents/skills/workflow-start/SKILL.md": "v0",
					".agents/skills/workflow-shared/references/casing-conventions.md":
						"v0",
					".claude/agents/workflow-reviewer.md": "",
				});
				await write(join(projectDir, ".agntc"), {
					"manifest.json": { [KEY]: V1_ENTRY },
				});
			}

			it("update replaces it without stopping: support folders kept, the loose README and Codex copies gone", async () => {
				await repo(KEY, WORKFLOWS);
				await installV1();

				await runUpdate();

				expect(mockLog.error).not.toHaveBeenCalled();
				expect(await sharedText()).toBe("v1");
				expect(await installedFiles()).toEqual(
					[
						".claude/agents/workflow-reviewer.md",
						...SKILLS,
						...SHARED,
						...GATES,
						".claude/skills/workflow-gates/tests/guard.test.ts",
					].sort(),
				);
				expect(await installed(".agents/skills/workflow-start")).toBe(false);
				expect(await installed(".agents/skills/workflow-shared")).toBe(false);
				expect((await savedManifest())[KEY]).toMatchObject({
					type: "pack",
					commit: NEW_SHA,
				});
			});

			describe("when upstream moved a support folder out of skills/", () => {
				const MESSAGE =
					"leeovery/agentic-workflows can't be updated: it would remove workflow-shared, which is still in the source but would no longer be installed. The existing install is unchanged. To update it anyway: npx agntc remove leeovery/agentic-workflows then npx agntc add leeovery/agentic-workflows --pack";

				beforeEach(async () => {
					const {
						"skills/workflow-shared/references/casing-conventions.md": _,
						"skills/workflow-shared/references/composing-a-raise.md": __,
						...rest
					} = WORKFLOWS;
					await repo(KEY, {
						...rest,
						"shared/workflow-shared/references/casing-conventions.md": "v2",
					});
					await installV1();
				});

				async function expectInstallIntact(): Promise<void> {
					expect(await sharedText()).toBe("v0");
					expect(
						await readFile(
							join(projectDir, ".claude/skills/workflow-start/SKILL.md"),
							"utf-8",
						),
					).toBe("v0");
					expect(await installed(".claude/skills/README.md")).toBe(true);
					expect(await installed(".agents/skills/workflow-shared")).toBe(true);
					expect(await savedManifest()).toEqual({ [KEY]: V1_ENTRY });
				}

				it("update by key stops before removing anything, naming the folder", async () => {
					expect(await updateError(KEY)).toBeInstanceOf(ExitSignal);

					expect(mockLog.error).toHaveBeenCalledWith(MESSAGE);
					await expectInstallIntact();
				});

				it("update of everything stops it with the same message, the key printed once", async () => {
					expect(await updateError()).toBeInstanceOf(ExitSignal);

					const stops = vi
						.mocked(p.spinner)
						.mock.results.flatMap(({ value }) =>
							value.stop.mock.calls.map(([text]: [string]) => text),
						);
					expect(stops).toContain(MESSAGE);
					await expectInstallIntact();
				});
			});
		});

		describe("with a folder agntc didn't install where a support folder goes", () => {
			const MINE = ".claude/skills/workflow-shared/mine.md";

			async function readMine(): Promise<string> {
				return readFile(join(projectDir, MINE), "utf-8");
			}

			it("add asks, and on cancel installs nothing and leaves it alone", async () => {
				await repo(KEY, WORKFLOWS);
				await write(projectDir, { [MINE]: "mine" });
				vi.mocked(p.select).mockResolvedValue("cancel");

				await runAdd(KEY);

				expect(p.note).toHaveBeenCalledWith(
					expect.stringContaining(".claude/skills/workflow-shared/"),
					`Unmanaged files for "${KEY}"`,
				);
				expect(await readMine()).toBe("mine");
				expect(await installed(".claude/skills/workflow-start")).toBe(false);
				expect(await savedManifest()).toEqual({});
			});

			it("update aborts before removing anything, the install left intact", async () => {
				await repo(KEY, WORKFLOWS);
				await write(projectDir, {
					".claude/skills/workflow-start/SKILL.md": "old",
					[MINE]: "mine",
				});
				const entry = {
					ref: null,
					commit: OLD_SHA,
					installedAt: "2026-10-13T10:00:00.000Z",
					type: "pack",
					cloneUrl: "https://github.com/leeovery/agentic-workflows.git",
					files: [".claude/skills/workflow-start/"],
				};
				await write(join(projectDir, ".agntc"), {
					"manifest.json": { [KEY]: entry },
				});

				expect(await updateError()).toBeInstanceOf(ExitSignal);

				expect(await readMine()).toBe("mine");
				expect(
					await readFile(
						join(projectDir, ".claude/skills/workflow-start/SKILL.md"),
						"utf-8",
					),
				).toBe("old");
				expect(await savedManifest()).toEqual({ [KEY]: entry });
			});
		});
	});

	describe("a pack and the loose skills from its own source", () => {
		it("adding the pack takes over a loose skill it now holds, without asking", async () => {
			await repo("owner/repo", {
				"skills/api/SKILL.md": "v1",
				"skills/jobs/SKILL.md": "v1",
			});
			await runAdd("owner/repo", { skill: ["api", "jobs"] });
			await repo("owner/repo", {
				"laravel/agntc.json": PACK,
				"laravel/skills/api/SKILL.md": "v2",
				"laravel/skills/models/SKILL.md": "v2",
				"skills/jobs/SKILL.md": "v1",
			});

			await runAdd("owner/repo/laravel");

			const manifest = await savedManifest();
			expect(Object.keys(manifest).sort()).toEqual([
				"owner/repo/jobs",
				"owner/repo/laravel",
			]);
			expect(manifest["owner/repo/laravel"]!.files).toEqual([
				".claude/skills/api/",
				".claude/skills/models/",
			]);
			expect(
				await readFile(
					join(projectDir, ".claude/skills/api/SKILL.md"),
					"utf-8",
				),
			).toBe("v2");
			expect(mockLog.info).toHaveBeenCalledWith(
				"owner/repo/laravel now includes api, installed on its own before",
			);
			expect(p.select).not.toHaveBeenCalled();
			expect(p.confirm).not.toHaveBeenCalled();
		});

		it("--skill on a skill an installed pack from the source holds says so and installs the rest", async () => {
			await repo("owner/repo", {
				"laravel/agntc.json": PACK,
				"laravel/skills/api/SKILL.md": "",
				"skills/other/SKILL.md": "",
			});
			await runAdd("owner/repo/laravel");

			const err = await runAdd("owner/repo", {
				skill: ["api", "other"],
			}).catch((error: unknown) => error);

			expect(err).toBeUndefined();
			expect(Object.keys(await savedManifest())).toEqual([
				"owner/repo/laravel",
				"owner/repo/other",
			]);
			expect(mockLog.info).toHaveBeenCalledWith(
				"api is already installed as part of the pack owner/repo/laravel",
			);
			expect(mockLog.info).not.toHaveBeenCalledWith(
				expect.stringContaining("installed on its own"),
			);
			expect(mockLog.error).not.toHaveBeenCalled();
		});

		describe("with a support folder named like a loose skill", () => {
			const LARAVEL = {
				"laravel/agntc.json": PACK,
				"laravel/skills/api/SKILL.md": "",
				"tools/shared/SKILL.md": "loose",
			};
			const WITH_SHARED = {
				...LARAVEL,
				"laravel/skills/shared/notes.md": "the pack's",
			};

			function looseText(): Promise<string> {
				return readFile(
					join(projectDir, ".claude/skills/shared/SKILL.md"),
					"utf-8",
				);
			}

			it("adding the pack stops at the loose skill as another install's files, taking nothing over", async () => {
				await repo("owner/repo", WITH_SHARED);
				await runAdd("owner/repo", { skill: ["shared"] });
				const ui = new MachineUi("add", "project");

				const err = await runAdd("owner/repo/laravel", {}, ui).catch(
					(error: unknown) => error,
				);

				expect(err).toBeInstanceOf(ExitSignal);
				expect(ui.document(1)).toMatchObject({
					items: [
						{
							key: "owner/repo/laravel",
							status: "skipped",
							reason:
								"files in the way belong to owner/repo/shared: .claude/skills/shared/",
							flags: ["--overwrite"],
						},
					],
					notes: [],
				});
				expect(Object.keys(await savedManifest())).toEqual([
					"owner/repo/shared",
				]);
				expect(await looseText()).toBe("loose");
			});

			it("updating a pack that now ships it stops before removing anything, both left installed", async () => {
				const v1 = await repo("owner/repo", LARAVEL);
				mockCloneSource.mockImplementationOnce(async () => {
					const tempDir = await mkdtemp(join(testDir, "clone-"));
					await cp(v1, tempDir, { recursive: true });
					return { tempDir, commit: OLD_SHA };
				});
				await runAdd("owner/repo/laravel");
				await runAdd("owner/repo", { skill: ["shared"] });
				const before = await savedManifest();
				await repo("owner/repo", WITH_SHARED);

				expect(await updateError("owner/repo/laravel")).toBeInstanceOf(
					ExitSignal,
				);

				expect(mockLog.error).toHaveBeenCalledWith(
					expect.stringContaining(
						"files of owner/repo/shared are in the way: .claude/skills/shared/",
					),
				);
				expect(await savedManifest()).toEqual(before);
				expect(await looseText()).toBe("loose");
				expect(await installed(".claude/skills/shared/notes.md")).toBe(false);
				expect(mockLog.info).not.toHaveBeenCalledWith(
					expect.stringContaining("now includes shared"),
				);
			});

			it("updating a pack that now ships a skill of that name still takes the loose skill over", async () => {
				const v1 = await repo("owner/repo", LARAVEL);
				mockCloneSource.mockImplementationOnce(async () => {
					const tempDir = await mkdtemp(join(testDir, "clone-"));
					await cp(v1, tempDir, { recursive: true });
					return { tempDir, commit: OLD_SHA };
				});
				await runAdd("owner/repo/laravel");
				await runAdd("owner/repo", { skill: ["shared"] });
				await repo("owner/repo", {
					...LARAVEL,
					"laravel/skills/shared/SKILL.md": "the pack's",
				});

				await runUpdate("owner/repo/laravel");

				expect(Object.keys(await savedManifest())).toEqual([
					"owner/repo/laravel",
				]);
				expect(await looseText()).toBe("the pack's");
				expect(mockLog.info).toHaveBeenCalledWith(
					"owner/repo/laravel now includes shared, installed on its own before",
				);
			});
		});
	});

	describe("an entry added at a branch", () => {
		/** Each remote ref's tree and commit, named as ls-remote names it. */
		let remote: Map<string, { dir: string; sha: string }>;

		function refName(ref: string | null): string {
			return ref === null ? "HEAD" : `refs/heads/${ref}`;
		}

		async function push(
			ref: string | null,
			sha: string,
			files: Record<string, string>,
		): Promise<void> {
			const dir = await repo(`owner/repo@${refName(ref)}`, files);
			remote.set(refName(ref), { dir, sha });
		}

		function pushedTo(ref: string | null): { dir: string; sha: string } {
			const pushed = remote.get(refName(ref));
			if (pushed === undefined) {
				throw new Error(`nothing pushed to ${refName(ref)}`);
			}
			return pushed;
		}

		async function skillText(): Promise<string> {
			return readFile(
				join(projectDir, ".claude/skills/repo/SKILL.md"),
				"utf-8",
			);
		}

		beforeEach(() => {
			remote = new Map();
			mockCloneSource.mockImplementation(async (parsed: ParsedSource) => {
				const { dir, sha } = pushedTo(parsed.ref);
				const tempDir = await mkdtemp(join(testDir, "clone-"));
				await cp(dir, tempDir, { recursive: true });
				return { tempDir, commit: sha };
			});
			mockResolveGroupTarget.mockImplementation(async ({ versionIntent }) => {
				const resolvedSha = pushedTo(versionIntent).sha;
				return versionIntent === null
					? { kind: "head", resolvedSha }
					: { kind: "branch", resolvedSha };
			});
			mockLsRemote.mockImplementation(
				remoteRefs((ref) => remote.get(ref)?.sha),
			);
		});

		it("stays on its branch across two updates while the branch moves", async () => {
			await push(null, "0".repeat(40), { "SKILL.md": "main" });
			await push("dev", "1".repeat(40), { "SKILL.md": "dev 1" });
			await runAdd("owner/repo@dev");

			await push("dev", "2".repeat(40), { "SKILL.md": "dev 2" });
			await runUpdate();

			expect(await skillText()).toBe("dev 2");
			expect((await savedManifest())["owner/repo"]).toMatchObject({
				ref: "dev",
				commit: "2".repeat(40),
			});

			await push("dev", "3".repeat(40), { "SKILL.md": "dev 3" });
			await runUpdate("owner/repo");

			expect(await skillText()).toBe("dev 3");
			expect((await savedManifest())["owner/repo"]).toMatchObject({
				ref: "dev",
				commit: "3".repeat(40),
			});
			expect(mockCloneSource.mock.calls.map(([parsed]) => parsed.ref)).toEqual([
				"dev",
				"dev",
				"dev",
			]);
		});
	});

	describe("an update whose removal fails part way", () => {
		const REPO_URL = "https://github.com/owner/repo.git";
		/** A hand-edited entry recording a path outside the project, which no removal deletes. */
		const SKILL_B: ManifestEntry = {
			ref: null,
			commit: OLD_SHA,
			installedAt: "2026-01-15T10:00:00.000Z",
			files: [".claude/skills/skillB/", "../outside.md"],
			type: "skill",
			cloneUrl: REPO_URL,
		};

		async function arrange(): Promise<void> {
			await repo("owner/repo", {
				"packA/agntc.json": PACK,
				"packA/skills/a/SKILL.md": "v2",
				"skillB/SKILL.md": "v2",
			});
			await write(projectDir, {
				".claude/skills/a/SKILL.md": "v1",
				".claude/skills/skillB/SKILL.md": "v1",
				".agntc/manifest.json": {
					"owner/repo/packA": {
						...SKILL_B,
						type: "pack",
						files: [".claude/skills/a/"],
					},
					"owner/repo/skillB": SKILL_B,
				},
			});
		}

		/** The pack updated before skillB's removal failed stays recorded, and skillB stays tracked. */
		async function packKeptSkillTracked(err: unknown): Promise<void> {
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(
				await readFile(join(projectDir, ".claude/skills/a/SKILL.md"), "utf-8"),
			).toBe("v2");
			const manifest = await savedManifest();
			expect(manifest["owner/repo/packA"]).toMatchObject({
				commit: NEW_SHA,
				files: [".claude/skills/a/"],
			});
			expect(manifest["owner/repo/skillB"]).toEqual(SKILL_B);
			expect(await installed(".claude/skills/skillB")).toBe(false);
		}

		function refusal(): string {
			return `couldn't remove its old files: won't delete ../outside.md — not a plain path below ${projectDir}`;
		}

		it("by a key naming both, records the pack done before it and reports the member as failed", async () => {
			await arrange();

			await packKeptSkillTracked(await updateError("owner/repo"));
			expect(mockLog.error).toHaveBeenCalledExactlyOnceWith(
				`owner/repo/skillB: Failed — ${refusal()}`,
			);
		});

		it("in all-mode, records the pack done before it and reports the member as failed", async () => {
			await arrange();

			await packKeptSkillTracked(await updateError());
			expect(mockLog.error).toHaveBeenCalledExactlyOnceWith(
				`owner/repo/skillB: Failed — ${refusal()}`,
			);
		});
	});
});

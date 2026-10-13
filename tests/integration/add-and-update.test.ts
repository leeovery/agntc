import {
	access,
	cp,
	mkdir,
	mkdtemp,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
import { fetchRemoteTags } from "../../src/git-utils.js";
import type { Manifest } from "../../src/manifest.js";
import type { ParsedSource } from "../../src/source-parser.js";
import { resolveGroupTarget } from "../../src/update-check.js";

const mockCloneSource = vi.mocked(cloneSource);
const mockFetchRemoteTags = vi.mocked(fetchRemoteTags);
const mockResolveGroupTarget = vi.mocked(resolveGroupTarget);
const mockMultiselect = vi.mocked(p.multiselect);
const mockLog = vi.mocked(p.log);

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

		it("aborts an entry whose path is gone, leaving it installed, while its sibling updates", async () => {
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

			const err = await runUpdate().catch((error: unknown) => error);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(await installed(".claude/skills/gone/SKILL.md")).toBe(true);
			const manifest = await savedManifest();
			expect(manifest["owner/repo/gone"]).toMatchObject({ commit: OLD_SHA });
			expect(manifest["owner/repo/kept"]).toMatchObject({ commit: NEW_SHA });
			expect(
				await readFile(
					join(projectDir, ".claude/skills/kept/SKILL.md"),
					"utf-8",
				),
			).toBe("v2");
		});
	});
});

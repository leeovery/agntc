import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeIncomingFiles } from "../src/compute-incoming-files.js";
import { copyItem } from "../src/copy-item.js";
import type { FoundPack } from "../src/discover.js";
import type { InstallItem } from "../src/install-item.js";

let base: string;
let root: string;

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), "agntc-incoming-"));
	root = join(base, "source");
	await mkdir(root, { recursive: true });
});

afterEach(async () => {
	await rm(base, { recursive: true, force: true });
});

async function tree(spec: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(spec)) {
		const full = join(root, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, content);
	}
}

function packItem(overrides: Partial<FoundPack> = {}): InstallItem {
	return {
		kind: "pack",
		pack: { name: "p", path: "p", skills: [], assetDirs: [], ...overrides },
	};
}

describe("computeIncomingFiles", () => {
	describe("skill", () => {
		it("claims .claude/skills/<folder name>/", async () => {
			const result = await computeIncomingFiles(
				{ kind: "skill", skill: { name: "hooks", path: "skills/react/hooks" } },
				root,
			);

			expect(result).toEqual([".claude/skills/hooks/"]);
		});

		it("claims the root's name for a skill at the root", async () => {
			const result = await computeIncomingFiles(
				{ kind: "skill", skill: { name: "refero-design", path: "" } },
				"/tmp/agntc-Xy12ab",
			);

			expect(result).toEqual([".claude/skills/refero-design/"]);
		});
	});

	describe("pack", () => {
		it("claims each skill, each .md agent and each top-level hook entry", async () => {
			await tree({
				"p/skills/a/SKILL.md": "",
				"p/agents/reviewer.md": "",
				"p/agents/nested/planner.md": "",
				"p/agents/openai.yaml": "",
				"p/hooks/pre.sh": "",
				"p/hooks/lint/run.sh": "",
			});

			const result = await computeIncomingFiles(
				packItem({
					skills: [{ name: "a", path: "p/skills/a" }],
					assetDirs: ["agents", "hooks"],
				}),
				root,
			);

			expect([...result].sort()).toEqual([
				".claude/agents/nested/planner.md",
				".claude/agents/reviewer.md",
				".claude/hooks/lint/",
				".claude/hooks/pre.sh",
				".claude/skills/a/",
			]);
		});

		it("claims nothing from agents/ or hooks/ the pack doesn't list", async () => {
			await tree({ "p/agents/a.md": "", "p/hooks/h.sh": "" });

			expect(await computeIncomingFiles(packItem(), root)).toEqual([]);
		});

		it("predicts the top-level paths copying claims", async () => {
			await tree({
				"p/skills/a/SKILL.md": "",
				"p/agents/x.md": "",
				"p/hooks/h.sh": "",
			});
			const item = packItem({
				skills: [{ name: "a", path: "p/skills/a" }],
				assetDirs: ["agents", "hooks"],
			});
			const projectDir = join(base, "project");

			const incoming = await computeIncomingFiles(item, root);
			const { copiedFiles } = await copyItem(item, root, projectDir);

			expect([...incoming].sort()).toEqual([...copiedFiles].sort());
		});
	});
});

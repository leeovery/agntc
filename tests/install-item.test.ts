import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FoundPack } from "../src/discover.js";
import {
	type InstallItem,
	isEmptyPack,
	itemLabel,
	keyItems,
} from "../src/install-item.js";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "agntc-install-item-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

async function tree(files: string[]): Promise<void> {
	for (const path of files) {
		const full = join(root, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(full, "");
	}
}

function skill(path: string, name = path.split("/").pop() ?? path) {
	return { kind: "skill", skill: { name, path } } satisfies InstallItem;
}

function pack(path: string, overrides: Partial<FoundPack> = {}) {
	return {
		kind: "pack",
		pack: {
			name: path.split("/").pop() || "repo",
			path,
			skills: [],
			assetDirs: [],
			...overrides,
		},
	} satisfies InstallItem;
}

function key(items: InstallItem[], sourceKey = "owner/repo") {
	return keyItems(items, sourceKey, "repo", root);
}

async function keysOf(items: InstallItem[], sourceKey = "owner/repo") {
	const result = await key(items, sourceKey);
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.items.map(({ key, sourceSubpath }) => ({
		key,
		...(sourceSubpath !== undefined ? { sourceSubpath } : {}),
	}));
}

async function refusal(items: InstallItem[]): Promise<string[]> {
	const result = await key(items);
	return result.ok ? [] : result.message.split("\n");
}

describe("keyItems", () => {
	it("keys a root skill with the source key", async () => {
		expect(await keysOf([skill("", "repo")])).toEqual([{ key: "owner/repo" }]);
	});

	it("keys a root pack with the source key", async () => {
		expect(await keysOf([pack("")])).toEqual([{ key: "owner/repo" }]);
	});

	it("keys a top-level skill by its folder name, with no sourceSubpath", async () => {
		expect(await keysOf([skill("lint")])).toEqual([{ key: "owner/repo/lint" }]);
	});

	it("keys a nested skill by its folder name and records its path", async () => {
		expect(await keysOf([skill("skills/react/hooks")])).toEqual([
			{ key: "owner/repo/hooks", sourceSubpath: "skills/react/hooks" },
		]);
	});

	it("keys a v1 skills-only member the way v1 did", async () => {
		expect(await keysOf([skill("skills/a")])).toEqual([
			{ key: "owner/repo/a", sourceSubpath: "skills/a" },
		]);
	});

	it("keys a pack by its path, with no sourceSubpath", async () => {
		expect(await keysOf([pack("laravel"), pack("plugins/nuxt")])).toEqual([
			{ key: "owner/repo/laravel" },
			{ key: "owner/repo/plugins/nuxt" },
		]);
	});

	it("prefixes a local source's keys with the local path", async () => {
		expect(
			await keysOf([skill("skills/a"), pack("p")], "/home/me/src"),
		).toEqual([
			{ key: "/home/me/src/a", sourceSubpath: "skills/a" },
			{ key: "/home/me/src/p" },
		]);
	});

	it("carries the install paths each item claims, with the source behind each", async () => {
		await tree(["p/agents/reviewer.md"]);
		const packed = pack("p", {
			assetDirs: ["agents"],
			skills: [{ name: "api", path: "p/skills/api" }],
		});

		const result = await key([packed, skill("tools/lint")]);

		expect(result.ok && result.items.map(({ claims }) => claims)).toEqual([
			[
				{ target: ".claude/skills/api/", source: "p/skills/api" },
				{
					target: ".claude/agents/reviewer.md",
					source: "p/agents/reviewer.md",
				},
			],
			[{ target: ".claude/skills/lint/", source: "tools/lint" }],
		]);
	});

	it("refuses a pack and a skill that share a key, naming both paths", async () => {
		expect(await refusal([pack("foo"), skill("x/foo")])).toEqual([
			"foo and x/foo would share the key owner/repo/foo — choose one",
		]);
	});

	describe("two claims on one install path", () => {
		it("refuses two loose skills with one folder name, naming the install path", async () => {
			expect(
				await refusal([skill("a/foo"), skill("b/foo"), skill("bar")]),
			).toEqual([
				"a/foo and b/foo would both install to .claude/skills/foo — choose one",
			]);
		});

		it("refuses a loose skill and a skill inside a selected pack", async () => {
			const packed = pack("p", {
				skills: [{ name: "foo", path: "p/skills/foo" }],
			});

			expect(await refusal([packed, skill("tools/foo")])).toEqual([
				"p/skills/foo and tools/foo would both install to .claude/skills/foo — choose one",
			]);
		});

		it("refuses two skills inside one pack", async () => {
			const packed = pack("p", {
				skills: [
					{ name: "foo", path: "p/a/foo" },
					{ name: "foo", path: "p/b/foo" },
				],
			});

			expect(await refusal([packed])).toEqual([
				"p/a/foo and p/b/foo would both install to .claude/skills/foo — choose one",
			]);
		});

		it("refuses two packs sharing a skill name, an agent file or a hook entry", async () => {
			await tree([
				"p/agents/team/lead.md",
				"p/hooks/lint/run.sh",
				"q/agents/team/lead.md",
				"q/hooks/lint",
			]);
			const assets = { assetDirs: ["agents", "hooks"] } as const;
			const first = pack("p", {
				...assets,
				skills: [{ name: "api", path: "p/skills/api" }],
			});
			const second = pack("q", {
				...assets,
				skills: [{ name: "api", path: "q/api" }],
			});

			expect(await refusal([first, second])).toEqual([
				"p/skills/api and q/api would both install to .claude/skills/api — choose one",
				"p/agents/team/lead.md and q/agents/team/lead.md would both install to .claude/agents/team/lead.md — choose one",
				"p/hooks/lint and q/hooks/lint would both install to .claude/hooks/lint — choose one",
			]);
		});

		it("reports only the shared install paths when the same items also share a key", async () => {
			const lines = await refusal([
				skill("a/x"),
				skill("b/x"),
				skill("a/y"),
				skill("b/y"),
			]);

			expect(lines).toEqual([
				"a/x and b/x would both install to .claude/skills/x — choose one",
				"a/y and b/y would both install to .claude/skills/y — choose one",
			]);
		});

		it("lets a pack and a skill through when their install paths differ", async () => {
			const packed = pack("p", {
				skills: [{ name: "api", path: "p/skills/api" }],
			});

			expect(await keysOf([packed, skill("lint")])).toEqual([
				{ key: "owner/repo/p" },
				{ key: "owner/repo/lint" },
			]);
		});
	});
});

describe("itemLabel", () => {
	it("shows the path, or the root name at the root", () => {
		expect(itemLabel(skill("skills/a"), "repo")).toBe("skills/a");
		expect(itemLabel(pack(""), "repo")).toBe("repo");
	});
});

describe("isEmptyPack", () => {
	it("is empty with no skills and no asset dirs", () => {
		expect(isEmptyPack(pack("p").pack)).toBe(true);
	});

	it("isn't empty with skills or with agents or hooks", () => {
		expect(
			isEmptyPack(pack("p", { skills: [{ name: "a", path: "p/a" }] }).pack),
		).toBe(false);
		expect(isEmptyPack(pack("p", { assetDirs: ["hooks"] }).pack)).toBe(false);
	});
});

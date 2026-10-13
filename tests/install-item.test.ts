import { describe, expect, it } from "vitest";
import type { FoundPack } from "../src/discover.js";
import {
	type InstallItem,
	isEmptyPack,
	itemLabel,
	keyItems,
} from "../src/install-item.js";

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

function keysOf(items: InstallItem[], sourceKey = "owner/repo") {
	const result = keyItems(items, sourceKey, "repo");
	if (!result.ok) {
		throw new Error(result.message);
	}
	return result.items.map(({ key, sourceSubpath }) => ({
		key,
		...(sourceSubpath !== undefined ? { sourceSubpath } : {}),
	}));
}

describe("keyItems", () => {
	it("keys a root skill with the source key", () => {
		expect(keysOf([skill("", "repo")])).toEqual([{ key: "owner/repo" }]);
	});

	it("keys a root pack with the source key", () => {
		expect(keysOf([pack("")])).toEqual([{ key: "owner/repo" }]);
	});

	it("keys a top-level skill by its folder name, with no sourceSubpath", () => {
		expect(keysOf([skill("lint")])).toEqual([{ key: "owner/repo/lint" }]);
	});

	it("keys a nested skill by its folder name and records its path", () => {
		expect(keysOf([skill("skills/react/hooks")])).toEqual([
			{ key: "owner/repo/hooks", sourceSubpath: "skills/react/hooks" },
		]);
	});

	it("keys a v1 skills-only member the way v1 did", () => {
		expect(keysOf([skill("skills/a")])).toEqual([
			{ key: "owner/repo/a", sourceSubpath: "skills/a" },
		]);
	});

	it("keys a pack by its path, with no sourceSubpath", () => {
		expect(keysOf([pack("laravel"), pack("plugins/nuxt")])).toEqual([
			{ key: "owner/repo/laravel" },
			{ key: "owner/repo/plugins/nuxt" },
		]);
	});

	it("prefixes a local source's keys with the local path", () => {
		expect(keysOf([skill("skills/a"), pack("p")], "/home/me/src")).toEqual([
			{ key: "/home/me/src/a", sourceSubpath: "skills/a" },
			{ key: "/home/me/src/p" },
		]);
	});

	it("refuses two items that share a key, naming both paths", () => {
		const result = keyItems(
			[skill("a/foo"), skill("b/foo"), skill("bar")],
			"owner/repo",
			"repo",
		);

		expect(result).toEqual({
			ok: false,
			message:
				"a/foo and b/foo would share the key owner/repo/foo — choose one",
		});
	});

	it("refuses a pack and a skill that share a key", () => {
		const result = keyItems(
			[pack("foo"), skill("x/foo")],
			"owner/repo",
			"repo",
		);

		expect(result.ok).toBe(false);
		expect(!result.ok && result.message).toContain("foo and x/foo");
	});

	it("lists every clash, one per line", () => {
		const result = keyItems(
			[skill("a/x"), skill("b/x"), skill("a/y"), skill("b/y")],
			"owner/repo",
			"repo",
		);

		expect(!result.ok && result.message.split("\n")).toHaveLength(2);
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

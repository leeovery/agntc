import { describe, expect, it } from "vitest";
import { localSubject, mayTakeOver } from "../src/key-update.js";
import type { Manifest, ManifestEntry } from "../src/manifest.js";

function remote(
	repo: string,
	type: "skill" | "pack",
	fields: Partial<ManifestEntry> = {},
): ManifestEntry {
	return {
		ref: null,
		commit: "a".repeat(40),
		installedAt: "2026-10-01T00:00:00.000Z",
		files: [],
		type,
		cloneUrl: `https://github.com/${repo}.git`,
		...fields,
	};
}

function local(root: string, type: "skill" | "pack"): ManifestEntry {
	return {
		ref: null,
		commit: null,
		installedAt: "2026-10-01T00:00:00.000Z",
		files: [],
		type,
		cloneUrl: null,
		localRoot: root,
	};
}

describe("mayTakeOver", () => {
	it("names the loose skills from a pack's own source, not its packs, other sources' skills or the members", () => {
		const manifest: Manifest = {
			"owner/repo/tools": remote("owner/repo", "pack"),
			"owner/repo/a": remote("owner/repo", "skill"),
			"owner/repo/b": remote("owner/repo", "skill", { ref: "main" }),
			"owner/repo/kit": remote("owner/repo", "pack"),
			"other/repo/a": remote("other/repo", "skill"),
		};
		const members = ["owner/repo/tools", "owner/repo/a"].map((key) => ({
			key,
			entry: manifest[key]!,
		}));

		expect(mayTakeOver(members, manifest)).toEqual(["owner/repo/b"]);
	});

	it("names none for skills alone, which take nothing over", () => {
		const manifest: Manifest = {
			"owner/repo/a": remote("owner/repo", "skill"),
			"owner/repo/b": remote("owner/repo", "skill"),
		};

		expect(
			mayTakeOver(
				[{ key: "owner/repo/a", entry: manifest["owner/repo/a"]! }],
				manifest,
			),
		).toEqual([]);
	});
});

describe("localSubject", () => {
	const head = { subject: "~/src/L/kit", meta: "local" };

	it("measures a local pack's row with the loose skills from its folder it may take over", () => {
		const manifest: Manifest = {
			"/home/me/src/L/kit": local("/home/me/src/L", "pack"),
			"/home/me/src/L/a-long-skill": local("/home/me/src/L", "skill"),
		};
		const member = {
			key: "/home/me/src/L/kit",
			entry: manifest["/home/me/src/L/kit"]!,
		};

		expect(localSubject(member, head, manifest)).toEqual({
			...head,
			children: [{ name: "a-long-skill", status: "done" }],
		});
	});

	it("is the row's head alone when there's nothing to take over", () => {
		const manifest: Manifest = {
			"/home/me/src/L/kit": local("/home/me/src/L", "pack"),
		};
		const member = {
			key: "/home/me/src/L/kit",
			entry: manifest["/home/me/src/L/kit"]!,
		};

		expect(localSubject(member, head, manifest)).toBe(head);
	});
});

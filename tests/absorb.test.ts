import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	absorptionNote,
	claimFiles,
	skillsInInstalledPacks,
	takenOverRemoved,
} from "../src/absorb.js";
import type { Discovery, FoundPack } from "../src/discover.js";
import type { SourceId } from "../src/entry-source.js";
import type { Manifest } from "../src/manifest.js";
import { makeEntry } from "./helpers/factories.js";

const REPO: SourceId = {
	kind: "remote",
	cloneUrl: "https://github.com/owner/repo.git",
};

const skill = (name: string, overrides = {}) =>
	makeEntry({
		type: "skill",
		files: [`.claude/skills/${name}/`],
		...overrides,
	});

describe("claimFiles", () => {
	/** Pack `tools`, holding the skills a and b and the support folder shared. */
	const TOOLS: FoundPack = {
		name: "tools",
		path: "tools",
		skills: [
			{ name: "a", path: "tools/skills/a" },
			{ name: "b", path: "tools/skills/b" },
		],
		supportFolders: [{ name: "shared", path: "tools/skills/shared" }],
		assetDirs: [],
	};
	const incoming = [
		".claude/skills/a/",
		".claude/skills/b/",
		".claude/skills/shared/",
	];

	function claim(manifest: Manifest) {
		return claimFiles(TOOLS, incoming, manifest, "owner/repo/tools", REPO);
	}

	it("clashes with a loose skill from its own source that a support folder lands on", () => {
		const manifest: Manifest = { "owner/repo/shared": skill("shared") };

		expect(claim(manifest)).toEqual({
			absorbed: [],
			clashes: new Map([["owner/repo/shared", [".claude/skills/shared/"]]]),
		});
	});

	it("absorbs a loose skill from the pack's own source", () => {
		const manifest: Manifest = { "owner/repo/a": skill("a") };

		expect(claim(manifest)).toEqual({
			absorbed: ["owner/repo/a"],
			clashes: new Map(),
		});
	});

	it("absorbs a legacy entry with no type as a loose skill", () => {
		const manifest: Manifest = {
			"owner/repo/a": makeEntry({ files: [".claude/skills/a/"] }),
		};

		expect(claim(manifest).absorbed).toEqual(["owner/repo/a"]);
	});

	it("absorbs a loose skill added over SSH into a pack from the same repo over HTTPS", () => {
		const manifest: Manifest = {
			"owner/repo/a": skill("a", { cloneUrl: "git@github.com:owner/repo.git" }),
		};

		expect(claim(manifest).absorbed).toEqual(["owner/repo/a"]);
	});

	it("clashes with a loose skill from another source, naming the files", () => {
		const manifest: Manifest = { "other/repo/a": skill("a") };

		expect(claim(manifest)).toEqual({
			absorbed: [],
			clashes: new Map([["other/repo/a", [".claude/skills/a/"]]]),
		});
	});

	it("clashes with another pack from the same source", () => {
		const manifest: Manifest = {
			"owner/repo/other": makeEntry({
				type: "pack",
				files: [".claude/skills/b/", ".claude/agents/x.md"],
			}),
		};

		expect(claim(manifest)).toEqual({
			absorbed: [],
			clashes: new Map([["owner/repo/other", [".claude/skills/b/"]]]),
		});
	});

	it("ignores the pack's own recorded files and entries it doesn't land on", () => {
		const manifest: Manifest = {
			"owner/repo/tools": makeEntry({
				type: "pack",
				files: [".claude/skills/a/"],
			}),
			"owner/repo/c": skill("c"),
		};

		expect(claim(manifest)).toEqual({
			absorbed: [],
			clashes: new Map(),
		});
	});
});

describe("absorptionNote", () => {
	it("names the pack and the skill it took over", () => {
		expect(absorptionNote("owner/repo/tools", "owner/repo/a")).toBe(
			"owner/repo/tools now includes a, installed on its own before",
		);
	});
});

describe("takenOverRemoved", () => {
	it("names the one skill a pack took over", () => {
		expect(takenOverRemoved(["owner/repo/a"])).toBe(
			"the skill it took over was removed: owner/repo/a",
		);
	});

	it("names every skill a pack took over", () => {
		expect(takenOverRemoved(["owner/repo/a", "owner/repo/b"])).toBe(
			"the skills it took over were removed: owner/repo/a, owner/repo/b",
		);
	});
});

describe("skillsInInstalledPacks", () => {
	let installRoot: string;

	beforeEach(async () => {
		installRoot = await mkdtemp(join(tmpdir(), "agntc-absorb-"));
		for (const file of ["a/SKILL.md", "b/SKILL.md", "shared/notes.md"]) {
			const path = join(installRoot, ".claude/skills", file);
			await mkdir(dirname(path), { recursive: true });
			await writeFile(path, "");
		}
	});

	afterEach(async () => {
		await rm(installRoot, { recursive: true, force: true });
	});

	const manifest: Manifest = {
		"owner/repo/tools": makeEntry({
			type: "pack",
			files: [
				".claude/skills/a/",
				".claude/skills/shared/",
				".claude/agents/x.md",
			],
		}),
		"owner/repo/b": skill("b"),
	};
	const discovery: Discovery = {
		packs: [
			{
				name: "tools",
				path: "tools",
				skills: [{ name: "a", path: "tools/skills/a" }],
				supportFolders: [{ name: "shared", path: "tools/skills/shared" }],
				assetDirs: ["agents"],
			},
		],
		skills: [
			{ name: "a", path: "skills/a" },
			{ name: "b", path: "skills/b" },
			{ name: "shared", path: "other/shared" },
		],
		strays: [],
	};

	function packed(source: SourceId = REPO) {
		return skillsInInstalledPacks(discovery, manifest, source, installRoot);
	}

	it("maps each skill, loose or in a pack, that an installed pack from the source holds to that pack", async () => {
		expect(await packed()).toEqual(
			new Map([
				["skills/a", "owner/repo/tools"],
				["tools/skills/a", "owner/repo/tools"],
			]),
		);
	});

	it("leaves out a skill installed on its own", async () => {
		expect((await packed()).has("skills/b")).toBe(false);
	});

	it("leaves out a skill named like the installed pack's support folder, which holds no such skill", async () => {
		expect((await packed()).has("other/shared")).toBe(false);
	});

	it("takes a folder of the pack it can't read for the skill, rather than failing", async () => {
		const locked = join(installRoot, ".claude/skills/a");
		await chmod(locked, 0o000);

		try {
			expect((await packed()).get("skills/a")).toBe("owner/repo/tools");
		} finally {
			await chmod(locked, 0o755);
		}
	});

	it("finds nothing in a pack from another source", async () => {
		const other: SourceId = {
			kind: "remote",
			cloneUrl: "https://github.com/other/repo.git",
		};

		expect((await packed(other)).size).toBe(0);
	});
});

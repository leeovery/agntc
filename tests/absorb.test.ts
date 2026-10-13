import { describe, expect, it } from "vitest";
import {
	absorptionNote,
	claimFiles,
	skillsInInstalledPacks,
	takenOverRemoved,
} from "../src/absorb.js";
import type { Discovery } from "../src/discover.js";
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
	const incoming = [".claude/skills/a/", ".claude/skills/b/"];

	it("absorbs a loose skill from the pack's own source", () => {
		const manifest: Manifest = { "owner/repo/a": skill("a") };

		expect(claimFiles(incoming, manifest, "owner/repo/tools", REPO)).toEqual({
			absorbed: ["owner/repo/a"],
			clashes: new Map(),
		});
	});

	it("absorbs a legacy entry with no type as a loose skill", () => {
		const manifest: Manifest = {
			"owner/repo/a": makeEntry({ files: [".claude/skills/a/"] }),
		};

		expect(
			claimFiles(incoming, manifest, "owner/repo/tools", REPO).absorbed,
		).toEqual(["owner/repo/a"]);
	});

	it("clashes with a loose skill from another source, naming the files", () => {
		const manifest: Manifest = { "other/repo/a": skill("a") };

		expect(claimFiles(incoming, manifest, "owner/repo/tools", REPO)).toEqual({
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

		expect(claimFiles(incoming, manifest, "owner/repo/tools", REPO)).toEqual({
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

		expect(claimFiles(incoming, manifest, "owner/repo/tools", REPO)).toEqual({
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
	const manifest: Manifest = {
		"owner/repo/tools": makeEntry({
			type: "pack",
			files: [".claude/skills/a/", ".claude/agents/x.md"],
		}),
		"owner/repo/b": skill("b"),
	};
	const discovery: Discovery = {
		packs: [
			{
				name: "tools",
				path: "tools",
				skills: [{ name: "a", path: "tools/skills/a" }],
				assetDirs: ["agents"],
			},
		],
		skills: [
			{ name: "a", path: "skills/a" },
			{ name: "b", path: "skills/b" },
		],
		strays: [],
	};

	it("maps each skill, loose or in a pack, that an installed pack from the source holds to that pack", () => {
		expect(skillsInInstalledPacks(discovery, manifest, REPO)).toEqual(
			new Map([
				["skills/a", "owner/repo/tools"],
				["tools/skills/a", "owner/repo/tools"],
			]),
		);
	});

	it("leaves out a skill installed on its own", () => {
		expect(
			skillsInInstalledPacks(discovery, manifest, REPO).has("skills/b"),
		).toBe(false);
	});

	it("finds nothing in a pack from another source", () => {
		expect(
			skillsInInstalledPacks(discovery, manifest, {
				kind: "remote",
				cloneUrl: "https://github.com/other/repo.git",
			}).size,
		).toBe(0);
	});
});

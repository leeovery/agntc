import { describe, expect, it } from "vitest";
import {
	hookEntryName,
	identifyAssetType,
	isUnderRoot,
	skillFolderName,
	targetDir,
} from "../src/asset-targets.js";

describe("targetDir", () => {
	it("routes skills to .claude/skills", () => {
		expect(targetDir("skills")).toBe(".claude/skills");
	});

	it("routes agents to .claude/agents", () => {
		expect(targetDir("agents")).toBe(".claude/agents");
	});

	it("routes hooks to .claude/hooks", () => {
		expect(targetDir("hooks")).toBe(".claude/hooks");
	});
});

describe("identifyAssetType", () => {
	it("identifies a skill dir", () => {
		expect(identifyAssetType(".claude/skills/foo/")).toBe("skills");
	});

	it("identifies a file nested in a skill dir", () => {
		expect(identifyAssetType(".claude/skills/foo/SKILL.md")).toBe("skills");
	});

	it("identifies an agent file", () => {
		expect(identifyAssetType(".claude/agents/executor.md")).toBe("agents");
	});

	it("identifies a hook file", () => {
		expect(identifyAssetType(".claude/hooks/pre-commit.sh")).toBe("hooks");
	});

	it("returns null for a path outside the Claude target dirs", () => {
		expect(identifyAssetType(".agents/skills/foo/SKILL.md")).toBeNull();
		expect(identifyAssetType("some/random/file.txt")).toBeNull();
	});

	it("returns null for an empty path", () => {
		expect(identifyAssetType("")).toBeNull();
	});

	it("matches the target dir as a prefix, not a substring", () => {
		expect(identifyAssetType("foo/.claude/skills/bar")).toBeNull();
	});

	it("returns null for a sibling folder sharing the target dir's prefix", () => {
		expect(identifyAssetType(".claude/skillsX/foo")).toBeNull();
		expect(identifyAssetType(".claude/agentsfoo.md")).toBeNull();
		expect(identifyAssetType(".claude/hooks-old/x.sh")).toBeNull();
	});
});

describe("isUnderRoot", () => {
	it("holds for the root itself", () => {
		expect(isUnderRoot(".claude/skills", ".claude/skills")).toBe(true);
	});

	it("holds for a path below the root", () => {
		expect(isUnderRoot(".claude/skills/foo/", ".claude/skills")).toBe(true);
	});

	it("fails for a sibling sharing the root's prefix", () => {
		expect(isUnderRoot(".claude/skillsX/foo", ".claude/skills")).toBe(false);
	});
});

describe("skillFolderName", () => {
	it.each([
		[".claude/skills/foo/", "foo"],
		[".claude/skills/foo/SKILL.md", "foo"],
		[".claude/skills/foo/references/deep/guide.md", "foo"],
	])("names the skill folder %s is in", (path, name) => {
		expect(skillFolderName(path)).toBe(name);
	});

	it.each([
		[".claude/skills/README.md", "a loose file in .claude/skills"],
		[".claude/skills/", "the skills folder itself"],
		[".claude/skills/../x/", "a segment that isn't safe"],
		[".claude/skills//x", "an empty segment"],
		[".claude/skillsX/foo/", "a sibling sharing the prefix"],
		[".agents/skills/foo/", "a legacy skill root"],
		[".claude/agents/foo/", "another asset's folder"],
	])("is null for %s, %s", (path) => {
		expect(skillFolderName(path)).toBeNull();
	});
});

describe("hookEntryName", () => {
	it.each([
		[".claude/hooks/pre-commit.sh", "pre-commit.sh"],
		[".claude/hooks/lint/", "lint"],
		[".claude/hooks/lint/lib/util.sh", "lint"],
	])("names the top-level hook entry %s is or lies in", (path, name) => {
		expect(hookEntryName(path)).toBe(name);
	});

	it.each([
		[".claude/hooks/", "the hooks folder itself"],
		[".claude/hooks", "the hooks folder without its slash"],
		[".claude/hooks/../x", "a segment that isn't safe"],
		[".claude/hooksX/lint", "a sibling sharing the prefix"],
		[".claude/skills/lint/", "another asset's folder"],
	])("is null for %s, %s", (path) => {
		expect(hookEntryName(path)).toBeNull();
	});
});

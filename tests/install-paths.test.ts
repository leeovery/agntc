import {
	chmod,
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertNoLinkInTheWay,
	inspectInstallPath,
	isInstalledSkill,
	withoutTrailingSlash,
} from "../src/install-paths.js";

let base: string;
let projectDir: string;
let elsewhere: string;

beforeEach(async () => {
	base = await mkdtemp(join(tmpdir(), "agntc-install-paths-"));
	projectDir = join(base, "project");
	elsewhere = join(base, "elsewhere");
	await mkdir(join(projectDir, ".claude/skills"), { recursive: true });
	await mkdir(join(projectDir, ".claude/agents"), { recursive: true });
	await mkdir(elsewhere, { recursive: true });
	await writeFile(join(elsewhere, "SKILL.md"), "mine");
});

afterEach(async () => {
	await rm(base, { recursive: true, force: true });
});

async function link(relPath: string, target = elsewhere): Promise<void> {
	await symlink(target, join(projectDir, relPath));
}

describe("withoutTrailingSlash", () => {
	it("drops every trailing slash and nothing else", () => {
		expect(withoutTrailingSlash(".claude/skills/foo//")).toBe(
			".claude/skills/foo",
		);
		expect(withoutTrailingSlash(".claude/agents/x.md")).toBe(
			".claude/agents/x.md",
		);
	});
});

describe("inspectInstallPath", () => {
	it("is missing when nothing is there", async () => {
		expect(await inspectInstallPath(projectDir, ".claude/skills/foo/")).toEqual(
			{ kind: "missing" },
		);
	});

	it("is present for a real folder or file", async () => {
		await mkdir(join(projectDir, ".claude/skills/foo"));
		await writeFile(join(projectDir, ".claude/agents/x.md"), "");

		expect(await inspectInstallPath(projectDir, ".claude/skills/foo/")).toEqual(
			{ kind: "present", isDirectory: true },
		);
		expect(await inspectInstallPath(projectDir, ".claude/agents/x.md")).toEqual(
			{ kind: "present", isDirectory: false },
		);
	});

	it("reports a link at the path without following it, trailing slash or not", async () => {
		await link(".claude/skills/foo");

		for (const path of [".claude/skills/foo/", ".claude/skills/foo"]) {
			expect(await inspectInstallPath(projectDir, path)).toEqual({
				kind: "link",
				at: ".claude/skills/foo",
			});
		}
	});

	it("reports a dangling link as a link", async () => {
		await link(".claude/skills/foo", join(base, "gone"));

		expect(await inspectInstallPath(projectDir, ".claude/skills/foo/")).toEqual(
			{ kind: "link", at: ".claude/skills/foo" },
		);
	});

	it("reports a linked folder an item owns above the path", async () => {
		await link(".claude/agents/team");
		await writeFile(join(elsewhere, "lead.md"), "");

		expect(
			await inspectInstallPath(projectDir, ".claude/agents/team/lead.md"),
		).toEqual({ kind: "link", at: ".claude/agents/team" });
	});

	it("doesn't check the shared .claude/<asset> roots", async () => {
		await rm(join(projectDir, ".claude/skills"), { recursive: true });
		await mkdir(join(elsewhere, "foo"));
		await link(".claude/skills");

		expect(await inspectInstallPath(projectDir, ".claude/skills/foo/")).toEqual(
			{ kind: "present", isDirectory: true },
		);
	});
});

describe("assertNoLinkInTheWay", () => {
	it("passes when the target is missing or holds no link", async () => {
		await mkdir(join(projectDir, ".claude/skills/real/refs"), {
			recursive: true,
		});

		await expect(
			assertNoLinkInTheWay(projectDir, ".claude/skills/new/"),
		).resolves.toBeUndefined();
		await expect(
			assertNoLinkInTheWay(projectDir, ".claude/skills/real/"),
		).resolves.toBeUndefined();
	});

	it("refuses a link at the target", async () => {
		await link(".claude/skills/foo");

		await expect(
			assertNoLinkInTheWay(projectDir, ".claude/skills/foo/"),
		).rejects.toThrow(
			".claude/skills/foo is a symlink — agntc won't write through it",
		);
	});

	it("refuses a linked folder above the target", async () => {
		await link(".claude/agents/team");

		await expect(
			assertNoLinkInTheWay(projectDir, ".claude/agents/team/lead.md"),
		).rejects.toThrow(".claude/agents/team is a symlink");
	});

	it("refuses a link anywhere inside a folder already at the target", async () => {
		await mkdir(join(projectDir, ".claude/skills/foo/refs"), {
			recursive: true,
		});
		await link(".claude/skills/foo/refs/shared");

		await expect(
			assertNoLinkInTheWay(projectDir, ".claude/skills/foo/"),
		).rejects.toThrow(".claude/skills/foo/refs/shared is a symlink");
	});
});

describe("isInstalledSkill", () => {
	async function folder(name: string, files: string[] = []): Promise<void> {
		await mkdir(join(projectDir, ".claude/skills", name), { recursive: true });
		for (const file of files) {
			await writeFile(join(projectDir, ".claude/skills", name, file), "");
		}
	}

	it("is a skill when its folder holds a SKILL.md file", async () => {
		await folder("api", ["SKILL.md"]);

		expect(await isInstalledSkill(projectDir, "api")).toBe(true);
	});

	it("is a support folder when its real folder holds no SKILL.md, or only a folder of that name", async () => {
		await folder("refs", ["guide.md"]);
		await folder("odd");
		await mkdir(join(projectDir, ".claude/skills/odd/SKILL.md"));

		expect(await isInstalledSkill(projectDir, "refs")).toBe(false);
		expect(await isInstalledSkill(projectDir, "odd")).toBe(false);
	});

	it("is a skill when its SKILL.md is a link, whether or not the link leads anywhere", async () => {
		await folder("linked");
		await link(".claude/skills/linked/SKILL.md", join(elsewhere, "SKILL.md"));
		await folder("dangling");
		await link(".claude/skills/dangling/SKILL.md", join(base, "gone"));

		expect(await isInstalledSkill(projectDir, "linked")).toBe(true);
		expect(await isInstalledSkill(projectDir, "dangling")).toBe(true);
	});

	it("is a skill when the folder is a link, which it never follows", async () => {
		await mkdir(join(elsewhere, "notes"));
		await link(".claude/skills/shared", join(elsewhere, "notes"));

		expect(await isInstalledSkill(projectDir, "shared")).toBe(true);
	});

	it("is a skill when the folder is gone", async () => {
		expect(await isInstalledSkill(projectDir, "gone")).toBe(true);
	});

	it("is a skill, without throwing, when the folder can't be read", async () => {
		await folder("locked", ["guide.md"]);
		const locked = join(projectDir, ".claude/skills/locked");
		await chmod(locked, 0o000);

		try {
			expect(await isInstalledSkill(projectDir, "locked")).toBe(true);
		} finally {
			await chmod(locked, 0o755);
		}
	});

	it("is a skill, without throwing, for a name too long to probe or not one safe segment", async () => {
		expect(await isInstalledSkill(projectDir, "x".repeat(300))).toBe(true);
		expect(await isInstalledSkill(projectDir, "..")).toBe(true);
	});
});

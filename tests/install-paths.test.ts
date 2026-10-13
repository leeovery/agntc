import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	assertNoLinkInTheWay,
	inspectInstallPath,
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

import { execFile } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../..");
const SCRIPT = join(REPO, "scripts/declared-imports.mjs");

let root: string;

const PACKAGE = {
	dependencies: { commander: "^13", "@clack/core": "^0.5" },
	devDependencies: { vitest: "^3", "@xterm/headless": "^6" },
};

const PASSED = { status: 0, errors: "" };

function tree(files: Record<string, string>, manifest: object = PACKAGE) {
	writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "tests"), { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

/**
 * Runs the check on the root given, or on the repo's own without one. Async,
 * as a synchronous child starves the worker vitest talks to.
 */
async function check(
	...args: string[]
): Promise<{ status: number | null; errors: string }> {
	try {
		const { stderr } = await promisify(execFile)(process.execPath, [
			SCRIPT,
			...args,
		]);
		return { status: 0, errors: stderr };
	} catch (error) {
		const failed = error as { code: number | null; stderr: string };
		return { status: failed.code, errors: failed.stderr };
	}
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "agntc-imports-test-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("scripts/declared-imports.mjs", () => {
	it("passes this repo", async () => {
		expect(await check()).toEqual(PASSED);
	});

	it("fails this repo's src/ once @clack/core is dropped from package.json", async () => {
		const manifest = JSON.parse(
			readFileSync(join(REPO, "package.json"), "utf-8"),
		);
		delete manifest.dependencies["@clack/core"];
		cpSync(join(REPO, "src"), join(root, "src"), { recursive: true });
		tree({}, manifest);

		const { status, errors } = await check(root);

		expect(status).toBe(1);
		expect(errors).toContain(
			"src/terminal/prompts/engine.ts: imports @clack/core, which package.json's dependencies don't declare",
		);
	});

	it("passes dependencies in src/, either kind in tests/ and builtins", async () => {
		tree({
			"src/a.ts": [
				`import { Command } from "commander";`,
				`import { Prompt } from "@clack/core";`,
				`import { readFile } from "node:fs/promises";`,
				`import { join } from "path";`,
			].join("\n"),
			"tests/a.test.ts": [
				`import { it } from "vitest";`,
				`import { Terminal } from "@xterm/headless";`,
				`import { Command } from "commander";`,
			].join("\n"),
		});

		expect(await check(root)).toEqual(PASSED);
	});

	it.each([
		["a relative", "src/a.ts", "./b.js"],
		["a parent's", "src/sub/a.ts", "../c.js"],
		["src/'s, from tests/", "tests/a.test.ts", "../src/cli.js"],
		["a package import", "src/a.ts", "#internal/e"],
	])("passes %s path", async (_, file, specifier) => {
		tree({ [file]: `import x from "${specifier}";` });

		expect(await check(root)).toEqual(PASSED);
	});

	it.each([
		[
			"a file at the root, from src/",
			"src/a.ts",
			`import x from "../README.md";`,
		],
		[
			"tests/, from src/",
			"src/a.ts",
			`import { y } from "../tests/helpers/y.js";`,
		],
		[
			"design/, by a dynamic import",
			"src/sub/a.ts",
			`await import("../../design/x.js");`,
		],
		[
			"the root, by a require",
			"tests/a.test.ts",
			`require("../package.json");`,
		],
		["an absolute path", "src/a.ts", `import z from "/opt/lib/z.js";`],
	])("refuses a path outside the gates' folders: %s", async (_, file, line) => {
		tree({ [file]: line });

		const { status, errors } = await check(root);

		expect(status).toBe(1);
		expect(errors).toMatch(
			new RegExp(`^${file}: imports \\S+, which lies outside src/`),
		);
	});

	it("reduces a subpath to its package", async () => {
		tree({
			"src/a.ts": `import x from "@clack/core/dist/index.mjs";\nimport y from "commander/esm.mjs";`,
			"tests/a.test.ts": `import { defineConfig } from "vitest/config";`,
		});

		expect(await check(root)).toEqual(PASSED);
	});

	it("refuses a devDependency in src/", async () => {
		tree({ "src/a.ts": `import { it } from "vitest";` });

		expect(await check(root)).toEqual({
			status: 1,
			errors:
				"src/a.ts: imports vitest, which package.json's dependencies don't declare\n",
		});
	});

	it("refuses a package tests/ uses that neither list declares", async () => {
		tree({ "tests/helpers/a.ts": `import stringWidth from "string-width";` });

		expect(await check(root)).toEqual({
			status: 1,
			errors:
				"tests/helpers/a.ts: imports string-width, which package.json's dependencies or devDependencies don't declare\n",
		});
	});

	it.each([
		["import type", `import type { X } from "@scope/types";`],
		["a dynamic import", `const m = await import("@scope/lazy/sub");`],
		["a require", `const r = require("required");`],
		["an import-equals require", `import e = require("equals");`],
		["a re-export", `export { y } from "loose";`],
		["a bare import", `import "side-effect";`],
		["a subpath of an undeclared package", `import z from "commanderx/sub";`],
		["a node: name that isn't a builtin", `import q from "node:nothing";`],
	])("counts %s", async (_, line) => {
		tree({ "src/a.ts": line });

		expect((await check(root)).status).toBe(1);
	});

	it.each([
		".js",
		".mjs",
		".cjs",
		".jsx",
		".ts",
		".mts",
		".cts",
		".tsx",
	])("reads a %s file", async (extension) => {
		tree({ [`src/a${extension}`]: `import x from "undeclared";` });

		expect((await check(root)).status).toBe(1);
	});

	it("reads no other file", async () => {
		tree({
			"src/a.md": `import x from "undeclared";`,
			"src/a.json": `import x from "undeclared";`,
		});

		expect(await check(root)).toEqual(PASSED);
	});

	it("reads no import in a string or a comment", async () => {
		tree({
			"tests/a.test.ts": [
				'const text = `import { x } from "@clack/prompts";`;',
				`// import { y } from "left-pad";`,
				`/* export * from "gone"; */`,
			].join("\n"),
		});

		expect(await check(root)).toEqual(PASSED);
	});

	it.each([
		["file", "outside/a.ts", "src/a.ts"],
		["folder", "outside", "src/linked"],
	])("reads through a link to a %s", async (_, target, link) => {
		tree({ "outside/a.ts": `import x from "undeclared";` });
		symlinkSync(join(root, target), join(root, link));

		const { status, errors } = await check(root);

		expect(status).toBe(1);
		expect(errors).toContain(`${link}`);
	});

	it("ends at a link back up the tree", async () => {
		tree({ "src/a.ts": `import { Command } from "commander";` });
		symlinkSync(join(root, "src"), join(root, "src/loop"));

		expect(await check(root)).toEqual(PASSED);
	});
});

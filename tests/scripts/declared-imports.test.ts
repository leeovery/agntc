import { spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../..");
const SCRIPT = join(REPO, "scripts/declared-imports.mjs");

let root: string;

const PACKAGE = {
	dependencies: { commander: "^13", "@clack/core": "^0.5" },
	devDependencies: { vitest: "^3", "@xterm/headless": "^6" },
};

function tree(files: Record<string, string>, manifest: object = PACKAGE) {
	writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
	mkdirSync(join(root, "src"), { recursive: true });
	mkdirSync(join(root, "tests"), { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

function check(): { status: number | null; errors: string } {
	const result = spawnSync(process.execPath, [SCRIPT, root], {
		encoding: "utf-8",
	});
	return { status: result.status, errors: result.stderr };
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "agntc-imports-test-"));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("scripts/declared-imports.mjs", () => {
	it("passes this repo", () => {
		const result = spawnSync(process.execPath, [SCRIPT], {
			encoding: "utf-8",
		});

		expect(result.stderr).toBe("");
		expect(result.status).toBe(0);
	});

	it("fails this repo's src/ once @clack/core is dropped from package.json", () => {
		const manifest = JSON.parse(
			readFileSync(join(REPO, "package.json"), "utf-8"),
		);
		delete manifest.dependencies["@clack/core"];
		cpSync(join(REPO, "src"), join(root, "src"), { recursive: true });
		tree({}, manifest);

		const { status, errors } = check();

		expect(status).toBe(1);
		expect(errors).toContain(
			"src/terminal/prompts/engine.ts: imports @clack/core, which package.json's dependencies don't declare",
		);
	});

	it("passes dependencies in src/, either kind in tests/, builtins and relative paths", () => {
		tree({
			"src/a.ts": [
				`import { Command } from "commander";`,
				`import { Prompt } from "@clack/core";`,
				`import { readFile } from "node:fs/promises";`,
				`import { join } from "path";`,
				`import { b } from "./b.js";`,
				`import { c } from "../c.js";`,
			].join("\n"),
			"tests/a.test.ts": [
				`import { it } from "vitest";`,
				`import { Terminal } from "@xterm/headless";`,
				`import { Command } from "commander";`,
			].join("\n"),
		});

		expect(check()).toEqual({ status: 0, errors: "" });
	});

	it("reduces a subpath to its package", () => {
		tree({
			"src/a.ts": `import x from "@clack/core/dist/index.mjs";\nimport y from "commander/esm.mjs";`,
			"tests/a.test.ts": `import { defineConfig } from "vitest/config";`,
		});

		expect(check()).toEqual({ status: 0, errors: "" });
	});

	it("refuses a devDependency in src/", () => {
		tree({ "src/a.ts": `import { it } from "vitest";` });

		const { status, errors } = check();

		expect(status).toBe(1);
		expect(errors).toBe(
			"src/a.ts: imports vitest, which package.json's dependencies don't declare\n",
		);
	});

	it("refuses a package tests/ uses that neither list declares", () => {
		tree({ "tests/helpers/a.ts": `import stringWidth from "string-width";` });

		const { status, errors } = check();

		expect(status).toBe(1);
		expect(errors).toBe(
			"tests/helpers/a.ts: imports string-width, which package.json's dependencies or devDependencies don't declare\n",
		);
	});

	it.each([
		["import type", `import type { X } from "@scope/types";`],
		["a dynamic import", `const m = await import("@scope/lazy/sub");`],
		["a re-export", `export { y } from "loose";`],
		["a bare import", `import "side-effect";`],
		["a subpath of an undeclared package", `import z from "commanderx/sub";`],
		["a node: name that isn't a builtin", `import q from "node:nothing";`],
	])("counts %s", (_, line) => {
		tree({ "src/a.ts": line });

		expect(check().status).toBe(1);
	});

	it("reads no import in a string or a comment", () => {
		tree({
			"tests/a.test.ts": [
				'const text = `import { x } from "@clack/prompts";`;',
				`// import { y } from "left-pad";`,
				`/* export * from "gone"; */`,
			].join("\n"),
		});

		expect(check()).toEqual({ status: 0, errors: "" });
	});
});

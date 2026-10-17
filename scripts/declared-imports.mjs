#!/usr/bin/env node
//
// Fails on any package src/ or tests/ imports that package.json doesn't
// declare: src/ may import only `dependencies`, which tsup leaves external,
// so the published bundle needs them installed beside it; tests/ may import
// dependencies or devDependencies. Node's builtins, `node:` or bare, need
// no declaration. Every import counts, `import type`, `export … from` and
// `import("…")` among them, each reduced to its package (`@scope/pkg/x` to
// `@scope/pkg`, `pkg/x` to `pkg`). The other gates can't catch an
// undeclared import in a worktree: node, tsc, vite and esbuild resolve a
// package from every ancestor's node_modules, and agents' worktrees sit
// under the primary checkout's.
//
// Takes the repo root to check, this script's own by default.
import { readdirSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(process.argv[2] ?? join(dirname(process.argv[1]), ".."));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const dependencies = Object.keys(manifest.dependencies ?? {});
const devDependencies = Object.keys(manifest.devDependencies ?? {});

const folders = [
	{ folder: "src", allowed: new Set(dependencies), named: "dependencies" },
	{
		folder: "tests",
		allowed: new Set([...dependencies, ...devDependencies]),
		named: "dependencies or devDependencies",
	},
];

const SOURCE = /\.[cm]?[jt]sx?$/;

function sources(folder) {
	const dir = join(root, folder);
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile() && SOURCE.test(entry.name))
		.map((entry) => join(entry.parentPath, entry.name))
		.sort();
}

/** The package a bare specifier names; null for a relative, absolute or `#` one. */
function packageOf(specifier) {
	if (/^[./#]/.test(specifier)) {
		return null;
	}
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const undeclared = [];
for (const { folder, allowed, named } of folders) {
	for (const file of sources(folder)) {
		const { importedFiles } = ts.preProcessFile(
			readFileSync(file, "utf-8"),
			true,
			true,
		);
		for (const { fileName } of importedFiles) {
			const pkg = packageOf(fileName);
			if (pkg !== null && !isBuiltin(fileName) && !allowed.has(pkg)) {
				undeclared.push(
					`${relative(root, file)}: imports ${pkg}, which package.json's ${named} don't declare`,
				);
			}
		}
	}
}

if (undeclared.length > 0) {
	console.error(undeclared.join("\n"));
	process.exit(1);
}

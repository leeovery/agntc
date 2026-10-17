#!/usr/bin/env node
//
// Fails on any package src/ or tests/ imports that package.json doesn't
// declare: src/ may import only `dependencies`, which tsup leaves external,
// so the published bundle needs them installed beside it; tests/ may import
// dependencies or devDependencies. Node's builtins, `node:` or bare, need
// no declaration, nor does a relative, absolute or `#` specifier. Every
// import counts, `import type`, `export … from`, `import("…")` and
// `require("…")` among them, each reduced to its package (`@scope/pkg/x` to
// `@scope/pkg`, `pkg/x` to `pkg`), in every .js, .ts and .jsx/.tsx file,
// .mjs/.cjs/.mts/.cts included, links followed. No other gate sees src/
// import a devDependency: npm ci installs those, so typecheck, build and
// test all pass, and the published bundle then fails for its users.
//
// Takes the repo root to check, this script's own by default.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
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

/**
 * Every source file under `dir`, through links to files and folders alike,
 * as tsc and vitest read them; each real folder is entered once, so a link
 * back up the tree ends.
 */
function sources(dir, entered = new Set()) {
	const real = realpathSync(dir);
	if (entered.has(real)) {
		return [];
	}
	entered.add(real);
	const files = [];
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		const stats = statSync(path, { throwIfNoEntry: false });
		if (stats?.isDirectory()) {
			files.push(...sources(path, entered));
		} else if (stats?.isFile() && SOURCE.test(name)) {
			files.push(path);
		}
	}
	return files;
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
	for (const file of sources(join(root, folder))) {
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

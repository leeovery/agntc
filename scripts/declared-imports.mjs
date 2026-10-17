#!/usr/bin/env node
//
// Fails on an import src/ or tests/ shouldn't make.
//
// A package must be one package.json declares where it's used: src/ may
// import only `dependencies`, tests/ dependencies or devDependencies. tsup
// leaves `dependencies` external, for npm to install beside the bundle for
// every user, and bundles any other package it reaches, so a src/ import of
// a devDependency, or of a package npm only installs as another's, would
// pass every other gate while the package the user gets carries a copy npm
// won't keep up to date for them, or none, where it can't be bundled. Node's
// builtins, `node:` or bare, need no declaration. Each package is named
// from its specifier (`@scope/pkg/x` to `@scope/pkg`, `pkg/x` to `pkg`).
//
// A path must stay inside the folders the gates read: from src/, inside
// src/; from tests/, inside src/ or tests/. Anything else at the root is
// inert to scripts/gated, which passes a commit changing only such paths
// without running the gates. `#` specifiers resolve through package.json's
// imports, which a gate reads, so they pass.
//
// Every import counts, `import type`, `export … from`, `import("…")` and
// `require("…")` among them, in every .js, .ts and .jsx/.tsx file,
// .mjs/.cjs/.mts/.cts included, links followed.
//
// Takes the repo root to check, this script's own by default.
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const root = resolve(process.argv[2] ?? join(dirname(process.argv[1]), ".."));
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const dependencies = Object.keys(manifest.dependencies ?? {});
const devDependencies = Object.keys(manifest.devDependencies ?? {});

const folders = [
	{
		folder: "src",
		packages: new Set(dependencies),
		packagesNamed: "package.json's dependencies don't declare",
		within: ["src"],
		withinNamed: "src/",
	},
	{
		folder: "tests",
		packages: new Set([...dependencies, ...devDependencies]),
		packagesNamed:
			"package.json's dependencies or devDependencies don't declare",
		within: ["src", "tests"],
		withinNamed: "src/ and tests/",
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

/** Whether the path given lies inside one of the folders named, under the root. */
function inside(path, within) {
	return within.some((folder) => path.startsWith(join(root, folder) + sep));
}

/** What's wrong with one import from the file given, or null. */
function fault(file, specifier, rules) {
	if (/^[./]/.test(specifier)) {
		const target = resolve(dirname(file), specifier);
		return inside(target, rules.within)
			? null
			: `imports ${specifier}, which lies outside ${rules.withinNamed}`;
	}
	const pkg = packageOf(specifier);
	if (pkg === null || isBuiltin(specifier) || rules.packages.has(pkg)) {
		return null;
	}
	return `imports ${pkg}, which ${rules.packagesNamed}`;
}

const faults = [];
for (const rules of folders) {
	for (const file of sources(join(root, rules.folder))) {
		const { importedFiles } = ts.preProcessFile(
			readFileSync(file, "utf-8"),
			true,
			true,
		);
		for (const { fileName } of importedFiles) {
			const found = fault(file, fileName, rules);
			if (found !== null) {
				faults.push(`${relative(root, file)}: ${found}`);
			}
		}
	}
}

if (faults.length > 0) {
	console.error(faults.join("\n"));
	process.exit(1);
}

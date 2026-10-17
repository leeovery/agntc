#!/usr/bin/env node
//
// Fails on an import src/ or tests/ shouldn't make, or a link they hold to
// somewhere they shouldn't reach.
//
// A package must be one package.json declares where it's used: src/ may
// import only `dependencies`, tests/ and the config files the gates load
// (vitest.config.ts, tsup.config.ts) dependencies or devDependencies. tsup
// leaves `dependencies` external, for npm to install beside the bundle for
// every user, and bundles any other package it reaches, so a src/ import of
// a devDependency, or of a package npm only installs as another's, would
// pass every other gate while the package the user gets carries a copy npm
// won't keep up to date for them, or none, where it can't be bundled. Node's
// builtins, `node:` or bare, need no declaration. Each package is named
// from its specifier (`@scope/pkg/x` to `@scope/pkg`, `pkg/x` to `pkg`); a
// `/// <reference types>` names one too, declared as itself or as its
// @types package. A `/// <reference lib>` names one of TypeScript's own
// libraries, which need no declaration.
//
// A path must stay inside the folders the gates read: from src/, inside
// src/; from tests/ and the config files, inside src/ or tests/. Anything
// else at the root is inert to scripts/gated, which passes a commit
// changing only such paths without running the gates. That covers every
// relative or absolute import and `/// <reference path>`, and every file and
// folder under src/ and tests/, whose real path, through any link, must
// lie inside them as well. `#` specifiers resolve through package.json's
// imports, which a gate reads, so they pass. A path held in any other
// string, `vi.mock("…")`, `new URL("…", import.meta.url)` or
// `import.meta.glob("…")` among them, isn't read here; scripts/gated's rule
// covers those, and review keeps it.
//
// Every import counts, `import type`, `export … from`, `import("…")` and
// `require("…")` among them, in every .js, .ts and .jsx/.tsx file,
// .mjs/.cjs/.mts/.cts included, links followed.
//
// Takes the repo root to check, this script's own by default.
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
} from "node:fs";
import { isBuiltin } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";

const root = resolve(process.argv[2] ?? join(dirname(process.argv[1]), ".."));
const realRoot = realpathSync(root);
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const dependencies = Object.keys(manifest.dependencies ?? {});
const devDependencies = Object.keys(manifest.devDependencies ?? {});

const DEV = {
	packages: new Set([...dependencies, ...devDependencies]),
	packagesNamed: "package.json's dependencies or devDependencies don't declare",
	within: ["src", "tests"],
	withinNamed: "src/ and tests/",
};

const RULES = [
	{
		folder: "src",
		packages: new Set(dependencies),
		packagesNamed: "package.json's dependencies don't declare",
		within: ["src"],
		withinNamed: "src/",
	},
	{ folder: "tests", ...DEV },
];

const CONFIGS = ["vitest.config.ts", "tsup.config.ts"];

const SOURCE = /\.[cm]?[jt]sx?$/;

/** Whether the path given is, or lies inside, one of the folders named. */
function inside(path, within, base) {
	return within.some((folder) => {
		const top = join(base, folder);
		return path === top || path.startsWith(top + sep);
	});
}

/**
 * Every source file under `dir`, through links to files and folders alike,
 * as tsc and vitest read them, each real folder entered once, so a link
 * back up the tree ends; and a fault for each entry whose real path lies
 * outside the folders the rules allow.
 */
function walk(dir, rules, found, entered = new Set()) {
	const real = realpathSync(dir);
	if (entered.has(real)) {
		return;
	}
	entered.add(real);
	for (const name of readdirSync(dir).sort()) {
		const path = join(dir, name);
		const stats = statSync(path, { throwIfNoEntry: false });
		if (!stats) {
			continue;
		}
		const target = realpathSync(path);
		if (!inside(target, rules.within, realRoot)) {
			found.faults.push(
				`${relative(root, path)}: links to ${target}, which lies outside ${rules.withinNamed}`,
			);
		} else if (stats.isDirectory()) {
			walk(path, rules, found, entered);
		} else if (stats.isFile() && SOURCE.test(name)) {
			found.files.push(path);
		}
	}
}

/** The package a bare specifier names; null for a relative, absolute or `#` one. */
function packageOf(specifier) {
	if (/^[./#]/.test(specifier)) {
		return null;
	}
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/** The @types package that carries the types of the package named. */
function typesOf(pkg) {
	return `@types/${pkg.replace(/^@/, "").replace("/", "__")}`;
}

/** What's wrong with a path one file names, or null. */
function pathFault(file, specifier, rules) {
	const target = resolve(dirname(file), specifier);
	return inside(target, rules.within, root)
		? null
		: `names ${specifier}, which lies outside ${rules.withinNamed}`;
}

/** What's wrong with one import from the file given, or null. */
function importFault(file, specifier, rules) {
	if (/^[./]/.test(specifier)) {
		return pathFault(file, specifier, rules);
	}
	const pkg = packageOf(specifier);
	if (pkg === null || isBuiltin(specifier) || rules.packages.has(pkg)) {
		return null;
	}
	return `imports ${pkg}, which ${rules.packagesNamed}`;
}

/** What's wrong with a `/// <reference types>`, or null. */
function typesFault(name, rules) {
	const pkg = packageOf(name) ?? name;
	return rules.packages.has(pkg) || rules.packages.has(typesOf(pkg))
		? null
		: `references the types of ${name}, which ${rules.packagesNamed}`;
}

/** Every fault in one file under the rules given. */
function faultsOf(file, rules) {
	const { importedFiles, referencedFiles, typeReferenceDirectives } =
		ts.preProcessFile(readFileSync(file, "utf-8"), true, true);
	return [
		...importedFiles.map(({ fileName }) => importFault(file, fileName, rules)),
		...referencedFiles.map(({ fileName }) => pathFault(file, fileName, rules)),
		...typeReferenceDirectives.map(({ fileName }) =>
			typesFault(fileName, rules),
		),
	]
		.filter((fault) => fault !== null)
		.map((fault) => `${relative(root, file)}: ${fault}`);
}

const faults = [];
for (const rules of RULES) {
	const found = { files: [], faults };
	walk(join(root, rules.folder), rules, found);
	for (const file of found.files) {
		faults.push(...faultsOf(file, rules));
	}
}
for (const config of CONFIGS) {
	const file = join(root, config);
	if (existsSync(file)) {
		faults.push(...faultsOf(file, DEV));
	}
}

if (faults.length > 0) {
	console.error(faults.join("\n"));
	process.exit(1);
}

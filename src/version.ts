import { readFileSync } from "node:fs";

// Read the version from the installed package.json at RUNTIME (not an import — tsup
// would inline that at build time). package.json is the single source of truth: the
// publish workflow stamps it from the release tag, so the CLI always reports the
// version of the package it's actually running from. No tags, no network — one local
// file read at startup. Falls back to the placeholder if the read ever fails.
const DEV_PLACEHOLDER = "0.0.0-development";

function readVersion(): string {
	try {
		const pkg = JSON.parse(
			readFileSync(new URL("../package.json", import.meta.url), "utf8"),
		) as { version?: string };
		return pkg.version ?? DEV_PLACEHOLDER;
	} catch {
		return DEV_PLACEHOLDER;
	}
}

export const VERSION = readVersion();

// The unpublished placeholder is honest for `--version` but noise in the banner —
// hide it there, show it everywhere it's a real release.
export const BANNER_VERSION = VERSION === DEV_PLACEHOLDER ? undefined : VERSION;

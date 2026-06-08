import { basename } from "node:path";
import { isCancel, log, multiselect } from "@clack/prompts";
import type { Manifest } from "./manifest.js";

interface SelectCollectionPluginsInput {
	plugins: string[];
	manifest: Manifest;
	manifestKeyPrefix: string;
}

export async function selectCollectionPlugins(
	input: SelectCollectionPluginsInput,
): Promise<string[]> {
	if (input.plugins.length === 0) {
		return [];
	}

	const options = input.plugins.map((segment) => {
		// A member's array element is its dir-relative segment (e.g. "alpha" for a
		// root-child member, "skills/a" for a skills-only inner skill). Identity —
		// the menu label AND the manifest-key segment — is always the basename, so
		// a skills-only member shows/keys "a", not "skills/a". For root-child
		// members the basename is the segment, so this is a no-op for them.
		const name = basename(segment);
		const key = `${input.manifestKeyPrefix}/${name}`;
		const isInstalled = key in input.manifest;
		return {
			value: segment,
			label: name,
			...(isInstalled ? { hint: "installed" } : {}),
		};
	});

	const result = await multiselect<string>({
		message: "Select plugins to install",
		options,
		required: false,
	});

	if (isCancel(result)) {
		return [];
	}

	if (result.length === 0) {
		log.info("No plugins selected — skipping");
		return [];
	}

	return result;
}

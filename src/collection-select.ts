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

	const options = input.plugins.map((name) => {
		const key = `${input.manifestKeyPrefix}/${name}`;
		const isInstalled = key in input.manifest;
		return {
			value: name,
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

import type { InstallItem } from "./install-item.js";
import type { Row } from "./terminal/types.js";
import type { Block, Choice } from "./ui.js";

/** Asks which items to install, under the source's row. A cancel picks nothing. */
export async function promptForItems(
	choices: readonly Choice<InstallItem>[],
	source: Row,
	block: Block,
): Promise<InstallItem[]> {
	const picked = await block.multiselect<number>(source, {
		message: "Select what to install",
		options: choices.map(({ value: _, ...shown }, index) => ({
			value: index,
			...shown,
		})),
		required: false,
	});
	return choices
		.filter((_, index) => picked.includes(index))
		.map(({ value }) => value);
}

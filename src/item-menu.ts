import type { MenuOption } from "./choose-items.js";
import type { InstallItem } from "./install-item.js";
import type { Row } from "./terminal/types.js";
import type { Block } from "./ui.js";

/** Asks which items to install, under the source's row. A cancel picks nothing. */
export async function promptForItems(
	options: MenuOption[],
	source: Row,
	block: Block,
): Promise<InstallItem[]> {
	const picked = await block.multiselect<number>(source, {
		message: "Select what to install",
		options: options.map(({ label, hint }, index) => ({
			value: index,
			label,
			...(hint !== undefined ? { hint } : {}),
		})),
		required: false,
	});
	return options
		.filter((_, index) => picked.includes(index))
		.map(({ value }) => value);
}

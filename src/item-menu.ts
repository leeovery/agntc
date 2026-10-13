import { isCancel, multiselect } from "@clack/prompts";
import type { MenuOption } from "./choose-items.js";
import type { InstallItem } from "./install-item.js";

/** Asks which items to install. A cancel picks nothing. */
export async function promptForItems(
	options: MenuOption[],
): Promise<InstallItem[]> {
	const picked = await multiselect<number>({
		message: "Select what to install",
		options: options.map(({ label, hint }, index) => ({
			value: index,
			label,
			...(hint !== undefined ? { hint } : {}),
		})),
		required: false,
	});
	if (isCancel(picked)) {
		return [];
	}
	return options
		.filter((_, index) => picked.includes(index))
		.map(({ value }) => value);
}

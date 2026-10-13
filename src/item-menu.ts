import type { MenuOption } from "./choose-items.js";
import type { InstallItem } from "./install-item.js";
import type { Ui } from "./ui.js";

/** Asks which items to install. A cancel picks nothing. */
export async function promptForItems(
	options: MenuOption[],
	ui: Ui,
): Promise<InstallItem[]> {
	const picked = await ui.multiselect<number>({
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

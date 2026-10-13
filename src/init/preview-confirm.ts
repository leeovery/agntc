import type { Ui } from "../ui.js";
import type { ScaffoldFile } from "./scaffold-utils.js";

export async function previewAndConfirm(
	files: ScaffoldFile[],
	ui: Ui,
): Promise<boolean> {
	ui.box(previewTree(files.map(({ path }) => path)), "This will create:");

	return ui.confirm({ message: "Proceed?" });
}

/** Each folder once, before its first file, everything indented by depth. */
export function previewTree(paths: string[]): string {
	const lines: string[] = [];
	const shown = new Set<string>();
	for (const path of paths) {
		const segments = path.split("/");
		segments.forEach((segment, depth) => {
			const isFolder = depth < segments.length - 1;
			const key = segments.slice(0, depth + 1).join("/");
			if (!shown.has(key)) {
				shown.add(key);
				lines.push(`${"  ".repeat(depth + 1)}${segment}${isFolder ? "/" : ""}`);
			}
		});
	}
	return lines.join("\n");
}

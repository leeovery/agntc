import {
	isNarrow,
	MARGIN,
	roomFrom,
	spread,
	truncateStart,
	visibleWidth,
} from "./layout.js";
import type { Style } from "./style.js";
import type { Header } from "./types.js";

/** The least of `where` worth showing once it's cut; shorter, the right side goes. */
const MIN_WHERE = 12;
const GAP = 2;

/** ` ■ agntc <command>`, with where it installs and the version dim on the right. */
export function renderHeader(
	header: Header,
	width: number,
	style: Style,
): string[] {
	const left = `${MARGIN}${style.accent("■")} ${style.bold("agntc")} ${header.command}`;
	const right = isNarrow(width)
		? undefined
		: rightSide(header, roomFrom(visibleWidth(left) + GAP, width));
	if (right === undefined) {
		return [left];
	}
	return [spread(left, style.dim(right), width) ?? left];
}

function rightSide(header: Header, room: number): string | undefined {
	const version =
		header.version === undefined ? undefined : `v${header.version}`;
	const full = [header.where, version]
		.filter((part) => part !== undefined)
		.join(" · ");
	if (full === "") {
		return undefined;
	}
	if (visibleWidth(full) <= room) {
		return full;
	}
	if (header.where === undefined) {
		return undefined;
	}
	const suffix = version === undefined ? "" : ` · ${version}`;
	const whereRoom = room - visibleWidth(suffix);
	return whereRoom < MIN_WHERE
		? undefined
		: truncateStart(header.where, whereRoom) + suffix;
}

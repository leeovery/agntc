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

/**
 * Where it installs and the version, as much as fits: both whole, else where
 * cut from the left (down to {@link MIN_WHERE}), else the version alone,
 * which {@link spread} leaves out when even that doesn't fit.
 */
function rightSide(header: Header, room: number): string | undefined {
	const version =
		header.version === undefined ? undefined : `v${header.version}`;
	const suffix = version === undefined ? "" : ` · ${version}`;
	const where = whereWithin(header.where, room - visibleWidth(suffix));
	return where === undefined ? version : where + suffix;
}

function whereWithin(
	where: string | undefined,
	room: number,
): string | undefined {
	if (where === undefined || visibleWidth(where) <= room) {
		return where;
	}
	return room < MIN_WHERE ? undefined : truncateStart(where, room);
}

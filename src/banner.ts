import { createStyle, detectColorLevel, type Style } from "./terminal/style.js";

/**
 * "ANSI Shadow" rendering of AGNTC. The font is uppercase-only; solid block
 * glyphs read far better than thin outline art, which is why this is the
 * standard modern-CLI banner look.
 */
const BANNER_LINES = [
	" █████╗  ██████╗ ███╗   ██╗████████╗ ██████╗",
	"██╔══██╗██╔════╝ ████╗  ██║╚══██╔══╝██╔════╝",
	"███████║██║  ███╗██╔██╗ ██║   ██║   ██║     ",
	"██╔══██║██║   ██║██║╚██╗██║   ██║   ██║     ",
	"██║  ██║╚██████╔╝██║ ╚████║   ██║   ╚██████╗",
	"╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝    ╚═════╝",
];

const TAGLINE = "agent skills installer for claude";

const INDENT = "  ";

/** A run of blocks, or of the shadow drawn round them. */
const RUN = /█+|[^█ ]+/g;

/** The style stdout takes: colour off when it isn't a terminal or `NO_COLOR` says so. */
function stdoutStyle(): Style {
	return createStyle(
		detectColorLevel(process.env, process.stdout.isTTY === true),
	);
}

/**
 * Two-tone: the blocks in the accent, the box-drawing shadow dimmed, so the
 * glyphs stand out rather than reading as a flat slab.
 */
function colorizeLine(line: string, style: Style): string {
	return line.replace(RUN, (run) =>
		run.startsWith("█") ? style.accent(run) : style.dim(style.accent(run)),
	);
}

/**
 * The full landing banner: blank line, art, blank line, tagline (+ version when
 * given). `version` is omitted for the unpublished dev placeholder, so the tagline
 * drops the version suffix rather than showing noise.
 */
export function renderBanner(
	version?: string,
	style: Style = stdoutStyle(),
): string {
	const art = BANNER_LINES.map((line) => INDENT + colorizeLine(line, style));
	const versionSuffix = version ? `  ${style.dim(`v${version}`)}` : "";
	const tagline = `${INDENT}${style.dim(TAGLINE)}${versionSuffix}`;
	return ["", ...art, "", tagline, ""].join("\n");
}

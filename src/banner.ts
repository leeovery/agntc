import pc from "picocolors";

/**
 * "ANSI Shadow" rendering of AGNTC. The font is uppercase-only; solid block
 * glyphs read far better than thin outline art, which is why this is the
 * standard modern-CLI banner look. picocolors auto-strips color for non-TTY /
 * NO_COLOR, so piping `agntc | cat` yields clean text.
 */
const BANNER_LINES = [
	" █████╗  ██████╗ ███╗   ██╗████████╗ ██████╗",
	"██╔══██╗██╔════╝ ████╗  ██║╚══██╔══╝██╔════╝",
	"███████║██║  ███╗██╔██╗ ██║   ██║   ██║     ",
	"██╔══██║██║   ██║██║╚██╗██║   ██║   ██║     ",
	"██║  ██║╚██████╔╝██║ ╚████║   ██║   ╚██████╗",
	"╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝   ╚═╝    ╚═════╝",
];

const TAGLINE = "agent skills installer for claude · codex · cursor";

const INDENT = "  ";

// Two-tone: full blocks bright cyan, box-drawing "shadow" chars dimmed — the
// look that makes the glyphs pop instead of reading as a flat slab.
function colorizeLine(line: string): string {
	let out = "";
	for (const ch of line) {
		if (ch === "█") {
			out += pc.cyan(ch);
		} else if (ch !== " ") {
			out += pc.dim(pc.cyan(ch));
		} else {
			out += ch;
		}
	}
	return out;
}

/**
 * The full landing banner: blank line, art, blank line, tagline (+ version when
 * given). `version` is omitted for the unpublished dev placeholder, so the tagline
 * drops the version suffix rather than showing noise.
 */
export function renderBanner(version?: string): string {
	const art = BANNER_LINES.map((line) => INDENT + colorizeLine(line));
	const versionSuffix = version ? `  ${pc.gray(`v${version}`)}` : "";
	const tagline = `${INDENT}${pc.dim(TAGLINE)}${versionSuffix}`;
	return ["", ...art, "", tagline, ""].join("\n");
}

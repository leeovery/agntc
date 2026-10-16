import { describe, expect, it } from "vitest";
import type { Message, Step } from "../../src/message.js";
import { blockLayout, renderRow } from "../../src/terminal/block.js";
import { renderCancel, renderClose } from "../../src/terminal/close.js";
import { renderHeader } from "../../src/terminal/header.js";
import { visibleWidth } from "../../src/terminal/layout.js";
import { type MessageKind, renderMessage } from "../../src/terminal/message.js";
import { renderNext } from "../../src/terminal/next.js";
import { createStyle } from "../../src/terminal/style.js";
import type {
	NextItem,
	Row,
	Status,
	TallyItem,
} from "../../src/terminal/types.js";

// The one rule: no line reaches the last column. Commands are exempt, as
// they're never wrapped or cut.

const WIDTHS = [40, 59, 60, 80, 100];
const LONG =
	"owner/a-very-long-repository-name-that-keeps-going-and-going-past-any-column";
const WORD = "x".repeat(150);
const PROSE =
	"it would remove macos-hig, which is still in the source but would no longer be installed, so the install is left unchanged";
const CJK = "日本語のスキル集リポジトリ名前がとても長い";
const LONG_META = "feature/a-very-long-branch-name-that-is-the-intent";
const COMMANDS = [
	`npx agntc add ${LONG} --skill a-skill-with-a-long-name-too`,
	"npx agntc remove owner/repo/macos",
];

const subjects = [
	"",
	"a",
	"owner/alpha",
	LONG,
	WORD,
	CJK,
	"rshankras/claude-code-apple-skills",
];
const metas = [undefined, "", "^1.4.0", "^0.10.12", LONG_META, WORD];
const details: Row["detail"][] = [
	undefined,
	"",
	"up to date",
	PROSE,
	WORD,
	CJK,
	{ move: { from: "v0.10.12", to: "v0.11.0" } },
	{ move: { from: "v0.10.12", to: "v0.11.0" }, note: "not applied" },
	{ move: { from: "v1.4.0", to: "v1.5.0" }, note: PROSE },
	{ move: { from: LONG, to: WORD } },
];
const statuses: Status[] = [
	"done",
	"unchanged",
	"attention",
	"failed",
	"subject",
	"newer",
	"note",
];

function rowsMatrix(): Row[] {
	return subjects.flatMap((subject, s) =>
		metas.flatMap((meta, m) =>
			details.map((detail, d) => ({
				status: statuses[(s + m + d) % statuses.length] as Status,
				subject,
				meta,
				detail,
				children: [
					{ name: "one", detail: "skill" },
					{ name: "", detail: "" },
					{ name: LONG, status: "failed" as const, detail: PROSE },
					{ name: CJK, status: "done" as const, detail: CJK },
					{ name: "laravel", status: "attention" as const, detail: WORD },
				].slice(0, (s + d) % 6),
			})),
		),
	);
}

const steps: Step[] = [
	{ command: COMMANDS[0] as string },
	{ choice: COMMANDS },
	{ words: PROSE },
	{ words: WORD },
];
const messages: Message[] = [
	"",
	PROSE,
	WORD,
	CJK,
	{
		text: PROSE,
		cause: `fatal: unable to access 'https://github.com/${LONG}.git/': ${PROSE}`,
		plain: "",
	},
	{ text: "", cause: "", remedy: { lead: "", steps }, plain: "" },
	{ text: WORD, remedy: { lead: PROSE, steps }, plain: "" },
];
const nextItems: NextItem[] = [
	{ subject: "macos", remedy: { lead: "To update it anyway:", steps } },
	{ subject: LONG, remedy: { lead: PROSE, steps } },
	{ subject: WORD, remedy: { lead: "", steps } },
	{ subject: "", remedy: { lead: WORD, steps } },
	{ subject: CJK, remedy: { lead: CJK, steps } },
];
const tally: TallyItem[] = [
	{ count: 3, label: "updated", status: "done" },
	{ count: 12, label: "up to date", status: "unchanged" },
	{ count: 1, label: "not checked", status: "attention" },
	{ count: 0, label: "kept", status: "attention" },
	{ count: 1, label: PROSE, status: "failed" },
	{ count: 2, label: WORD, status: "newer" },
];

function renderAll(width: number, level: 0 | 3): string[] {
	const style = createStyle(level);
	const rows = rowsMatrix();
	const together = blockLayout(rows, width);
	return [
		...rows.flatMap((row) => renderRow(row, together, width, style)),
		...rows.flatMap((row) =>
			renderRow(row, blockLayout([row], width), width, style),
		),
		...(["warn", "note", "error"] as MessageKind[]).flatMap((kind) =>
			messages.flatMap((message) => renderMessage(kind, message, width, style)),
		),
		...renderNext(nextItems, width, style),
		...renderClose(tally, 72_000, width, style),
		...renderClose(tally.slice(0, 3), 2400, width, style),
		...renderClose([], 2400, width, style),
		...renderHeader(
			{ command: "update", where: LONG, version: "0.5.3" },
			width,
			style,
		),
		...renderHeader(
			{ command: "update", where: CJK, version: WORD },
			width,
			style,
		),
		...renderCancel(width, style),
		...renderCancel(width, style, PROSE),
		...renderCancel(width, style, WORD),
	];
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching SGR escape codes
const stripSgr = (line: string) => line.replace(/\x1b\[[0-9;]*m/g, "");
const isCommand = (line: string) => COMMANDS.includes(stripSgr(line).trim());

describe("every line fits", () => {
	for (const width of WIDTHS) {
		for (const level of [0, 3] as const) {
			it(`at ${width} columns, colour level ${level}`, () => {
				const lines = renderAll(width, level).filter(
					(line) => !isCommand(line),
				);
				const over = lines.filter((line) => visibleWidth(line) > width - 1);
				const trailing = lines.filter((line) => /\s$/.test(stripSgr(line)));
				expect(over).toEqual([]);
				expect(trailing).toEqual([]);
			});
		}
	}

	it("prints commands whole, on lines of their own", () => {
		const lines = renderAll(40, 0).map((line) => line.trim());
		for (const command of COMMANDS) {
			expect(lines).toContain(command);
		}
	});
});

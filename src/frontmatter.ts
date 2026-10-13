import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface SkillFrontmatter {
	name?: string;
	description?: string;
}

type FrontmatterKey = keyof SkillFrontmatter;

interface Entry {
	key: string;
	rest: string;
	continuation: string[];
}

const DELIMITER = "---";
const KEY_LINE = /^([\w-]+):(?:[ \t]+(.*))?$/;
const BLOCK_HEADER = /^([|>])[-+]?(?:[ \t]+#.*)?$/;
const DOUBLE_QUOTED = /^"((?:[^"\\]|\\.)*)"/s;
const SINGLE_QUOTED = /^'((?:[^']|'')*)'/s;
const COMMENT = /(?:^|[ \t])#.*$/;
const COLLECTION_LINE = /^(?:-(?:\s|$)|[\w-]+:(?:\s|$))/;
const ESCAPES: Record<string, string> = {
	n: "\n",
	t: "\t",
	r: "\r",
	"0": "\0",
};

/**
 * Lenient reader of `<skillDir>/SKILL.md` frontmatter: a missing or unreadable
 * file yields `{}`, never a throw.
 */
export async function readSkillFrontmatter(
	skillDir: string,
): Promise<SkillFrontmatter> {
	let content: string;
	try {
		content = await readFile(join(skillDir, "SKILL.md"), "utf-8");
	} catch {
		return {};
	}
	return parseFrontmatter(content);
}

/**
 * Reads `name` and `description` from a leading `---` block. Not a YAML parser:
 * it understands the scalar shapes skill authors write and drops anything it
 * can't read rather than throwing.
 */
export function parseFrontmatter(content: string): SkillFrontmatter {
	const block = extractBlock(content);
	const result: SkillFrontmatter = {};
	for (const entry of groupEntries(block ?? [])) {
		if (!isFrontmatterKey(entry.key)) {
			continue;
		}
		const value = parseValue(entry)?.trim();
		if (value) {
			result[entry.key] = value;
		}
	}
	return result;
}

function extractBlock(content: string): string[] | null {
	const lines = content.replace(/^﻿/, "").split(/\r?\n/);
	if (lines[0]?.trimEnd() !== DELIMITER) {
		return null;
	}
	const end = lines.findIndex(
		(line, index) => index > 0 && line.trimEnd() === DELIMITER,
	);
	return end === -1 ? null : lines.slice(1, end);
}

/**
 * Splits the block into top-level `key: rest` entries, each owning the
 * indented or blank lines that follow it. Nested maps therefore stay inside
 * their parent key and never surface as top-level keys.
 */
function groupEntries(lines: string[]): Entry[] {
	const entries: Entry[] = [];
	let current: Entry | undefined;
	for (const line of lines) {
		if (current && isContinuation(line)) {
			current.continuation.push(line);
			continue;
		}
		current = toEntry(line);
		if (current) {
			entries.push(current);
		}
	}
	return entries;
}

function toEntry(line: string): Entry | undefined {
	const match = KEY_LINE.exec(line);
	if (!match?.[1]) {
		return undefined;
	}
	return { key: match[1], rest: (match[2] ?? "").trim(), continuation: [] };
}

function isContinuation(line: string): boolean {
	return line.trim() === "" || /^\s/.test(line);
}

function isFrontmatterKey(key: string): key is FrontmatterKey {
	return key === "name" || key === "description";
}

function parseValue({ rest, continuation }: Entry): string | undefined {
	if (rest.startsWith("|") || rest.startsWith(">")) {
		return parseBlockScalar(rest, continuation);
	}
	if (rest.startsWith('"')) {
		return parseDoubleQuoted(foldLines([rest, ...continuation]));
	}
	if (rest.startsWith("'")) {
		return parseSingleQuoted(foldLines([rest, ...continuation]));
	}
	return parsePlain(rest, continuation);
}

function parseBlockScalar(header: string, lines: string[]): string | undefined {
	const style = BLOCK_HEADER.exec(header)?.[1];
	if (style === undefined) {
		return undefined;
	}
	if (style === ">") {
		return foldLines(lines);
	}
	const indent = blockIndent(lines);
	return lines.map((line) => line.slice(indent)).join("\n");
}

function blockIndent(lines: string[]): number {
	const first = lines.find((line) => line.trim() !== "") ?? "";
	return first.length - first.trimStart().length;
}

function parseDoubleQuoted(text: string): string | undefined {
	const body = DOUBLE_QUOTED.exec(text)?.[1];
	return body?.replace(/\\(.)/gs, (_, char: string) => ESCAPES[char] ?? char);
}

function parseSingleQuoted(text: string): string | undefined {
	return SINGLE_QUOTED.exec(text)?.[1]?.replaceAll("''", "'");
}

function parsePlain(rest: string, continuation: string[]): string | undefined {
	if (rest === "" && startsCollection(continuation)) {
		return undefined;
	}
	return foldLines(
		[rest, ...continuation].map((line) => line.replace(COMMENT, "")),
	);
}

function startsCollection(lines: string[]): boolean {
	const first = lines.find((line) => line.trim() !== "");
	return first !== undefined && COLLECTION_LINE.test(first.trim());
}

/**
 * YAML line folding: adjacent lines join with a space, and each run of blank
 * lines after text becomes that many newlines.
 */
function foldLines(lines: string[]): string {
	let text = "";
	let afterBreak = true;
	for (const raw of lines) {
		const line = raw.trim();
		if (line === "") {
			text += text === "" ? "" : "\n";
			afterBreak = true;
			continue;
		}
		text += afterBreak ? line : ` ${line}`;
		afterBreak = false;
	}
	return text;
}

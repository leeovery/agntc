import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runRemove } from "../../src/commands/remove.js";
import { ExitSignal } from "../../src/exit-signal.js";
import type { ManifestEntry } from "../../src/manifest.js";
import { projectScope } from "../../src/scope.js";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import { KEY, Terminal } from "./prompts/terminal.js";

// Whole remove runs drawn by the real terminal Ui into a headless xterm, 100
// columns, colour off, compared line for line, so the look can't drift.

/** `left`, then `right` ending at the right margin. */
const atRight = (left: string, right: string) =>
	`${left}${" ".repeat(99 - left.length - right.length)}${right}`;
const HEADER = atRight(" ■ agntc remove", "~/project · v1.2.3");
const RULE = ` ${"─".repeat(98)}`;
const close = (tally: string) => ["", RULE, atRight(` ${tally}`, "2.4s")];
const PICKER = atRight(
	" ? Select what to remove",
	"↑↓ move   space pick   a all   ⏎ done   esc cancel",
);

let testDir: string;
let projectDir: string;

beforeEach(async () => {
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-remove-")));
	projectDir = join(testDir, "project");
	await mkdir(projectDir, { recursive: true });
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

async function write(files: Record<string, string | object>): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		const full = join(projectDir, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(
			full,
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
}

function entry(fields: Partial<ManifestEntry>): ManifestEntry {
	return {
		ref: "v0.5.3",
		commit: "a".repeat(40),
		installedAt: "2026-10-01T00:00:00.000Z",
		files: [],
		type: "skill",
		cloneUrl: "https://github.com/leeovery/agentic-skills.git",
		...fields,
	};
}

const folders = (...names: string[]) =>
	names.flatMap((name) => [
		`.claude/skills/${name}/`,
		`.claude/skills/${name}/SKILL.md`,
	]);

const NUXT = [
	"nuxt-pages",
	"nuxt-data",
	"nuxt-routing",
	"nuxt-server",
	"nuxt-state",
	"nuxt-testing",
	"nuxt-seo",
	"nuxt-i18n",
	"nuxt-auth",
	"nuxt-shared",
	"nuxt-templates",
];

/** The mock-up's entries: a pack of nine skills and two support folders, a pack with an agent, and a skill. */
async function installed(): Promise<void> {
	const support = new Set(["nuxt-shared", "nuxt-templates"]);
	const nuxtFiles = Object.fromEntries(
		NUXT.map((name) => [
			`.claude/skills/${name}/${support.has(name) ? "README.md" : "SKILL.md"}`,
			"",
		]),
	);
	await write({
		...nuxtFiles,
		".claude/skills/eloquent/SKILL.md": "",
		".claude/agents/reviewer.md": "",
		".claude/skills/git-hygiene/SKILL.md": "",
		".agntc/manifest.json": {
			"leeovery/agentic-skills/nuxt": entry({
				type: "pack",
				files: NUXT.map((name) => `.claude/skills/${name}/`),
			}),
			"leeovery/agentic-skills/laravel": entry({
				type: "pack",
				files: [...folders("eloquent"), ".claude/agents/reviewer.md"],
			}),
			"leeovery/git-hygiene": entry({
				ref: null,
				files: folders("git-hygiene"),
				cloneUrl: "https://github.com/leeovery/git-hygiene.git",
			}),
		},
	});
}

interface Run {
	key?: string;
	yes?: boolean;
	/** Keys pressed once the run asks its question. */
	answer?: string[];
	/** Keys pressed once the run asks a second question, as its words show. */
	later?: { asked: string; answer: string[] };
	rows?: number;
	columns?: number;
}

/** The terminal while the run asks each question, and once it has ended. */
async function session({
	key,
	yes,
	answer,
	later,
	rows = 60,
	columns = 100,
}: Run = {}): Promise<{
	asking: string[];
	askingLater: string[];
	ended: string[];
}> {
	const term = new Terminal(columns, rows);
	let asking: string[] = [];
	let askingLater: string[] = [];
	let now = 0;
	const ui = new TerminalUi({
		header: { command: "remove", where: "~/project", version: "1.2.3" },
		input: term.input,
		output: term.output,
		env: {},
		host: term.host,
		clock: () => {
			const at = now;
			now = 2400;
			return at;
		},
	});
	ui.header();
	const running = runRemove(key, { yes }, ui, projectScope(projectDir));
	// Settled below, once the questions are answered; a cancel may end it first.
	running.catch(() => {});
	if (answer !== undefined) {
		await vi.waitFor(() => {
			expect(term.output.text).toContain(" ? ");
		});
		asking = await term.lines();
		await term.press(...answer);
	}
	if (later !== undefined) {
		await vi.waitFor(() => {
			expect(term.output.text).toContain(later.asked);
		});
		askingLater = await term.lines();
		await term.press(...later.answer);
	}
	try {
		await running;
	} catch (err) {
		if (!(err instanceof ExitSignal)) {
			throw err;
		}
	} finally {
		ui.end();
	}
	return { asking, askingLater, ended: await term.lines() };
}

const NUXT_ROW = [
	" ● leeovery/agentic-skills/nuxt   pack · 9 skills, 2 folders",
	"   .claude/skills/  nuxt-pages  nuxt-data  nuxt-routing  nuxt-server  nuxt-state  nuxt-testing",
	"                    nuxt-seo  nuxt-i18n  nuxt-auth  nuxt-shared  nuxt-templates",
];

describe("a remove of one entry", () => {
	it("asks under its row, counting what the row shows, then ends on its removed row", async () => {
		await installed();

		const { asking, ended } = await session({
			key: "leeovery/agentic-skills/nuxt",
			answer: ["y"],
		});

		expect(asking).toEqual([
			HEADER,
			"",
			...NUXT_ROW,
			"",
			" ? Remove it and its 9 skills and 2 folders?   [Yes]  No",
		]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ✓ leeovery/agentic-skills/nuxt   removed · pack · 9 skills, 2 folders",
			"   .claude/skills/  nuxt-pages  nuxt-data  nuxt-routing  nuxt-server  nuxt-state  nuxt-testing",
			"                    nuxt-seo  nuxt-i18n  nuxt-auth  nuxt-shared  nuxt-templates",
		]);
	});

	it("cuts the row to the room a short screen leaves, counting the skills and support folders left out, each as what it is", async () => {
		await installed();

		const { asking } = await session({
			key: "leeovery/agentic-skills/nuxt",
			answer: ["n"],
			rows: 5,
		});

		expect(asking).toEqual([
			HEADER,
			"",
			" ● leeovery/agentic-skills/nuxt   pack · 9 skills, 2 folders",
			"   … 9 more skills, 2 more folders",
			"",
			" ? Remove it and its 9 skills and 2 folders?   [Yes]  No",
		]);
	});

	it("leaves nothing but the cancel when the question is answered no", async () => {
		await installed();

		expect(
			(await session({ key: "leeovery/git-hygiene", answer: ["n"] })).ended,
		).toEqual([HEADER, "", " ○ Cancelled"]);
	});

	it("removes without asking under -y, its row naming what it installed", async () => {
		await installed();

		expect(
			(await session({ key: "leeovery/agentic-skills/laravel", yes: true }))
				.ended,
		).toEqual([
			HEADER,
			"",
			" ✓ leeovery/agentic-skills/laravel   removed · pack · 1 skill, 1 agent",
			"   .claude/skills/  eloquent",
			"   .claude/agents/  reviewer.md",
		]);
	});
});

describe("a remove of a prefix", () => {
	it("asks once under every entry's row, counting them together, then closes on the tally", async () => {
		await installed();

		const { asking, ended } = await session({
			key: "leeovery/agentic-skills",
			answer: ["y"],
		});

		expect(asking).toEqual([
			HEADER,
			"",
			" ● leeovery/agentic-skills/nuxt      pack · 9 skills, 2 folders",
			"   .claude/skills/  nuxt-pages  nuxt-data  nuxt-routing  nuxt-server  nuxt-state  nuxt-testing",
			"                    nuxt-seo  nuxt-i18n  nuxt-auth  nuxt-shared  nuxt-templates",
			" ● leeovery/agentic-skills/laravel   pack · 1 skill, 1 agent",
			"   .claude/skills/  eloquent",
			"   .claude/agents/  reviewer.md",
			"",
			" ? Remove them and their 10 skills, 2 folders and 1 agent?   [Yes]  No",
		]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ✓ leeovery/agentic-skills/nuxt      removed · pack · 9 skills, 2 folders",
			"   .claude/skills/  nuxt-pages  nuxt-data  nuxt-routing  nuxt-server  nuxt-state  nuxt-testing",
			"                    nuxt-seo  nuxt-i18n  nuxt-auth  nuxt-shared  nuxt-templates",
			" ✓ leeovery/agentic-skills/laravel   removed · pack · 1 skill, 1 agent",
			"   .claude/skills/  eloquent",
			"   .claude/agents/  reviewer.md",
			...close("2 removed"),
		]);
	});

	it.each([
		[
			8,
			[
				...NUXT_ROW.map((line, index) =>
					index === 0
						? " ● leeovery/agentic-skills/nuxt      pack · 9 skills, 2 folders"
						: line,
				),
				" ● leeovery/agentic-skills/laravel   pack · 1 skill, 1 agent",
				"   … 1 more skill, 1 more agent",
			],
		],
		[
			7,
			[
				" ● leeovery/agentic-skills/nuxt      pack · 9 skills, 2 folders",
				"   … 9 more skills, 2 more folders",
				" ● leeovery/agentic-skills/laravel   pack · 1 skill, 1 agent",
				"   … 1 more skill, 1 more agent",
			],
		],
		[
			6,
			[
				" ● leeovery/agentic-skills/nuxt      pack · 9 skills, 2 folders",
				"   … 9 more skills, 2 more folders",
				" … 1 more entry",
			],
		],
		[
			5,
			[
				" ● leeovery/agentic-skills/nuxt      pack · 9 skills, 2 folders",
				" … 1 more entry",
			],
		],
		[4, [" ● leeovery/agentic-skills/nuxt      pack · 9 skills, 2 folders"]],
	])("fits the rows together to a screen of %i rows, the first taking the room to spare, each cut honestly", async (rows, fitted) => {
		await installed();

		const { asking } = await session({
			key: "leeovery/agentic-skills",
			answer: ["n"],
			rows,
		});

		expect(asking).toEqual([
			HEADER,
			"",
			...fitted,
			"",
			" ? Remove them and their 10 skills, 2 folders and 1 agent?   [Yes]  No",
		]);
	});

	it("marks a key whose files can't be removed as failed, kept recorded, beside those removed", async () => {
		await installed();
		await write({
			".agntc/manifest.json": {
				"leeovery/agentic-skills/laravel": entry({
					type: "pack",
					files: [...folders("eloquent"), ".claude/agents/reviewer.md"],
				}),
				"leeovery/agentic-skills/broken": entry({ files: ["../outside/"] }),
			},
		});

		const { ended } = await session({
			key: "leeovery/agentic-skills",
			yes: true,
		});

		// The reason names the project folder, which wraps where its path's length puts it.
		expect(ended.slice(0, 6)).toEqual([
			HEADER,
			"",
			" ✓ leeovery/agentic-skills/laravel   removed · pack · 1 skill, 1 agent",
			"   .claude/skills/  eloquent",
			"   .claude/agents/  reviewer.md",
			" ✗ leeovery/agentic-skills/broken    failed · won't delete ../outside/ — not a plain path below",
		]);
		expect(ended.slice(6, -3).join(" ").replace(/\s+/g, " ")).toBe(
			` ${projectDir}; it stays recorded`,
		);
		expect(ended.slice(-3)).toEqual(close("1 removed  ·  1 failed"));
	});
});

describe("a remove at 40 columns", () => {
	/** Too narrow for where and the version beside the command. */
	const HEADER_40 = " ■ agntc remove";

	/** A pack holding folders, an agent and a hook, whose cut row's count wraps at 40 columns. */
	async function nuxtWithAgentAndHook(): Promise<void> {
		await write({
			".agntc/manifest.json": {
				"leeovery/agentic-skills/nuxt": entry({
					type: "pack",
					files: [
						...NUXT.map((name) => `.claude/skills/${name}/`),
						".claude/agents/reviewer.md",
						".claude/hooks/lint.sh",
					],
				}),
			},
		});
	}

	it("wraps a cut row's count of skills, agent and hook within the width, so the question erases it whole", async () => {
		await nuxtWithAgentAndHook();

		const { asking, ended } = await session({
			key: "leeovery/agentic-skills/nuxt",
			answer: ["n"],
			columns: 40,
			rows: 12,
		});

		expect(asking).toEqual([
			HEADER_40,
			"",
			" ● leeovery/agentic-skills/nuxt",
			"   pack · 11 skills, 1 agent, 1 hook",
			"   … 11 more skills, 1 more agent,",
			"   1 more hook",
			"",
			" ? Remove it and its 11 skills, 1 agent",
			"   and 1 hook?",
			"   [Yes]  No",
		]);
		expect(ended).toEqual([HEADER_40, "", " ○ Cancelled"]);
	});

	const QUESTION_40 = [
		" ? Remove them and their 12 skills,",
		"   2 agents and 1 hook?",
		"   [Yes]  No",
	];

	it.each([
		[
			11,
			[
				" ● leeovery/agentic-skills/nuxt",
				"   pack · 11 skills, 1 agent, 1 hook",
				"   … 11 more skills, 1 more agent,",
				"   1 more hook",
				" … 1 more entry",
			],
		],
		[
			9,
			[
				" ● leeovery/agentic-skills/nuxt",
				"   … 11 more skills, 1 more agent,",
				"   1 more hook",
				" … 1 more entry",
			],
		],
	])("charges the first row its wrapped count, on a screen of %i rows, before counting the rest", async (rows, fitted) => {
		await write({
			".agntc/manifest.json": {
				"leeovery/agentic-skills/nuxt": entry({
					type: "pack",
					files: [
						...NUXT.map((name) => `.claude/skills/${name}/`),
						".claude/agents/reviewer.md",
						".claude/hooks/lint.sh",
					],
				}),
				"leeovery/agentic-skills/laravel": entry({
					type: "pack",
					files: [...folders("eloquent"), ".claude/agents/reviewer.md"],
				}),
			},
		});

		const { asking } = await session({
			key: "leeovery/agentic-skills",
			answer: ["n"],
			columns: 40,
			rows,
		});

		expect(asking).toEqual([HEADER_40, "", ...fitted, "", ...QUESTION_40]);
	});

	it.each([
		[
			9,
			[
				" ● /opt/code/",
				"   a-local-kit-with-a-long-enough-name/",
				"   nuxt",
				"   pack · 11 skills",
				"   … 11 more skills",
			],
		],
		[7, [" ● …al-kit-with-a-long-enough-name/nuxt", "   … 11 more skills"]],
	])("keeps naming a long local entry on a screen of %i rows, on one line once its head doesn't fit", async (rows, fitted) => {
		const key = "/opt/code/a-local-kit-with-a-long-enough-name/nuxt";
		await write({
			".agntc/manifest.json": {
				[key]: entry({
					ref: null,
					commit: null,
					cloneUrl: null,
					type: "pack",
					files: NUXT.map((name) => `.claude/skills/${name}/`),
				}),
			},
		});

		const { asking } = await session({
			key,
			answer: ["n"],
			columns: 40,
			rows,
		});

		expect(asking).toEqual([
			HEADER_40,
			"",
			...fitted,
			"",
			" ? Remove it and its 11 skills?",
			"   [Yes]  No",
		]);
	});
});

describe("a remove picked from the list", () => {
	it("lines up each entry's kind and ref, dim, beside its key, then asks under the rows of those picked", async () => {
		await installed();

		const { asking, askingLater, ended } = await session({
			answer: [KEY.space, KEY.down, KEY.down, KEY.space, KEY.enter],
			later: { asked: "Remove them", answer: ["y"] },
		});

		expect(asking).toEqual([
			HEADER,
			"",
			PICKER,
			" ▌ ○ leeovery/agentic-skills/nuxt      pack    v0.5.3",
			"   ○ leeovery/agentic-skills/laravel   pack    v0.5.3",
			"   ○ leeovery/git-hygiene              skill   HEAD",
			"",
			atRight("", "0 of 3 picked"),
		]);
		expect(askingLater).toEqual([
			HEADER,
			"",
			...NUXT_ROW.map((line, index) =>
				index === 0
					? " ● leeovery/agentic-skills/nuxt   pack · 9 skills, 2 folders"
					: line,
			),
			" ● leeovery/git-hygiene           skill",
			"   .claude/skills/  git-hygiene",
			"",
			" ? Remove them and their 10 skills and 2 folders?   [Yes]  No",
		]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ✓ leeovery/agentic-skills/nuxt   removed · pack · 9 skills, 2 folders",
			"   .claude/skills/  nuxt-pages  nuxt-data  nuxt-routing  nuxt-server  nuxt-state  nuxt-testing",
			"                    nuxt-seo  nuxt-i18n  nuxt-auth  nuxt-shared  nuxt-templates",
			" ✓ leeovery/git-hygiene           removed · skill",
			"   .claude/skills/  git-hygiene",
			...close("2 removed"),
		]);
	});

	it("leaves nothing but the cancel when nothing is picked", async () => {
		await installed();

		expect((await session({ answer: [KEY.escape] })).ended).toEqual([
			HEADER,
			"",
			" ○ Cancelled",
		]);
	});
});

describe("a remove with nothing installed", () => {
	it("says so in one row", async () => {
		expect((await session({ key: "owner/repo" })).ended).toEqual([
			HEADER,
			"",
			" ○ No skills or packs installed.",
		]);
	});
});

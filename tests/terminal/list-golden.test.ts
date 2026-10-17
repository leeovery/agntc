import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const home = vi.hoisted(() => ({ dir: "" }));

vi.mock("node:os", async (importOriginal) => {
	const os = await importOriginal<typeof import("node:os")>();
	return { ...os, homedir: () => home.dir };
});

vi.mock("../../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-clone.js")>()),
	cloneSource: vi.fn(),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/update-check.js")>()),
	checkForUpdate: vi.fn(),
}));

vi.mock("../../src/git-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-utils.js")>()),
	fetchRemoteTagRefs: vi.fn(),
}));

import { runListLoop } from "../../src/commands/list.js";
import { cloneSource } from "../../src/git-clone.js";
import { fetchRemoteTagRefs } from "../../src/git-utils.js";
import type { ManifestEntry } from "../../src/manifest.js";
import { projectScope } from "../../src/scope.js";
import { repoFromKey } from "../../src/source-parser.js";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import {
	categorizeMember,
	checkForUpdate,
	type GroupTarget,
} from "../../src/update-check.js";
import { KEY, Terminal } from "./prompts/terminal.js";

// Whole list sessions drawn by the real terminal Ui into a headless xterm,
// 100 columns, colour off, compared line for line, so the look can't drift.

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const PACK = { type: "pack" };
/** `left`, then `right` ending at the right margin. */
const atRight = (left: string, right: string) =>
	`${left}${" ".repeat(99 - left.length - right.length)}${right}`;
const HEADER = atRight(" ■ agntc list", "~/project · v1.2.3");
const RULE = ` ${"─".repeat(98)}`;
const close = (tally: string) => ["", RULE, atRight(` ${tally}`, "2.4s")];
const DASHBOARD = "Select a skill or pack to manage";

let testDir: string;
let projectDir: string;
/** The tree each `owner/repo` clones from. */
let upstream: Map<string, string>;
/** What each `owner/repo` checks against. */
let targets: Map<string, GroupTarget>;

beforeEach(async () => {
	vi.clearAllMocks();
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-list-golden-")));
	home.dir = testDir;
	projectDir = join(testDir, "project");
	await mkdir(projectDir, { recursive: true });
	upstream = new Map();
	targets = new Map();
	vi.mocked(cloneSource).mockImplementation(async (parsed) => {
		if (parsed.type === "local-path") {
			throw new Error("local sources aren't cloned");
		}
		const fixture = upstream.get(`${parsed.owner}/${parsed.repo}`);
		if (fixture === undefined) {
			throw new Error(`no upstream for ${parsed.owner}/${parsed.repo}`);
		}
		const tempDir = await mkdtemp(join(testDir, "clone-"));
		await cp(fixture, tempDir, { recursive: true });
		return { tempDir, commit: NEW };
	});
	vi.mocked(checkForUpdate).mockImplementation(async (key, entry) => {
		if (entry.commit === null) {
			return { status: "local" };
		}
		const target = targets.get(repoFromKey(key));
		if (target === undefined) {
			throw new Error(`no target for ${key}`);
		}
		return entry.constraint === undefined && target.kind === "constrained"
			? { status: "up-to-date" }
			: categorizeMember(entry, target);
	});
	vi.mocked(fetchRemoteTagRefs).mockResolvedValue(
		["v1.0.1", "v1.0.2", "v1.0.3", "v2.0.0"].map((tag) => ({
			tag,
			sha: NEW,
		})),
	);
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

async function write(
	base: string,
	files: Record<string, string | object>,
): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		const full = join(base, path);
		await mkdir(dirname(full), { recursive: true });
		await writeFile(
			full,
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}
}

/** An entry installed at the old commit, from GitHub. */
function entry(key: string, fields: Partial<ManifestEntry>): ManifestEntry {
	return {
		ref: null,
		commit: OLD,
		installedAt: "2026-10-01T00:00:00.000Z",
		files: [],
		type: "skill",
		cloneUrl: `https://github.com/${repoFromKey(key)}.git`,
		...fields,
	};
}

const skillFiles = (name: string) => [
	`.claude/skills/${name}/`,
	`.claude/skills/${name}/SKILL.md`,
];

/** The mock-up's entries, installed, with what each checks against upstream. */
async function installEveryKind(): Promise<void> {
	const repo = async (
		name: string,
		files: Record<string, string | object>,
		target: GroupTarget,
	) => {
		const dir = join(testDir, "upstream", name);
		await write(dir, files);
		upstream.set(name, dir);
		targets.set(name, target);
	};
	await repo(
		"leeovery/agentic-skills",
		{
			"laravel/agntc.json": PACK,
			"laravel/skills/eloquent/SKILL.md": "new",
			"laravel/skills/queues/SKILL.md": "new",
		},
		{ kind: "constrained", tag: "v0.2.5", commit: NEW, latestOverall: null },
	);
	await repo(
		"leeovery/agentic-workflows",
		{ "SKILL.md": "new" },
		{ kind: "constrained", tag: "v0.8.18", commit: NEW, latestOverall: null },
	);
	await repo(
		"referodesign/refero_skill",
		{ "refero-design/SKILL.md": "new" },
		{ kind: "tag", tag: "v1.0.2", newerTags: ["v1.0.3", "v2.0.0"] },
	);
	targets.set("petekp/claude-skills", {
		kind: "check-failed",
		reason: "fatal: unable to access: Could not resolve host: github.com",
	});
	const local = join(testDir, "Code/my-skills");
	await write(local, { "drafting/SKILL.md": "mine" });
	const entries: Record<string, ManifestEntry> = {
		"leeovery/agentic-skills/laravel": entry("leeovery/agentic-skills", {
			ref: "v0.2.4",
			constraint: "^0.2.4",
			type: "pack",
			files: [...skillFiles("eloquent"), ...skillFiles("queues")],
		}),
		"leeovery/agentic-workflows": entry("leeovery/agentic-workflows", {
			ref: "v0.8.18",
			constraint: "^0.8.18",
			files: skillFiles("agentic-workflows"),
		}),
		"referodesign/refero_skill/refero-design": entry(
			"referodesign/refero_skill",
			{ ref: "v1.0.2", files: skillFiles("refero-design") },
		),
		"petekp/claude-skills/swift": entry("petekp/claude-skills", {
			files: skillFiles("swift"),
		}),
		[join(local, "drafting")]: {
			ref: null,
			commit: null,
			installedAt: "2026-10-02T00:00:00.000Z",
			files: skillFiles("drafting"),
			type: "skill",
			cloneUrl: null,
			localRoot: local,
		},
	};
	const installedFiles = Object.values(entries).flatMap((recorded) =>
		recorded.files
			.filter((file) => !file.endsWith("/"))
			.map((file): [string, string] => [file, "old"]),
	);
	await write(projectDir, {
		...Object.fromEntries(installedFiles),
		".agntc/manifest.json": entries,
	});
}

/** A list session at a terminal, its questions answered as each comes. */
class Session {
	readonly term = new Terminal(100, 60);
	readonly ended: Promise<void>;
	private readonly ui: TerminalUi;
	/** How much of the output had been written when the last answer began. */
	private mark = 0;

	constructor() {
		let now = 0;
		this.ui = new TerminalUi({
			header: { command: "list", where: "~/project", version: "1.2.3" },
			input: this.term.input,
			output: this.term.output,
			env: {},
			host: this.term.host,
			clock: () => {
				const at = now;
				now = 2400;
				return at;
			},
		});
		this.ended = runListLoop(this.ui, projectScope(projectDir)).finally(() =>
			this.ui.end(),
		);
	}

	/** Waits for `question`, then answers it with `keys`. */
	async answer(question: string, ...keys: string[]): Promise<void> {
		await this.asked(question);
		this.mark = this.term.output.text.length;
		await this.term.press(...keys);
	}

	/** The terminal once `question` is asked. */
	async asking(question: string): Promise<string[]> {
		await this.asked(question);
		return this.term.lines();
	}

	/** The terminal once the session has ended. */
	async drawn(): Promise<string[]> {
		await this.ended;
		return this.term.lines();
	}

	private async asked(question: string): Promise<void> {
		await vi.waitFor(() => {
			expect(this.term.output.text.slice(this.mark)).toContain(`? ${question}`);
		});
	}
}

describe("a list session", () => {
	it("draws the dashboard: each repo a heading, its entries lined up beneath, and what they hold in the footer", async () => {
		await installEveryKind();
		const session = new Session();

		expect(await session.asking(DASHBOARD)).toEqual([
			HEADER,
			"",
			" ? Select a skill or pack to manage",
			"   leeovery/agentic-skills",
			" ▌   laravel             pack    v0.2.4 ^0.2.4     ↑ v0.2.5",
			"   leeovery/agentic-workflows",
			"     agentic-workflows   skill   v0.8.18 ^0.8.18   ✓ up to date",
			"   referodesign/refero_skill",
			"     refero-design       skill   v1.0.2            ! newer tags",
			"   petekp/claude-skills",
			"     swift               skill   HEAD              ✗ check failed",
			"   ~/Code/my-skills",
			"     drafting            skill   local             ◇ local",
			"",
			" ↑↓ move   ⏎ manage   esc done                        1 update · 1 with newer tags · 1 check failed",
		]);

		await session.answer(DASHBOARD, KEY.escape);
		await session.ended;
	});

	it("draws an entry's detail view, its actions asked under its row", async () => {
		await installEveryKind();
		const session = new Session();
		await session.answer(DASHBOARD, KEY.enter);

		expect(await session.asking("Action")).toEqual([
			HEADER,
			"",
			" ● leeovery/agentic-skills/laravel   pack",
			"   version     v0.2.4",
			"   constraint  ^0.2.4",
			"   commit      aaaaaaa",
			"   installed   2026-10-01",
			"   installs    2 skills",
			"   status      v0.2.5 available",
			"",
			" ? Action                                                             ↑↓ move · ⏎ choose · esc back",
			" ▌ Update",
			"   Change version",
			"   Remove",
			"   Back",
		]);

		await session.answer("Action", KEY.escape);
		await session.answer(DASHBOARD, KEY.escape);
		await session.ended;
	});

	it("leaves each action's row, ending on the tally: an update, a version change and a removal", async () => {
		await installEveryKind();
		const session = new Session();
		await session.answer(DASHBOARD, KEY.enter);
		await session.answer("Action", KEY.enter);
		await session.answer("Action", KEY.escape);
		expect((await session.asking(DASHBOARD)).slice(2, 6)).toEqual([
			" ✓ leeovery/agentic-skills   ^0.2.4   v0.2.4 → v0.2.5",
			"   └─ laravel                         pack · 2 skills · 2 files",
			"",
			" ? Select a skill or pack to manage",
		]);
		await session.answer(DASHBOARD, KEY.down, KEY.down, KEY.enter);
		await session.answer("Action", KEY.enter);
		expect((await session.asking("Select a version")).slice(2)).toEqual([
			" ✓ leeovery/agentic-skills   ^0.2.4   v0.2.4 → v0.2.5",
			"   └─ laravel                         pack · 2 skills · 2 files",
			"",
			" ● referodesign/refero_skill/refero-design   skill",
			"   version    v1.0.2",
			"   commit     aaaaaaa",
			"   installed  2026-10-01",
			"   installs   1 skill",
			"   status     newer tags available",
			"",
			" ? Select a version                                                   ↑↓ move · ⏎ choose · esc back",
			" ▌ v2.0.0",
			"   v1.0.3",
			"   v1.0.2   current",
			"   v1.0.1",
		]);
		await session.answer("Select a version", KEY.enter);
		expect((await session.asking("Change")).slice(2)).toEqual([
			" ✓ leeovery/agentic-skills   ^0.2.4   v0.2.4 → v0.2.5",
			"   └─ laravel                         pack · 2 skills · 2 files",
			"",
			" ● referodesign/refero_skill/refero-design   skill",
			"   version    v1.0.2",
			"   commit     aaaaaaa",
			"   installed  2026-10-01",
			"   installs   1 skill",
			"   status     newer tags available",
			"",
			" ? Change referodesign/refero_skill/refero-design to v2.0.0? This re-installs it at the new",
			"   version.",
			"   [Yes]  No",
		]);
		await session.answer("Change", "y");
		await session.answer("Action", KEY.escape);
		await session.answer(DASHBOARD, KEY.down, KEY.enter);
		await session.answer("Action", KEY.down, KEY.enter);
		expect((await session.asking("Remove")).slice(2)).toEqual([
			" ✓ leeovery/agentic-skills   ^0.2.4   v0.2.4 → v0.2.5",
			"   └─ laravel                         pack · 2 skills · 2 files",
			"",
			" ✓ referodesign/refero_skill   v2.0.0   v1.0.2 → v2.0.0",
			"   └─ refero-design                     skill · 1 file",
			"",
			" ● leeovery/agentic-workflows   skill",
			"   .claude/skills/  agentic-workflows",
			"",
			" ? Remove it and its folder?   [Yes]  No",
		]);
		await session.answer("Remove", "y");
		await session.answer(DASHBOARD, KEY.escape);

		expect(await session.drawn()).toEqual([
			HEADER,
			"",
			" ✓ leeovery/agentic-skills   ^0.2.4   v0.2.4 → v0.2.5",
			"   └─ laravel                         pack · 2 skills · 2 files",
			"",
			" ✓ referodesign/refero_skill   v2.0.0   v1.0.2 → v2.0.0",
			"   └─ refero-design                     skill · 1 file",
			"",
			" ✓ leeovery/agentic-workflows   removed · skill",
			...close("1 updated  ·  1 version changed  ·  1 removed"),
		]);
	});

	it("asks about an entry its update finds gone upstream under the entry's row, and keeps it on no", async () => {
		const dir = join(testDir, "upstream", "owner/repo");
		await write(dir, { "other/SKILL.md": "new" });
		upstream.set("owner/repo", dir);
		targets.set("owner/repo", { kind: "head", resolvedSha: NEW });
		await write(projectDir, {
			".claude/skills/gone/SKILL.md": "old",
			".agntc/manifest.json": {
				"owner/repo/gone": entry("owner/repo", { files: skillFiles("gone") }),
			},
		});
		const session = new Session();
		await session.answer(DASHBOARD, KEY.enter);
		await session.answer("Action", KEY.enter);

		expect((await session.asking("Remove")).slice(2)).toEqual([
			" ! owner/repo/gone   gone upstream · skill",
			"   .claude/skills/  gone",
			"",
			" ? Remove it and its folder?    Yes  [No]",
		]);
		await session.answer("Remove", "n");
		await session.answer("Action", KEY.escape);
		await session.answer(DASHBOARD, KEY.escape);

		expect(await session.drawn()).toEqual([
			HEADER,
			"",
			" ! owner/repo   HEAD   kept",
			"   └─ gone             kept — it's gone upstream; update will ask again",
		]);
	});

	it("points an empty manifest at add", async () => {
		await write(projectDir, { ".agntc/manifest.json": {} });

		expect(await new Session().drawn()).toEqual([
			HEADER,
			"",
			" ○ No skills or packs installed.",
			"",
			" Next",
			"   To get started:",
			"     npx agntc add owner/repo",
		]);
	});

	it("leaves the header alone when nothing changed", async () => {
		await installEveryKind();
		const session = new Session();
		await session.answer(DASHBOARD, KEY.enter);
		await session.answer("Action", KEY.escape);
		await session.answer(DASHBOARD, KEY.escape);

		expect(await session.drawn()).toEqual([HEADER]);
	});
});

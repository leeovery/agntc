import { cp, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-clone.js")>()),
	cloneSource: vi.fn(),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/update-check.js")>()),
	checkForUpdate: vi.fn(),
	resolveGroupTarget: vi.fn(),
}));

import { runUpdate } from "../../src/commands/update.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { cloneSource } from "../../src/git-clone.js";
import type { ManifestEntry } from "../../src/manifest.js";
import { projectScope } from "../../src/scope.js";
import { repoFromKey } from "../../src/source-parser.js";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import {
	categorizeMember,
	checkForUpdate,
	type GroupTarget,
	resolveGroupTarget,
} from "../../src/update-check.js";
import { Terminal } from "./prompts/terminal.js";

// Whole update runs drawn by the real terminal Ui into a headless xterm, 100
// columns, colour off, compared line for line, so the look can't drift.

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);
const PACK = { type: "pack" };
/** `left`, then `right` ending at the right margin. */
const atRight = (left: string, right: string) =>
	`${left}${" ".repeat(99 - left.length - right.length)}${right}`;
const HEADER = atRight(" ■ agntc update", "~/project · v1.2.3");
const QUESTION =
	" ? owner/repo/gone is gone upstream — remove it?    Yes  [No]";
const RULE = ` ${"─".repeat(98)}`;
const close = (tally: string) => ["", RULE, atRight(` ${tally}`, "2.4s")];

let testDir: string;
let projectDir: string;
/** The tree each `owner/repo` clones from. */
let upstream: Map<string, string>;
/** What each `owner/repo` resolves to; a clone of one missing here fails. */
let targets: Map<string, GroupTarget>;
let unreachable: Set<string>;

beforeEach(async () => {
	vi.clearAllMocks();
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-golden-")));
	projectDir = join(testDir, "project");
	await mkdir(projectDir, { recursive: true });
	upstream = new Map();
	targets = new Map();
	unreachable = new Set();
	vi.mocked(cloneSource).mockImplementation(async (parsed) => {
		if (parsed.type === "local-path") {
			throw new Error("local sources aren't cloned");
		}
		const repo = `${parsed.owner}/${parsed.repo}`;
		const fixture = upstream.get(repo);
		if (fixture === undefined || unreachable.has(repo)) {
			throw new Error(
				`git clone failed after 3 attempts: fatal: repository 'https://github.com/${repo}.git/' not found`,
			);
		}
		const tempDir = await mkdtemp(join(testDir, "clone-"));
		await cp(fixture, tempDir, { recursive: true });
		return { tempDir, commit: NEW };
	});
	vi.mocked(resolveGroupTarget).mockImplementation(async (group) =>
		targetOf(group.members[0]!.key),
	);
	vi.mocked(checkForUpdate).mockImplementation(async (key, entry) =>
		categorizeMember(entry, targetOf(key)),
	);
});

afterEach(async () => {
	await rm(testDir, { recursive: true, force: true });
});

function targetOf(key: string): GroupTarget {
	const target = targets.get(repoFromKey(key));
	if (target === undefined) {
		throw new Error(`no target for ${key}`);
	}
	return target;
}

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

async function repo(
	name: string,
	files: Record<string, string | object>,
	target: GroupTarget,
): Promise<void> {
	const dir = join(testDir, "upstream", name);
	await write(dir, files);
	upstream.set(name, dir);
	targets.set(name, target);
}

function constrained(
	tag: string,
	latestOverall: string | null = null,
): GroupTarget {
	return { kind: "constrained", tag, commit: NEW, latestOverall };
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

async function installed(
	entries: Record<string, ManifestEntry>,
): Promise<void> {
	const files = Object.values(entries).flatMap((recorded) =>
		recorded.files
			.filter((file) => !file.endsWith("/"))
			.map((file): [string, string] => [file, "old"]),
	);
	await write(projectDir, {
		...Object.fromEntries(files),
		".agntc/manifest.json": entries,
	});
}

interface Run {
	key?: string;
	yes?: boolean;
	/** Keys pressed once the run asks its first question. */
	answer?: string[];
}

/** The run as the terminal shows it once it has ended. */
async function drawn(run: Run = {}): Promise<string[]> {
	return (await session(run)).ended;
}

/** The terminal while the run asks its question, and once it has ended. */
async function session({ key, yes, answer }: Run = {}): Promise<{
	asking: string[];
	ended: string[];
}> {
	const term = new Terminal(100, 60);
	let asking: string[] = [];
	let now = 0;
	const ui = new TerminalUi({
		header: { command: "update", where: "~/project", version: "1.2.3" },
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
	const running = runUpdate(key, { yes }, ui, projectScope(projectDir));
	if (answer !== undefined) {
		await asked(term);
		asking = await term.lines();
		await term.press(...answer);
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
	return { asking, ended: await term.lines() };
}

async function asked(term: Terminal): Promise<void> {
	await vi.waitFor(() => {
		expect(term.output.text).toContain(" ? ");
	});
}

const SKILLS = (...names: string[]) =>
	Object.fromEntries(names.map((name) => [`skills/${name}/SKILL.md`, "new"]));

describe("an update of everything", () => {
	it("draws the mock-up's run: groups, their members, what's left alone, and Next", async () => {
		await repo(
			"leeovery/agentic-skills",
			{
				"laravel/agntc.json": PACK,
				...prefixed("laravel/", SKILLS("eloquent", "queues")),
				"nuxt/agntc.json": PACK,
				...prefixed("nuxt/", SKILLS("nitro")),
				"nuxt/skills/shared/README.md": "new",
				"nuxt/agents/reviewer.md": "new",
			},
			constrained("v0.2.5"),
		);
		await repo(
			"referodesign/refero_skill",
			{ "refero-design/SKILL.md": "new" },
			constrained("v1.0.3", "v2.0.0"),
		);
		await repo(
			"leeovery/agentic-workflows",
			{ "SKILL.md": "new" },
			constrained("v0.8.18"),
		);
		targets.set("petekp/claude-skills", {
			kind: "check-failed",
			reason: "fatal: unable to access: Could not resolve host: github.com",
		});
		await repo(
			"rshankras/claude-code-apple-skills",
			{
				"macos/agntc.json": PACK,
				...prefixed("macos/", SKILLS("macos-design")),
				"macos/hig/macos-hig/README.md": "new",
			},
			constrained("v1.5.0"),
		);
		await installed({
			"leeovery/agentic-skills/laravel": entry("leeovery/agentic-skills", {
				ref: "v0.2.4",
				constraint: "^0.2.4",
				type: "pack",
				files: [".claude/skills/eloquent/", ".claude/skills/eloquent/SKILL.md"],
			}),
			"leeovery/agentic-skills/nuxt": entry("leeovery/agentic-skills", {
				ref: "v0.2.4",
				constraint: "^0.2.4",
				type: "pack",
				files: [".claude/skills/nitro/", ".claude/skills/nitro/SKILL.md"],
			}),
			"referodesign/refero_skill/refero-design": entry(
				"referodesign/refero_skill",
				{
					ref: "v1.0.2",
					constraint: "^1.0.2",
					files: [
						".claude/skills/refero-design/",
						".claude/skills/refero-design/SKILL.md",
					],
				},
			),
			"leeovery/agentic-workflows": entry("leeovery/agentic-workflows", {
				ref: "v0.8.18",
				constraint: "^0.8.18",
				commit: NEW,
			}),
			"petekp/claude-skills/swift": entry("petekp/claude-skills", {}),
			"rshankras/claude-code-apple-skills/macos": entry(
				"rshankras/claude-code-apple-skills",
				{
					ref: "v1.4.0",
					constraint: "^1.4.0",
					type: "pack",
					files: [
						".claude/skills/macos-design/",
						".claude/skills/macos-design/SKILL.md",
						".claude/skills/macos-hig/",
						".claude/skills/macos-hig/README.md",
					],
				},
			),
		});

		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ✓ leeovery/agentic-skills              ^0.2.4    v0.2.4 → v0.2.5",
			"   ├─ laravel                                     pack · 2 skills",
			"   └─ nuxt                                        pack · 1 skill, 1 folder, 1 agent",
			" ✗ rshankras/claude-code-apple-skills   ^1.4.0    v1.4.0 → v1.5.0  not updated",
			"   └─ macos                                       can't be updated: it would remove macos-hig,",
			"                                                  which is still in the source but would no longer",
			"                                                  be installed. The existing install is unchanged.",
			" ✓ referodesign/refero_skill            ^1.0.2    v1.0.2 → v1.0.3",
			"   └─ refero-design                               skill",
			" ○ leeovery/agentic-workflows           ^0.8.18   up to date",
			" ! petekp/claude-skills                 HEAD      not checked · unable to access: Could not resolve",
			"                                                  host: github.com",
			"",
			" Next",
			"   rshankras/claude-code-apple-skills/macos — to update it anyway:",
			"     npx agntc remove rshankras/claude-code-apple-skills/macos",
			"     npx agntc add 'rshankras/claude-code-apple-skills/macos@^1.4.0' --pack",
			"",
			"   referodesign/refero_skill — newer version outside the constraint: v1.0.3 -> v2.0.0 available. To",
			"   upgrade:",
			"     npx agntc add referodesign/refero_skill/refero-design",
			...close(
				"3 updated  ·  1 up to date  ·  1 not checked  ·  1 not updated",
			),
		]);
	});

	it("names a clone failure and every member it took down", async () => {
		await repo(
			"owner/repo",
			{ "a/SKILL.md": "new", "b/SKILL.md": "new" },
			{ kind: "head", resolvedSha: NEW },
		);
		unreachable.add("owner/repo");
		await installed({
			"owner/repo/a": entry("owner/repo", {
				files: [".claude/skills/a/", ".claude/skills/a/SKILL.md"],
			}),
			"owner/repo/b": entry("owner/repo", {
				files: [".claude/skills/b/", ".claude/skills/b/SKILL.md"],
			}),
		});

		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ✗ owner/repo   HEAD   clone failed · git clone failed after 3 attempts: fatal: repository",
			"                       'https://github.com/owner/repo.git/' not found",
			"   ├─ a",
			"   └─ b",
			...close("2 failed"),
		]);
	});

	it("asks about an entry gone upstream under its spinning row, and keeps it on no", async () => {
		await repo(
			"owner/repo",
			{ "a/SKILL.md": "new" },
			{ kind: "head", resolvedSha: NEW },
		);
		await installed({
			"owner/repo/a": entry("owner/repo", {
				files: [".claude/skills/a/", ".claude/skills/a/SKILL.md"],
			}),
			"owner/repo/gone": entry("owner/repo", {
				files: [".claude/skills/gone/", ".claude/skills/gone/SKILL.md"],
			}),
		});

		const { asking, ended } = await session({ answer: ["n"] });

		expect(asking).toEqual([HEADER, "", QUESTION]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ! owner/repo   HEAD   aaaaaaa → bbbbbbb",
			"   ├─ ✓ a              skill",
			"   └─ ! gone           kept — it's gone upstream; update will ask again",
			...close("1 updated  ·  1 kept"),
		]);
	});

	it("says once that nothing is installed", async () => {
		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ○ No skills or packs installed.",
		]);
	});
});

describe("an update of one key", () => {
	it("draws its repo's row, the entry under it", async () => {
		await repo(
			"owner/repo",
			{ "tools/agntc.json": PACK, ...prefixed("tools/", SKILLS("a", "b")) },
			constrained("v1.1.0"),
		);
		await installed({
			"owner/repo/tools": entry("owner/repo", {
				ref: "v1.0.0",
				constraint: "^1.0.0",
				type: "pack",
				files: [".claude/skills/a/", ".claude/skills/a/SKILL.md"],
			}),
		});

		expect(await drawn({ key: "owner/repo/tools" })).toEqual([
			HEADER,
			"",
			" ✓ owner/repo   ^1.0.0   v1.0.0 → v1.1.0",
			"   └─ tools              pack · 2 skills · 2 files",
		]);
	});

	it("ends on its row when it's up to date", async () => {
		await repo("owner/repo", { "SKILL.md": "new" }, constrained("v1.1.0"));
		await installed({
			"owner/repo": entry("owner/repo", {
				ref: "v1.1.0",
				constraint: "^1.1.0",
				commit: NEW,
			}),
		});

		expect(await drawn({ key: "owner/repo" })).toEqual([
			HEADER,
			"",
			" ○ owner/repo   ^1.1.0   up to date",
		]);
	});

	it("removes an entry gone upstream with -y", async () => {
		await repo(
			"owner/repo",
			{ "other/SKILL.md": "new" },
			constrained("v1.1.0"),
		);
		await installed({
			"owner/repo/gone": entry("owner/repo", {
				ref: "v1.0.0",
				constraint: "^1.0.0",
				files: [".claude/skills/gone/", ".claude/skills/gone/SKILL.md"],
			}),
		});

		expect(await drawn({ key: "owner/repo/gone", yes: true })).toEqual([
			HEADER,
			"",
			" ✓ owner/repo   ^1.0.0   v1.0.0 → v1.1.0  removed",
			"   └─ gone               removed — it's gone upstream",
		]);
	});
});

function prefixed(
	prefix: string,
	files: Record<string, string>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(files).map(([path, content]) => [prefix + path, content]),
	);
}

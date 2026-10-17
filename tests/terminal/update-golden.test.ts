import {
	chmod,
	cp,
	mkdir,
	mkdtemp,
	realpath,
	rm,
	writeFile,
} from "node:fs/promises";
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
/** gone's question, under the row naming it and what it installed. */
const ASKED_GONE = [
	" ! owner/repo/gone   gone upstream · skill",
	"   .claude/skills/  gone",
	"",
	" ? Remove it and its skill?    Yes  [No]",
];
const RULE = ` ${"─".repeat(98)}`;
const close = (tally: string) => ["", RULE, atRight(` ${tally}`, "2.4s")];

let testDir: string;
let projectDir: string;
/** The tree each `owner/repo` clones from. */
let upstream: Map<string, string>;
/** What each `owner/repo` resolves to; a clone of one missing here fails. */
let targets: Map<string, GroupTarget>;
/** The repos whose clone fails, each with what the failure says. */
let unreachable: Map<string, string>;

function notFound(repo: string): string {
	return `git clone failed after 3 attempts: fatal: repository 'https://github.com/${repo}.git/' not found`;
}

beforeEach(async () => {
	vi.clearAllMocks();
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-golden-")));
	home.dir = testDir;
	projectDir = join(testDir, "project");
	await mkdir(projectDir, { recursive: true });
	upstream = new Map();
	targets = new Map();
	unreachable = new Map();
	vi.mocked(cloneSource).mockImplementation(async (parsed) => {
		if (parsed.type === "local-path") {
			throw new Error("local sources aren't cloned");
		}
		const repo = `${parsed.owner}/${parsed.repo}`;
		const fixture = upstream.get(repo);
		if (fixture === undefined || unreachable.has(repo)) {
			throw new Error(unreachable.get(repo) ?? notFound(repo));
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
	columns?: number;
	rows?: number;
}

/** The run as the terminal shows it once it has ended. */
async function drawn(run: Run = {}): Promise<string[]> {
	return (await session(run)).ended;
}

/** The terminal while the run asks its question, and once it has ended. */
async function session({
	key,
	yes,
	answer,
	columns = 100,
	rows = 60,
}: Run = {}): Promise<{
	asking: string[];
	ended: string[];
}> {
	const term = new Terminal(columns, rows);
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
			"   referodesign/refero_skill — newer version outside the constraint: v1.0.3 → v2.0.0 available. To",
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
		unreachable.set("owner/repo", notFound("owner/repo"));
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
			" ✗ owner/repo   HEAD   clone failed · repository 'https://github.com/owner/repo.git/' not found",
			"   ├─ a",
			"   └─ b",
			...close("2 failed"),
		]);
	});

	it("words a clone failure by git's cause alone, out of all its stderr says", async () => {
		await repo(
			"owner/repo",
			{ "a/SKILL.md": "new" },
			{ kind: "head", resolvedSha: NEW },
		);
		unreachable.set(
			"owner/repo",
			[
				"git clone failed after 3 attempts: Cloning into '/var/folders/x1/T/agntc-Ab12Cd'...",
				"done.",
				"warning: --depth is ignored in local clones; use file:// instead.",
				"fatal: repository '/srv/git/owner/repo.git' does not exist",
				"",
			].join("\n"),
		);
		await installed({
			"owner/repo/a": entry("owner/repo", {
				files: [".claude/skills/a/", ".claude/skills/a/SKILL.md"],
			}),
		});

		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ✗ owner/repo   HEAD   clone failed · repository '/srv/git/owner/repo.git' does not exist",
			"   └─ a",
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

		expect(asking).toEqual([HEADER, "", ...ASKED_GONE]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ! owner/repo   HEAD   aaaaaaa → bbbbbbb",
			"   ├─ ✓ a              skill",
			"   └─ ! gone           kept — it's gone upstream; update will ask again",
			...close("1 updated  ·  1 kept"),
		]);
	});

	it("fails a skill from another group with the pack that took it over and then failed to install", async () => {
		await repo(
			"owner/repo",
			{
				"tools/agntc.json": PACK,
				...prefixed("tools/", SKILLS("a", "b")),
				"tools/agents/ag.md": "new",
			},
			{ kind: "head", resolvedSha: NEW },
		);
		const clone = vi.mocked(cloneSource).getMockImplementation()!;
		vi.mocked(cloneSource).mockImplementation(async (parsed) => {
			const cloned = await clone(parsed);
			await chmod(join(cloned.tempDir, "tools/agents/ag.md"), 0o000);
			return cloned;
		});
		await installed({
			"owner/repo/tools": entry("owner/repo", {
				type: "pack",
				files: [".claude/skills/b/", ".claude/skills/b/SKILL.md"],
			}),
			"owner/repo/a": entry("owner/repo", {
				ref: "main",
				files: [".claude/skills/a/", ".claude/skills/a/SKILL.md"],
			}),
		});

		const ended = await drawn();
		// The copy's error names the temporary folders, so its lines aren't
		// pinned whole: the row's head, the skill's line and the tally are.
		expect(ended[2]).toBe(
			" ✗ owner/repo@HEAD   HEAD   aaaaaaa → bbbbbbb  failed",
		);
		expect(ended).toContain(
			"   └─ a                     was removed — the pack owner/repo/tools took it over, then failed to",
		);
		expect(ended.slice(-3)).toEqual(close("2 failed"));
		expect(ended.filter((line) => line.includes("✓"))).toEqual([]);
	});

	it("names an up-to-date skill its group's pack took over once, as taken over", async () => {
		await repo(
			"owner/repo",
			{ "kit/agntc.json": PACK, ...prefixed("kit/", SKILLS("k1", "s1")) },
			{ kind: "head", resolvedSha: NEW },
		);
		await installed({
			"owner/repo/kit": entry("owner/repo", {
				type: "pack",
				files: [".claude/skills/k1/", ".claude/skills/k1/SKILL.md"],
			}),
			// Already followed into the pack by `update owner/repo/s1`.
			"owner/repo/s1": entry("owner/repo", {
				commit: NEW,
				sourceSubpath: "kit/skills/s1",
				files: [".claude/skills/s1/", ".claude/skills/s1/SKILL.md"],
			}),
		});

		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ✓ owner/repo   HEAD   aaaaaaa → bbbbbbb",
			"   ├─ kit              pack · 2 skills",
			"   └─ s1               is now part of the pack owner/repo/kit",
			...close("2 updated"),
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
			"   └─ tools              pack · 2 skills",
		]);
	});

	it("ends on its row when it's up to date, naming the entry it checked", async () => {
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
			"   └─ repo",
		]);
	});

	it("asks about an entry gone upstream under its row, and keeps it on no", async () => {
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

		const { asking, ended } = await session({
			key: "owner/repo/gone",
			answer: ["n"],
		});

		expect(asking).toEqual([HEADER, "", ...ASKED_GONE]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ! owner/repo   ^1.0.0   kept",
			"   └─ gone               kept — it's gone upstream; update will ask again",
		]);
	});

	it.each([
		[
			7,
			[
				" ! owner/repo/gone",
				"   gone upstream · skill",
				"   .claude/skills/  gone",
			],
		],
		[6, [" ! owner/repo/gone", "   … 1 more folder"]],
		[5, [" ! owner/repo/gone"]],
	])("keeps naming the entry gone upstream above its question on a 40-column screen of %i rows", async (rows, fitted) => {
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

		const { asking } = await session({
			key: "owner/repo/gone",
			answer: ["n"],
			columns: 40,
			rows,
		});

		expect(asking).toEqual([
			" ■ agntc update",
			"",
			...fitted,
			"",
			" ? Remove it and its skill?",
			"    Yes  [No]",
		]);
	});

	it("aborts on files agntc didn't install in the way, naming them, with the --overwrite re-add under Next", async () => {
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
		await write(projectDir, { ".claude/skills/b/SKILL.md": "mine" });

		expect(await drawn({ key: "owner/repo/tools" })).toEqual([
			HEADER,
			"",
			" ✗ owner/repo   ^1.0.0   v1.0.0 → v1.1.0  not updated",
			"   └─ tools              can't be updated: files agntc didn't install are in the way:",
			"                         .claude/skills/b/. The existing install is unchanged.",
			"",
			" Next",
			"   owner/repo/tools — clear them and update again, or replace them:",
			"     npx agntc remove owner/repo/tools",
			"     npx agntc add 'owner/repo/tools@^1.0.0' --pack --overwrite",
			...close("1 not updated"),
		]);
	});

	it("names a local entry under Next by its folder shortened against home, as its row does, its commands whole", async () => {
		const folder = join(testDir, "src/mypack");
		await write(folder, { "agntc.json": PACK, ...SKILLS("a", "b") });
		await installed({
			[folder]: {
				ref: null,
				commit: null,
				installedAt: "2026-10-01T00:00:00.000Z",
				files: [".claude/skills/a/", ".claude/skills/a/SKILL.md"],
				type: "pack",
				cloneUrl: null,
				localRoot: folder,
			},
		});
		await write(projectDir, { ".claude/skills/b/SKILL.md": "mine" });
		vi.mocked(checkForUpdate).mockResolvedValueOnce({ status: "local" });

		expect(await drawn({ key: folder })).toEqual([
			HEADER,
			"",
			" ✗ ~/src/mypack   local   can't be updated: files agntc didn't install are in the way:",
			"                          .claude/skills/b/. The existing install is unchanged.",
			"",
			" Next",
			"   ~/src/mypack — clear them and update again, or replace them:",
			`     npx agntc remove ${folder}`,
			`     npx agntc add ${folder} --pack --overwrite`,
			...close("1 not updated"),
		]);
	});

	it("ends on a failed row when its check fails, as the run then fails", async () => {
		targets.set("owner/repo", {
			kind: "check-failed",
			reason: "fatal: unable to access: Could not resolve host: github.com",
		});
		await installed({
			"owner/repo": entry("owner/repo", {
				ref: "v1.0.0",
				constraint: "^1.0.0",
			}),
		});

		expect(await drawn({ key: "owner/repo" })).toEqual([
			HEADER,
			"",
			" ✗ owner/repo   ^1.0.0   not checked · unable to access: Could not resolve host: github.com",
			"   └─ repo",
		]);
	});

	it("names the one entry it checked under its repo's row, not the repo's others", async () => {
		await repo(
			"owner/tools",
			{ ...SKILLS("kit", "fmt", "lint") },
			constrained("v1.1.0"),
		);
		const current = (name: string) =>
			entry("owner/tools", {
				ref: "v1.1.0",
				constraint: "^1.1.0",
				commit: NEW,
				files: [`.claude/skills/${name}/`],
			});
		await installed({
			"owner/tools/kit": current("kit"),
			"owner/tools/fmt": current("fmt"),
			"owner/tools/lint": current("lint"),
		});

		expect(await drawn({ key: "owner/tools/fmt" })).toEqual([
			HEADER,
			"",
			" ○ owner/tools   ^1.1.0   up to date",
			"   └─ fmt",
		]);
	});

	it("names no entry under a group's row when a key names several, as everything's run does", async () => {
		await repo(
			"owner/tools",
			{ ...SKILLS("kit", "fmt") },
			constrained("v1.1.0"),
		);
		const current = (name: string) =>
			entry("owner/tools", {
				ref: "v1.1.0",
				constraint: "^1.1.0",
				commit: NEW,
				files: [`.claude/skills/${name}/`],
			});
		await installed({
			"owner/tools/kit": current("kit"),
			"owner/tools/fmt": current("fmt"),
		});

		expect(await drawn({ key: "owner/tools" })).toEqual([
			HEADER,
			"",
			" ○ owner/tools   ^1.1.0   up to date",
			...close("2 up to date"),
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
			" ✓ owner/repo   ^1.0.0   removed",
			"   └─ gone               removed — it's gone upstream",
		]);
	});
});

describe("a local pack taking over a loose skill from its folder", () => {
	/** `src/L` holds the pack kit, which now holds s1, installed on its own before. */
	async function arrangeTakeover(): Promise<string> {
		const root = join(testDir, "src/L");
		await write(root, {
			"kit/agntc.json": PACK,
			"kit/skills/k1/SKILL.md": "new",
			"kit/skills/s1/SKILL.md": "new",
		});
		const local = (type: "skill" | "pack", files: string[]) => ({
			ref: null,
			commit: null,
			installedAt: "2026-10-01T00:00:00.000Z",
			files,
			type,
			cloneUrl: null,
			localRoot: root,
		});
		await write(projectDir, {
			".claude/skills/k1/SKILL.md": "old",
			".claude/skills/s1/SKILL.md": "old",
			".agntc/manifest.json": {
				[join(root, "kit")]: local("pack", [".claude/skills/k1/"]),
				[join(root, "s1")]: local("skill", [".claude/skills/s1/"]),
			},
		});
		vi.mocked(checkForUpdate).mockResolvedValue({ status: "local" });
		return root;
	}

	it.each([
		["everything", () => undefined],
		["the pack's key", (root: string) => join(root, "kit")],
		["a key naming both", (root: string) => root],
	])("names the skill under the pack's row when it updates %s", async (_, keyOf) => {
		const root = await arrangeTakeover();

		expect(await drawn({ key: keyOf(root) })).toEqual([
			HEADER,
			"",
			" ✓ ~/src/L/kit   local   refreshed · pack · 2 skills",
			"   └─ s1                 is now part of this pack",
			...close("1 updated  ·  1 refreshed"),
		]);
	});

	it("keeps a long skill's line in its row's columns when a key naming the pack but not the skill updates it", async () => {
		const root = join(testDir, "src/L");
		const long = "a-rather-long-skill-name-here";
		await write(root, {
			"a/kit/agntc.json": PACK,
			"a/kit/skills/k1/SKILL.md": "new",
			[`a/kit/skills/${long}/SKILL.md`]: "new",
			"a/other/SKILL.md": "new",
		});
		const recorded = (type: "skill" | "pack", folder: string) => ({
			ref: null,
			commit: null,
			installedAt: "2026-10-01T00:00:00.000Z",
			files: [`.claude/skills/${folder}/`],
			type,
			cloneUrl: null,
			localRoot: root,
		});
		await write(projectDir, {
			".agntc/manifest.json": {
				[join(root, "a/kit")]: recorded("pack", "k1"),
				[join(root, "a/other")]: recorded("skill", "other"),
				[join(root, long)]: recorded("skill", long),
			},
		});
		vi.mocked(checkForUpdate).mockResolvedValue({ status: "local" });

		expect((await drawn({ key: join(root, "a") })).slice(2, 4)).toEqual([
			" ✓ ~/src/L/a/kit                        local   refreshed · pack · 2 skills",
			`   └─ ${long}             is now part of this pack`,
		]);
	});

	it("keeps a long skill's line in its row's columns when the pack's key updates it", async () => {
		const root = join(testDir, "src/L");
		const long = "a-rather-long-skill-name-here";
		await write(root, {
			"kit/agntc.json": PACK,
			"kit/skills/k1/SKILL.md": "new",
			[`kit/skills/${long}/SKILL.md`]: "new",
		});
		const recorded = (type: "skill" | "pack", folder: string) => ({
			ref: null,
			commit: null,
			installedAt: "2026-10-01T00:00:00.000Z",
			files: [`.claude/skills/${folder}/`],
			type,
			cloneUrl: null,
			localRoot: root,
		});
		await write(projectDir, {
			".agntc/manifest.json": {
				[join(root, "kit")]: recorded("pack", "k1"),
				[join(root, long)]: recorded("skill", long),
			},
		});
		vi.mocked(checkForUpdate).mockResolvedValue({ status: "local" });

		// The block opens before the update, so it measures the skill as one
		// the pack may take over.
		expect((await drawn({ key: join(root, "kit") })).slice(2, 4)).toEqual([
			" ✓ ~/src/L/kit                          local   refreshed · pack · 2 skills",
			`   └─ ${long}             is now part of this pack`,
		]);
	});

	it.each([
		["everything", () => undefined],
		["the pack's key", (root: string) => join(root, "kit")],
	])("fails the skill with the pack when the pack's copy fails, updating %s", async (_, keyOf) => {
		const root = await arrangeTakeover();
		const unreadable = join(root, "kit/agents/ag.md");
		await write(root, { "kit/agents/ag.md": "new" });
		await chmod(unreadable, 0o000);

		const ended = await drawn({ key: keyOf(root) });
		// The copy's error names the temporary folders, so its lines aren't
		// pinned whole: the row's head, the skill's line and the tally are.
		expect(ended[2]).toMatch(
			/^ ✗ ~\/src\/L\/kit {3}local {3}update failed after removing old files \(EACCES/,
		);
		const child = ended.indexOf(
			"   └─ s1                 was removed — this pack took it over, then failed to install",
		);
		expect(ended.slice(child + 1, child + 4)).toEqual([
			"",
			" Next",
			"   ~/src/L/kit — to install it again:",
		]);
		expect(ended.slice(-3)).toEqual(close("2 failed"));
		expect(ended.filter((line) => line.includes("✓"))).toEqual([]);
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

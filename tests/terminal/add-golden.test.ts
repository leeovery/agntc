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

vi.mock("../../src/git-clone.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-clone.js")>()),
	cloneSource: vi.fn(),
}));

vi.mock("../../src/git-utils.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/git-utils.js")>()),
	fetchRemoteTags: vi.fn(),
}));

vi.mock("../../src/copy-item.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/copy-item.js")>()),
	copyItem: vi.fn(),
}));

import { type AddOptions, runAdd } from "../../src/commands/add.js";
import { copyItem } from "../../src/copy-item.js";
import { ExitSignal } from "../../src/exit-signal.js";
import { cloneSource } from "../../src/git-clone.js";
import { fetchRemoteTags } from "../../src/git-utils.js";
import { projectScope } from "../../src/scope.js";
import { TerminalUi } from "../../src/terminal/terminal-ui.js";
import { KEY, Terminal } from "./prompts/terminal.js";

// Whole add runs drawn by the real terminal Ui into a headless xterm, 100
// columns, colour off, compared line for line, so the look can't drift.

const SHA = "c".repeat(40);
const PACK = { type: "pack" };
/** `left`, then `right` ending at the right margin. */
const atRight = (left: string, right: string) =>
	`${left}${" ".repeat(99 - left.length - right.length)}${right}`;
const HEADER = atRight(" ■ agntc add", "~/project · v1.2.3");
const QUESTION = atRight(
	" ? Select what to install",
	"↑↓ move · space pick · a all · ⏎ done · esc cancel",
);
const RULE = ` ${"─".repeat(98)}`;
const close = (tally: string) => ["", RULE, atRight(` ${tally}`, "2.4s")];

const actualCopyItem = await vi.importActual<
	typeof import("../../src/copy-item.js")
>("../../src/copy-item.js");

let testDir: string;
let projectDir: string;
let upstreamDir: string;

beforeEach(async () => {
	vi.clearAllMocks();
	testDir = await realpath(await mkdtemp(join(tmpdir(), "agntc-add-golden-")));
	projectDir = join(testDir, "project");
	upstreamDir = join(testDir, "upstream");
	await mkdir(projectDir, { recursive: true });
	await mkdir(upstreamDir, { recursive: true });
	vi.mocked(fetchRemoteTags).mockResolvedValue([]);
	vi.mocked(cloneSource).mockImplementation(async () => {
		const tempDir = await mkdtemp(join(testDir, "clone-"));
		await cp(upstreamDir, tempDir, { recursive: true });
		return { tempDir, commit: SHA };
	});
	vi.mocked(copyItem).mockImplementation(actualCopyItem.copyItem);
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

async function upstream(files: Record<string, string | object>): Promise<void> {
	await write(upstreamDir, files);
}

interface Run {
	source?: string;
	options?: AddOptions;
	/** Keys pressed once the run asks its question. */
	answer?: string[];
	/** Keys pressed once the run asks a second question, as its words show. */
	later?: { asked: string; answer: string[] };
}

/** The terminal while the run asks its first question, and once it has ended. */
async function session({
	source = "owner/repo",
	options = {},
	answer,
	later,
}: Run = {}): Promise<{ asking: string[]; ended: string[] }> {
	const term = new Terminal(100, 60);
	let asking: string[] = [];
	let now = 0;
	const ui = new TerminalUi({
		header: { command: "add", where: "~/project", version: "1.2.3" },
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
	const running = runAdd(source, options, ui, projectScope(projectDir));
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
	return { asking, ended: await term.lines() };
}

async function drawn(run: Run = {}): Promise<string[]> {
	return (await session(run)).ended;
}

const MENU_SOURCE = {
	"laravel/agntc.json": PACK,
	"laravel/skills/eloquent/SKILL.md": "",
	"laravel/skills/queues/SKILL.md": "",
	"nuxt/agntc.json": PACK,
	"nuxt/skills/nitro/SKILL.md": "",
	"nuxt/skills/shared/README.md": "",
	"git-hygiene/SKILL.md":
		"---\ndescription: Keep commits small and messages honest\n---\n",
	"release-notes/SKILL.md":
		"---\ndescription: Draft release notes from the changes since the last tag\n---\n",
};

describe("an add through the menu", () => {
	it("asks under the source's row, then hangs what installed beneath it", async () => {
		await upstream(MENU_SOURCE);
		vi.mocked(fetchRemoteTags).mockResolvedValue(["v0.2.5"]);

		const { asking, ended } = await session({
			answer: [KEY.space, KEY.down, KEY.down, KEY.space, KEY.enter],
		});

		expect(asking).toEqual([
			HEADER,
			"",
			" ✓ owner/repo           v0.2.5 ^0.2.5   2 packs · 2 skills",
			"",
			QUESTION,
			" ▌ ○ laravel         pack · 2 skills",
			"   ○ nuxt            pack · 1 skill, 1 folder",
			"   ○ git-hygiene     Keep commits small and messages honest",
			"   ○ release-notes   Draft release notes from the changes since the last tag",
			"",
			atRight("", "0 of 4 picked"),
		]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ✓ owner/repo           v0.2.5 ^0.2.5   2 of 4 installed",
			"   ├─ laravel                           pack · 2 skills",
			"   └─ git-hygiene                       skill",
			...close("2 installed"),
		]);
	});

	it("counts the skills an installed pack holds on one line while asking, naming each once it has installed", async () => {
		await upstream({
			"skills/api/SKILL.md": "",
			"skills/db/SKILL.md": "",
			"skills/ui/SKILL.md": "",
			"skills/jobs/SKILL.md": "",
			"skills/lint/SKILL.md": "",
		});
		const held = ["api", "db", "ui"].map((name) => `.claude/skills/${name}/`);
		await write(projectDir, {
			...Object.fromEntries(held.map((path) => [`${path}SKILL.md`, ""])),
			".agntc/manifest.json": {
				"owner/repo/p": {
					ref: null,
					commit: "old",
					installedAt: "2026-01-01T00:00:00.000Z",
					files: held,
					type: "pack",
					cloneUrl: "https://github.com/owner/repo.git",
				},
			},
		});

		const { asking, ended } = await session({
			answer: [KEY.space, KEY.enter],
		});

		expect(asking).toEqual([
			HEADER,
			"",
			" ✓ owner/repo         HEAD   5 skills",
			"   └─ · 3 skills             already installed as part of the pack owner/repo/p",
			"",
			QUESTION,
			" ▌ ○ skills/jobs",
			"   ○ skills/lint",
			"",
			atRight("", "0 of 2 picked"),
		]);
		expect(ended).toEqual([
			HEADER,
			"",
			" ✓ owner/repo         HEAD   1 of 2 installed",
			"   ├─ skills/jobs            skill",
			"   ├─ · skills/api           already installed as part of the pack owner/repo/p",
			"   ├─ · skills/db            already installed as part of the pack owner/repo/p",
			"   └─ · skills/ui            already installed as part of the pack owner/repo/p",
		]);
	});

	it("leaves the source's row, unchanged, when nothing is picked", async () => {
		await upstream(MENU_SOURCE);

		expect(await drawn({ answer: [KEY.enter] })).toEqual([
			HEADER,
			"",
			" ○ owner/repo           HEAD   2 packs · 2 skills",
			"",
			" ○ Cancelled — nothing selected",
		]);
	});
});

describe("an add of one thing", () => {
	it("installs it without a menu, under the source's row, ending there", async () => {
		await upstream({
			"agntc.json": PACK,
			"skills/a/SKILL.md": "",
			"skills/b/SKILL.md": "",
			"agents/reviewer.md": "",
			"hooks/pre.sh": "",
		});

		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ✓ owner/repo   HEAD   1 pack",
			"   └─ repo             pack · 2 skills, 1 agent, 1 hook",
		]);
	});

	it("carries a skill's note under it when it's taken from its pack", async () => {
		await upstream({
			"p/agntc.json": PACK,
			"p/skills/a/SKILL.md": "",
			"p/skills/b/SKILL.md": "",
			"p/hooks/h.sh": "",
		});

		expect(await drawn({ options: { skill: ["a"] } })).toEqual([
			HEADER,
			"",
			" ✓ owner/repo      HEAD   1 pack",
			"   └─ p/skills/a          skill",
			"                          part of the pack p — installed on its own, without b and its hooks",
		]);
	});
});

describe("an add with files in the way", () => {
	it("asks about them where the menu was, then draws the source's row under them, a blank line apart", async () => {
		await upstream({ "a/SKILL.md": "", "b/SKILL.md": "" });
		await write(projectDir, {
			".claude/skills/a/SKILL.md": "theirs",
			".agntc/manifest.json": {
				"other/repo": {
					ref: null,
					commit: "old",
					installedAt: "2026-01-01T00:00:00.000Z",
					files: [".claude/skills/a/"],
					type: "skill",
					cloneUrl: "https://github.com/other/repo.git",
				},
			},
		});

		const { ended } = await session({
			answer: [KEY.space, KEY.enter],
			later: { asked: "How would you like to proceed", answer: [KEY.enter] },
		});

		expect(ended).toEqual([
			HEADER,
			"",
			' File collision with "other/repo"',
			"   - .claude/skills/a/",
			"",
			" ✓ owner/repo   HEAD   1 of 2 installed",
			"   └─ a                skill",
		]);
	});
});

describe("an add --list", () => {
	it("hangs everything the source holds under its row, installing nothing", async () => {
		await upstream(MENU_SOURCE);

		expect(
			await drawn({ source: "owner/repo@v1.0.0", options: { list: true } }),
		).toEqual([
			HEADER,
			"",
			" ✓ owner/repo         v1.0.0   2 packs · 2 skills",
			"   ├─ laravel                  pack · 2 skills",
			"   ├─ nuxt                     pack · 1 skill, 1 folder",
			"   ├─ git-hygiene              Keep commits small and messages honest",
			"   └─ release-notes            Draft release notes from the changes since the last tag",
		]);
	});
});

describe("an add with a stray", () => {
	it("puts the --pack line that would install its agents under Next", async () => {
		await upstream({ "tools/agents/a.md": "", "lint/SKILL.md": "" });

		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ✓ owner/repo   HEAD   1 skill",
			"   └─ lint             skill",
			"",
			" Next",
			"   tools — has agents/ that won't be installed. To install them as a pack:",
			"     npx agntc add owner/repo/tools --pack",
			...close("1 installed"),
		]);
	});

	it("ends a --list on Next, with no rule or tally, as it installs nothing", async () => {
		await upstream({ "tools/agents/a.md": "", "lint/SKILL.md": "" });

		expect(await drawn({ options: { list: true } })).toEqual([
			HEADER,
			"",
			" ✓ owner/repo   HEAD   1 skill",
			"   └─ lint",
			"",
			" Next",
			"   tools — has agents/ that won't be installed. To install them as a pack:",
			"     npx agntc add owner/repo/tools --pack",
		]);
	});
});

describe("an add refused", () => {
	it("draws the source's row, then what was queued, then the refusal", async () => {
		await upstream({ "agents/a.md": "" });

		expect(await drawn({ source: "owner/repo@v1.0.0" })).toEqual([
			HEADER,
			"",
			" ○ owner/repo   v1.0.0   no skills or packs",
			"",
			" Next",
			"   repo — has agents/ that won't be installed. To install them as a pack:",
			"     npx agntc add owner/repo@v1.0.0 --pack",
			"",
			" ✗ owner/repo: no skills or packs were found",
		]);
	});

	it("keeps the source's row, unchanged, over a pick it refuses", async () => {
		await upstream({ "x/foo/SKILL.md": "", "y/foo/SKILL.md": "" });

		expect(
			await drawn({ answer: [KEY.space, KEY.down, KEY.space, KEY.enter] }),
		).toEqual([
			HEADER,
			"",
			" ○ owner/repo   HEAD   2 skills",
			"",
			" ✗ owner/repo: x/foo and y/foo would both install to .claude/skills/foo — choose one",
		]);
	});

	it("fails the source's row once the copy has begun, as files may be on disk", async () => {
		await upstream({ "a/SKILL.md": "" });
		const agntc = join(projectDir, ".agntc");
		await mkdir(agntc, { recursive: true });
		vi.mocked(copyItem).mockImplementationOnce(async (...args) => {
			await chmod(agntc, 0o500);
			return actualCopyItem.copyItem(...args);
		});

		try {
			const ended = await drawn();

			expect(ended.slice(0, 4)).toEqual([
				HEADER,
				"",
				" ✗ owner/repo   HEAD   1 skill",
				"",
			]);
			expect(ended[4]).toMatch(/^ ✗ EACCES/);
		} finally {
			await chmod(agntc, 0o700);
		}
	});

	it("fails on a clone that fails, leaving nothing of its progress", async () => {
		vi.mocked(cloneSource).mockRejectedValue(
			new Error(
				"git clone failed after 3 attempts: fatal: repository 'https://github.com/owner/repo.git/' not found",
			),
		);

		expect(await drawn()).toEqual([
			HEADER,
			"",
			" ✗ git clone failed after 3 attempts: fatal: repository 'https://github.com/owner/repo.git/' not",
			"   found",
		]);
	});
});

describe("an add with an item that fails", () => {
	it("marks each item by how it ended, and closes on the tally", async () => {
		await upstream({ "a/SKILL.md": "", "b/SKILL.md": "" });
		vi.mocked(copyItem).mockImplementation(async (item, source, root) => {
			if (item.kind === "skill" && item.skill.name === "a") {
				throw new Error("disk full");
			}
			return actualCopyItem.copyItem(item, source, root);
		});

		expect(await drawn({ options: { all: true } })).toEqual([
			HEADER,
			"",
			" ✗ owner/repo   HEAD   2 skills",
			"   ├─ ✗ a              disk full",
			"   └─ ✓ b              skill",
			...close("1 installed  ·  1 failed"),
		]);
	});

	it("puts the remedy for a key another entry holds under Next", async () => {
		await upstream({ "skills/foo/SKILL.md": "", "tools/SKILL.md": "" });
		await write(projectDir, {
			".claude/skills/bar/SKILL.md": "",
			".agntc/manifest.json": {
				"owner/repo/foo": {
					ref: null,
					commit: "old",
					installedAt: "2026-01-01T00:00:00.000Z",
					files: [".claude/skills/bar/"],
					type: "pack",
					cloneUrl: "https://github.com/owner/repo.git",
				},
			},
		});

		expect(await drawn({ options: { all: true } })).toEqual([
			HEADER,
			"",
			" ✗ owner/repo        HEAD   2 skills",
			"   ├─ ✗ skills/foo          already installed from foo, as a pack",
			"   └─ ✓ tools               skill",
			"",
			" Next",
			"   owner/repo/foo — to replace it:",
			"     npx agntc remove owner/repo/foo",
			"     then add again",
			...close("1 installed  ·  1 failed"),
		]);
	});
});

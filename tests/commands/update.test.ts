import type { Stats } from "node:fs";
import { homedir } from "node:os";
import { basename, join, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../../src/exit-signal.js";
import type { Manifest, ManifestEntry } from "../../src/manifest.js";
import { type Message, machineOnly, sentence } from "../../src/message.js";
import type {
	BlockSubject,
	NextItem,
	Progress,
	Row,
} from "../../src/terminal/types.js";
import type { Tally, UpdateTally } from "../../src/ui.js";
import type { UpdateCheckResult } from "../../src/update-check.js";

vi.mock("../../src/manifest.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/manifest.js")>()),
	readManifest: vi.fn(),
	readManifestOrExit: vi.fn(),
	writeManifest: vi.fn(),
	addEntry: vi.fn(),
	removeEntry: vi.fn(),
}));

vi.mock("../../src/update-check.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/update-check.js")>();
	return {
		// Single-key path (runSingleUpdate) still resolves per key via checkForUpdate.
		checkForUpdate: vi.fn(),
		// Grouped path (runGroupedUpdates) resolves ONE target per group (task 1-5);
		// categorizeMember stays REAL so a mocked/bridged target is classified by the
		// production rule against each member's own installed commit.
		resolveGroupTarget: vi.fn(),
		categorizeMember: actual.categorizeMember,
		hasOutOfConstraintVersion: actual.hasOutOfConstraintVersion,
	};
});

vi.mock("../../src/git-clone.js", () => ({
	cloneSource: vi.fn(),
	cleanupTempDir: vi.fn(),
}));

vi.mock("../../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../../src/copy-pack.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/copy-pack.js")>()),
	copyPack: vi.fn(),
}));

vi.mock("../../src/unmanaged-check.js", () => ({
	checkUnmanagedConflicts: vi.fn(),
}));

vi.mock("../../src/dropped-folders.js", () => ({
	droppedButInSource: vi.fn(),
}));

vi.mock("../../src/discover.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/discover.js")>()),
	discover: vi.fn(),
}));

vi.mock("../../src/copy-bare-skill.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../src/copy-bare-skill.js")>()),
	copyBareSkill: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({
	stat: vi.fn(),
	access: vi.fn(),
	readdir: vi.fn(async () => []),
}));

vi.mock("../../src/copy-safety.js", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("../../src/copy-safety.js")>();
	const { mockCopySafety } = await import("../helpers/copy-safety-mock.js");
	return {
		...actual,
		...mockCopySafety(actual.SymlinkEscapeError),
	};
});

import { access, stat } from "node:fs/promises";
import { runUpdate, updateCommand } from "../../src/commands/update.js";
import { copyBareSkill } from "../../src/copy-bare-skill.js";
import { copyPack } from "../../src/copy-pack.js";
import {
	SymlinkEscapeError,
	scanForEscapingSymlinks,
} from "../../src/copy-safety.js";
import {
	type Discovery,
	discover,
	type FoundPack,
	PackConflictError,
} from "../../src/discover.js";
import { droppedButInSource } from "../../src/dropped-folders.js";
import { cleanupTempDir, cloneSource } from "../../src/git-clone.js";
import {
	addEntry,
	readManifest,
	readManifestOrExit,
	removeEntry,
	writeManifest,
} from "../../src/manifest.js";
import { nukeManifestFiles } from "../../src/nuke-files.js";
import { checkUnmanagedConflicts } from "../../src/unmanaged-check.js";
import {
	checkForUpdate,
	type GroupTarget,
	resolveGroupTarget,
} from "../../src/update-check.js";

const mockReadManifest = vi.mocked(readManifest);
const mockReadManifestOrExit = vi.mocked(readManifestOrExit);
const mockWriteManifest = vi.mocked(writeManifest);
const mockAddEntry = vi.mocked(addEntry);
const mockRemoveEntry = vi.mocked(removeEntry);
const mockCheckForUpdate = vi.mocked(checkForUpdate);
const mockResolveGroupTarget = vi.mocked(resolveGroupTarget);
const mockCloneSource = vi.mocked(cloneSource);
const mockCleanupTempDir = vi.mocked(cleanupTempDir);
const mockNukeManifestFiles = vi.mocked(nukeManifestFiles);
const mockCopyPack = vi.mocked(copyPack);
const mockDiscover = vi.mocked(discover);
const mockCheckUnmanaged = vi.mocked(checkUnmanagedConflicts);
const mockDroppedButInSource = vi.mocked(droppedButInSource);

const LARAVEL_PACK: FoundPack = {
	name: "repo",
	path: "",
	skills: [{ name: "new-skill", path: "skills/new-skill" }],
	supportFolders: [],
	assetDirs: ["agents"],
};

function onlyPack(pack: FoundPack): Discovery {
	return { packs: [pack], skills: [], strays: [] };
}

/**
 * Arranges the re-walk a skill falls back to when its recorded path no longer
 * holds one: it finds a loose skill at each path, named for its folder.
 */
function rewalkFinds(...paths: string[]): void {
	mockDiscover.mockResolvedValue({
		packs: [],
		skills: paths.map((path) => ({ name: basename(path), path })),
		strays: [],
	});
}
const mockCopyBareSkill = vi.mocked(copyBareSkill);
const mockStat = vi.mocked(stat);
const mockAccess = vi.mocked(access);
const mockScanForEscapingSymlinks = vi.mocked(scanForEscapingSymlinks);

import { globalScope } from "../../src/scope.js";
import { makeEntry } from "../helpers/factories.js";
import { SSH_REFUSAL } from "../helpers/git-mocks.js";
import { runMachine } from "../helpers/machine.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

const INSTALLED_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);
const HOME = "/home/lee";
const GLOBAL = globalScope(HOME);

// --- All-mode group-target bridge ---
// runGroupedUpdates resolves ONE GroupTarget per group (task 1-5) instead of a
// per-member checkForUpdate. To keep the behavioural all-mode regression tests
// expressing intent via checkForUpdate (their existing arrange), this bridge is
// installed as the DEFAULT resolveGroupTarget mock: it derives the group's
// target from the desired per-key UpdateCheckResult (read off the still-mocked
// checkForUpdate for the group's representative member), so the REAL
// categorizeMember + processGroupUpdate then run unchanged. Tests that assert
// directly on the seam (the clone-once cases + the four migrated cases) override
// this with an explicit mockResolveGroupTarget. Locals never reach here (they
// are excluded from grouping), and only groups-of-one occur in these tests, so
// the representative member IS the group.
function groupTargetFromCheckResult(
	entry: ManifestEntry,
	result: UpdateCheckResult,
): GroupTarget {
	switch (result.status) {
		case "update-available":
			return entry.ref === null
				? { kind: "head", resolvedSha: result.remoteCommit }
				: { kind: "branch", resolvedSha: result.remoteCommit };
		case "up-to-date":
			return entry.ref === null
				? { kind: "head", resolvedSha: entry.commit! }
				: { kind: "branch", resolvedSha: entry.commit! };
		case "newer-tags":
			return { kind: "tag", tag: entry.ref!, newerTags: result.tags };
		case "check-failed":
			return { kind: "check-failed", reason: result.reason };
		case "constrained-update-available":
			return {
				kind: "constrained",
				tag: result.tag,
				commit: result.commit,
				latestOverall: result.latestOverall,
			};
		case "constrained-up-to-date":
			return {
				kind: "constrained",
				tag: entry.ref!,
				commit: entry.commit!,
				latestOverall: result.latestOverall,
			};
		case "constrained-no-match":
			return { kind: "constrained-no-match" };
		case "local":
			throw new Error("local entries are excluded from grouping");
	}
}

function installGroupTargetBridge(): void {
	mockResolveGroupTarget.mockImplementation(async (group) => {
		const { key, entry } = group.members[0]!;
		const result = await mockCheckForUpdate(key, entry);
		return groupTargetFromCheckResult(entry, result);
	});
}

let ui: TestUi;

/** Everything update showed at the terminal, as the double took it. */
interface Drawn {
	/** Each block's subjects, as it opened with them. */
	subjects: BlockSubject[][];
	rows: Row[];
	next: NextItem[];
	notes: Message[];
	/** What each close was given to count. */
	tally: Tally[];
}

function drawn(): Drawn {
	return {
		subjects: ui.block.mock.calls.map(([subjects]) => [...subjects]),
		rows: ui.rows(),
		next: ui.next.mock.calls.map(([item]) => item),
		notes: ui.note.mock.calls.map(([message]) => message),
		tally: ui.close.mock.calls.map(([tally]) => tally),
	};
}

/** What every task the run's blocks spun said it was doing, in the order they started. */
function progress(): Progress[] {
	return ui.blocks.flatMap((block) =>
		block.task.mock.calls.map(([step]) => step),
	);
}

/** When the row with `subject` was drawn, in the order of every mocked call. */
function drawnAt(subject: string): number {
	const calls = ui.blocks.flatMap(({ row, tasks }) =>
		[row, ...tasks.map(({ settle }) => settle)].flatMap((fn) =>
			fn.mock.calls.map(([drawnRow], i) => ({
				subject: drawnRow.subject,
				order: fn.mock.invocationCallOrder[i]!,
			})),
		),
	);
	const call = calls.find((drawnRow) => drawnRow.subject === subject);
	if (call === undefined) {
		throw new Error(`no row for ${subject}`);
	}
	return call.order;
}

/** What a run drew: nothing, but for what's given. */
function screen(drew: Partial<Drawn>): Drawn {
	return { subjects: [], rows: [], next: [], notes: [], tally: [], ...drew };
}

const NOTHING_INSTALLED = screen({
	subjects: [[{ subject: "No skills or packs installed." }]],
	rows: [{ status: "unchanged", subject: "No skills or packs installed." }],
});

/** A group's block subject: its label and intent, each member given a glyph's room. */
function group(subject: string, meta: string, ...members: string[]) {
	return {
		subject,
		meta,
		children: members.map((name) => ({ name, status: "done" as const })),
	};
}

function local(path: string): BlockSubject {
	return { subject: path, meta: "local" };
}

/** The one close of a run, counting `counts`. */
function closed(counts: UpdateTally): Tally[] {
	return [{ command: "update", counts }];
}

const OLD7 = "aaaaaaa";
const NEW7 = "bbbbbbb";
const HASHES = { from: OLD7, to: NEW7 };

/**
 * Who ran the update: all-mode; a key naming several entries; or a key
 * naming one, `member` its entry's name. A key's check that failed or found
 * no tag fails the run, so its row is failed where all-mode's only needs a
 * look; a key naming one entry names it beneath its row, as a group's row
 * names none.
 */
type RunBy = "all" | "prefix" | { member: string };

function leftAlone(row: Row, by: RunBy, failsAKey = false): Row {
	const status = failsAKey && by !== "all" ? "failed" : row.status;
	return typeof by === "object"
		? { ...row, status, children: [{ name: by.member }] }
		: { ...row, status };
}

function upToDate(subject: string, meta: string, by: RunBy = "all"): Row {
	return leftAlone(
		{ status: "unchanged", subject, meta, detail: "up to date" },
		by,
	);
}

function notChecked(
	subject: string,
	meta: string,
	cause: string,
	by: RunBy = "all",
): Row {
	return leftAlone(
		{
			status: "attention",
			subject,
			meta,
			detail: { label: "not checked", aside: cause },
		},
		by,
		true,
	);
}

function noMatch(subject: string, constraint: string, by: RunBy = "all"): Row {
	return leftAlone(
		{
			status: "attention",
			subject,
			meta: constraint,
			detail: { label: `no tags satisfy ${constraint}` },
		},
		by,
		true,
	);
}

function newerTags(subject: string, meta: string, by: RunBy = "all"): Row {
	return leftAlone(
		{ status: "unchanged", subject, meta, detail: "newer tags available" },
		by,
	);
}

/** A group whose members all updated along `move`, each `[name, detail]`. */
function updated(
	subject: string,
	meta: string,
	move: { from: string; to: string },
	...children: [name: string, detail: string][]
): Row {
	return {
		status: "done",
		subject,
		meta,
		detail: { move },
		children: children.map(([name, detail]) => ({ name, detail })),
	};
}

/** A local entry refreshed from its folder, what it installed aside. */
function refreshed(path: string, aside: string): Row {
	return {
		status: "done",
		subject: path,
		meta: "local",
		detail: { label: "refreshed", aside },
	};
}

/** A group none of whose members landed, `ended` beside its move. */
function stopped(
	subject: string,
	meta: string,
	move: { from: string; to: string },
	ended: string,
	...children: [name: string, detail: string][]
): Row {
	return {
		status: "failed",
		subject,
		meta,
		detail: { move, note: ended },
		children: children.map(([name, detail]) => ({ name, detail })),
	};
}

function cloneFailed(
	subject: string,
	meta: string,
	reason: string,
	...members: string[]
): Row {
	return {
		status: "failed",
		subject,
		meta,
		detail: { label: "clone failed", aside: reason },
		children: members.map((name) => ({ name })),
	};
}

/** The Next item that follows a moved skill to one of the `adds` now named as it was. */
function followOne(subject: string, ...adds: string[]): NextItem {
	return {
		subject,
		remedy: {
			lead: "To follow one of them:",
			steps: [{ command: `npx agntc remove ${subject}` }, { choice: adds }],
		},
	};
}

/** What a moved skill's abort says, `name` now the folder of each of `paths`. */
function nowNamed(name: string, ...paths: string[]): string {
	return `can't be updated: its SKILL.md is gone from ${name} and ${paths.length} skills are now named ${name}: ${paths.join(", ")}. The existing install is unchanged.`;
}

const ESCAPE =
	'symlink "evil-link" points outside the clone (target: /etc/passwd). agntc won\'t follow that symlink, so the update is blocked. The existing install is unchanged.';

/** The Next item a key pinned to `ref` queues, `tags` newest first. */
function pinnedKey(
	subject: string,
	ref: string,
	tags: string[],
	command: string,
): NextItem {
	return {
		subject,
		remedy: {
			lead: `Pinned to ${ref}, newer tags available (latest: ${tags[0]}). To upgrade:`,
			steps: [{ command }],
		},
	};
}

/** The Next item that moves `subject` past its constraint. */
function upgrade(
	subject: string,
	current: string,
	latest: string,
	...commands: string[]
): NextItem {
	return {
		subject,
		remedy: {
			lead: `Newer version outside the constraint: ${current} → ${latest} available. To upgrade:`,
			steps: commands.map((command) => ({ command })),
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	ui = testUi();
	vi.spyOn(process, "cwd").mockReturnValue("/fake/project");
	mockWriteManifest.mockResolvedValue(undefined);
	mockCleanupTempDir.mockResolvedValue(undefined);
	mockNukeManifestFiles.mockResolvedValue({ removed: [], skipped: [] });
	// Default: the recorded structural unit still exists in the re-clone, so the
	// derive-before-delete gate passes (pathExists -> access resolves).
	mockAccess.mockResolvedValue(undefined);
	// Default: no escaping symlink in the re-clone (copy-safety scan passes).
	mockScanForEscapingSymlinks.mockResolvedValue(undefined);
	mockCheckUnmanaged.mockResolvedValue([]);
	mockDroppedButInSource.mockResolvedValue([]);
	mockAddEntry.mockImplementation((manifest, key, entry) => ({
		...manifest,
		[key]: entry,
	}));
	mockRemoveEntry.mockImplementation((manifest, key) => {
		const { [key]: _, ...rest } = manifest;
		return rest;
	});
	installGroupTargetBridge();
});

describe("update command", () => {
	describe("header", () => {
		it("opens on the header (all-plugins mode)", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate(undefined, {}, ui);

			expect(ui.header).toHaveBeenCalledOnce();
		});

		it("opens on the header (single-key mode)", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate("owner/repo", {}, ui);

			expect(ui.header).toHaveBeenCalledOnce();
		});
	});

	describe("all-plugins mode (no key)", () => {
		it("displays message and exits 0 when manifest is empty", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(NOTHING_INSTALLED);
			expect(mockCheckForUpdate).not.toHaveBeenCalled();
		});

		it("checks all entries in parallel", async () => {
			const entryA = makeEntry({ commit: INSTALLED_SHA });
			const entryB = makeEntry({ commit: INSTALLED_SHA });
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});

			let resolveA!: (v: UpdateCheckResult) => void;
			let resolveB!: (v: UpdateCheckResult) => void;
			const promiseA = new Promise<UpdateCheckResult>((r) => {
				resolveA = r;
			});
			const promiseB = new Promise<UpdateCheckResult>((r) => {
				resolveB = r;
			});

			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a") {
						return promiseA;
					}
					return promiseB;
				},
			);

			const runPromise = runUpdate(undefined, {}, ui);

			// Wait a tick for both to start
			await new Promise((r) => setTimeout(r, 10));

			// Both should be inflight (parallel check)
			expect(mockCheckForUpdate).toHaveBeenCalledTimes(2);

			resolveA({ status: "up-to-date" });
			resolveB({ status: "up-to-date" });

			await runPromise;
		});

		it("shows spinner during parallel checks", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate(undefined, {}, ui);

			const [block] = ui.blocks;
			expect(block!.task.mock.calls[0]).toEqual([
				{ text: "checking for updates…" },
			]);
			expect(block!.tasks[0]!.clear).toHaveBeenCalledOnce();
			expect(block!.tasks[0]!.settle).not.toHaveBeenCalled();
		});

		it("shows all up-to-date message when every entry is current", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry(),
				"owner/repo-b": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "HEAD", "repo-b"),
						],
					],
					rows: [
						upToDate("owner/repo-a", "HEAD"),
						upToDate("owner/repo-b", "HEAD"),
					],
					tally: closed({ upToDate: 2 }),
				}),
			);
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("processes update-available plugins via git update", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			// Migrated onto the group seam (task 1-5): all-mode resolves one target
			// per group; the HEAD-tracked entry categorizes update-available.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockCloneSource).toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
				expect.objectContaining({
					commit: REMOTE_SHA,
				}),
			);
		});

		it("processes local plugins via re-copy", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: LOCAL_KEY,
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("shows info for newer-tags plugins without updating", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "v1.0", "repo")]],
					rows: [newerTags("owner/repo", "v1.0")],
					next: [
						{
							subject: "owner/repo",
							remedy: {
								lead: "Pinned to v1.0, newer tags available (latest: v3.0). To upgrade:",
								steps: [{ command: "npx agntc add owner/repo@v3.0" }],
							},
						},
					],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});

		it("notes check-failed plugins in summary", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [notChecked("owner/repo", "HEAD", "network timeout")],
					tally: closed({ notChecked: 1 }),
				}),
			);
		});

		it("all-plugins update emits no check-failed warning for a v4-branch entry resolving to a real status", async () => {
			// Contrast with "notes check-failed plugins in summary": once the "v4"
			// branch ref resolves to a real status (Task 1.2), the all-plugins summary
			// must NOT warn about a check failure for that entry.
			mockReadManifestOrExit.mockResolvedValue({
				"nuxt/ui": makeEntry({ ref: "v4", commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("nuxt/ui", "v4", "ui")]],
					rows: [upToDate("nuxt/ui", "v4")],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});

		// NOTE: the former 'performs single manifest write for multiple updates'
		// test asserted a SINGLE end-of-run write. Under task 1-6 per-group
		// persistence that expectation is wrong (N groups → N writes); it is
		// superseded by 'writes the manifest once per updatable group (two groups
		// -> two writes)' in the "per-group manifest persistence (task 1-6)" block.

		it("continues processing when one plugin fails during update", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			// Migrated onto the group seam (task 1-5): both resolve update-available;
			// group A's clone fails (group-fatal → failed outcome), group B succeeds.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});

			// First clone fails, second succeeds
			mockCloneSource
				.mockRejectedValueOnce(new Error("clone failed"))
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			// Partial failure: B is still processed and written, but the run exits
			// non-zero because A hard-errored. Catch so the assertions below run.
			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// B should have been processed despite A failing
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("handles mixed types in a single run", async () => {
			const gitEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/git-skill/"],
			});
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/local-skill/"],
				cloneUrl: null,
			};
			const tagEntry = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				files: [".claude/skills/tagged-skill/"],
			});
			const upToDateEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/current-skill/"],
			});

			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-git": gitEntry,
				"/local/path": localEntry,
				"owner/repo-tag": tagEntry,
				"owner/repo-current": upToDateEntry,
			});

			// Migrated onto the group seam (task 1-5): the local entry is excluded
			// from grouping (handled as a group-of-one, no target). Each remaining
			// group resolves one target; categorizeMember derives the per-member
			// verdict against its own installed commit.
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				if (key === "owner/repo-git")
					return { kind: "head", resolvedSha: REMOTE_SHA };
				if (key === "owner/repo-tag")
					return { kind: "tag", tag: "v1.0", newerTags: ["v2.0"] };
				return { kind: "head", resolvedSha: INSTALLED_SHA };
			});

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/some-skill/"],
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);

			await runUpdate(undefined, {}, ui);

			// Git update should clone
			expect(mockCloneSource).toHaveBeenCalled();
			// Local update should stat
			expect(mockStat).toHaveBeenCalled();
			// Tag-pinned should not clone or nuke.
			// Per-group persistence (task 1-6): the git group and the local
			// group-of-one each persist independently → two writes (tag-pinned and
			// up-to-date never mutate, so they add no write).
			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
		});

		it("shows per-plugin summary", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});

			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return { status: "update-available", remoteCommit: REMOTE_SHA };
					return { status: "up-to-date" };
				},
			);

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate(undefined, {}, ui);

			// The updated repo-a settles into its row as it lands; repo-b, up to
			// date, follows once the actioned work has.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "HEAD", "repo-b"),
						],
					],
					rows: [
						updated("owner/repo-a", "HEAD", HASHES, ["repo-a", "skill"]),
						upToDate("owner/repo-b", "HEAD"),
					],
					tally: closed({ updated: 1, upToDate: 1 }),
				}),
			);
		});

		it("does not write manifest when nothing was updated", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry(),
				"owner/repo-b": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-b")
						return { status: "newer-tags", tags: ["v2.0"] };
					return { status: "up-to-date" };
				},
			);

			await runUpdate(undefined, {}, ui);

			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("cleans up temp dirs for git updates", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("group-first all-mode wiring (task 1-5)", () => {
		it("a 3-member collection clones once and runs one group check", async () => {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^1.2.3",
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			// One (cloneUrl, versionIntent) for all three → a single group.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockResolveGroupTarget).toHaveBeenCalledTimes(1);
		});

		it("a local entry reinstalls as a group-of-one without cloning", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(undefined, {}, ui);

			// Excluded from grouping: no group check, no clone; reinstalled in place.
			expect(mockResolveGroupTarget).not.toHaveBeenCalled();
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({ sourceDir: LOCAL_KEY }),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("the grouped path spins a task for the check, then one in the group's row while it updates", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// One progress line frames the group resolution and clears; the
			// group's own task spins where its row settles. No clone spinner.
			expect(progress()).toEqual([
				{ text: "checking for updates…" },
				{ subject: "owner/repo", meta: "HEAD", text: "updating to bbbbbbb…" },
			]);
			const [checking, updating] = ui.blocks[0]!.tasks;
			expect(checking!.clear).toHaveBeenCalledOnce();
			expect(updating!.settle).toHaveBeenCalledOnce();
		});

		it("single-key checks its key alone, spinning in its row's place while it checks and updates", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/my-skill/"],
				}),
			});
			// Single-key keeps using checkForUpdate; the group seam is not touched.
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);
			expect(progress()).toEqual([
				{ subject: "owner/repo", meta: "HEAD", text: "checking for updates…" },
				{ subject: "owner/repo", meta: "HEAD", text: "updating to bbbbbbb…" },
			]);
			const [checking, updating] = ui.blocks[0]!.tasks;
			expect(checking!.clear).toHaveBeenCalledOnce();
			expect(updating!.settle).toHaveBeenCalledOnce();
			expect(mockResolveGroupTarget).not.toHaveBeenCalled();
			expect(mockCheckForUpdate).toHaveBeenCalledWith(
				"owner/repo",
				expect.anything(),
			);
		});
	});

	describe("per-group manifest persistence (task 1-6)", () => {
		it("writes the manifest once per updatable group (two groups -> two writes)", async () => {
			// Two distinct repos → two groups-of-one, each update-available. Per-group
			// persistence writes once per group (N groups → N writes), replacing the
			// old single end-of-run write.
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/updated/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			// The final (cumulative) write reflects both groups' updates.
			const lastWrite = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(lastWrite["owner/repo-a"]!.commit).toBe(REMOTE_SHA);
			expect(lastWrite["owner/repo-b"]!.commit).toBe(REMOTE_SHA);
		});

		it("a copy-failed member removes its entry from that group write; siblings' updates persist", async () => {
			// Group 1 = a 2-member collection: member `a` copy-fails (entry removed),
			// sibling `b` updates (entry added) — folded into ONE group write. Group 2
			// = a standalone repo that updates → its own write. N groups → N writes.
			const memberA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/a/"],
			});
			const memberB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/b/"],
			});
			const standalone = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/c/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": memberA,
				"owner/repo/b": memberB,
				"zother/repo": standalone,
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// Member `a` (first reinstall) copy-fails; `b` and the standalone succeed.
			mockCopyBareSkill
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValue({ copiedFiles: [".claude/skills/updated/"] });

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// Copy-failed trips the non-zero exit; both groups still persisted.
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			expect(mockRemoveEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo/a",
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo/b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			// Group 1's write (first): member `a` removed, sibling `b` persisted.
			const groupOneWrite = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(groupOneWrite["owner/repo/a"]).toBeUndefined();
			expect(groupOneWrite["owner/repo/b"]).toBeDefined();
		});

		it("aborted / blocked / up-to-date members leave the manifest entry intact (no add/remove)", async () => {
			// Three standalone repos, each a group-of-one, hitting a non-mutating
			// category: aborted (derive gate), blocked (symlink escape), and
			// up-to-date (never actioned). None add or remove — so no group writes
			// the manifest at all.
			const aborted = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/abort/"],
			});
			const blocked = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/block/"],
			});
			const upToDate = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/current/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/abort": aborted,
				"owner/block": blocked,
				"owner/current": upToDate,
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				return key === "owner/current"
					? { kind: "head", resolvedSha: INSTALLED_SHA }
					: { kind: "head", resolvedSha: REMOTE_SHA };
			});
			// Distinct clones so the abort/block mocks can key on the group's tempDir.
			mockCloneSource
				.mockResolvedValueOnce({
					tempDir: "/tmp/clone-abort",
					commit: REMOTE_SHA,
				})
				.mockResolvedValueOnce({
					tempDir: "/tmp/clone-block",
					commit: REMOTE_SHA,
				});
			// abort clone: recorded SKILL.md gone and two skills now carry its name →
			// aborted (others present).
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-abort")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/abort", "y/abort");
			// block clone: escaping symlink → copy-safety block (others clean).
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (
						typeof sourceDir === "string" &&
						sourceDir.includes("/clone-block")
					) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			// aborted + blocked trip the non-zero exit; catch so assertions run.
			await runUpdate(undefined, {}, ui).catch(() => {});

			// No member mutated the manifest → no add/remove and no group write.
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("each group write reflects prior groups' updates (matching disk at group boundaries)", async () => {
			// Two update-available repos with DISTINCT resolved commits. Group A writes
			// first; group B's later write must still carry group A's update (prior
			// groups recorded), while group A's write shows group B still at its old
			// commit (not-yet-run groups untouched).
			const SHA_A = "c".repeat(40);
			const SHA_B = "d".repeat(40);
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				return {
					kind: "head",
					resolvedSha: key === "owner/repo-a" ? SHA_A : SHA_B,
				};
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/updated/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			// Group A's write: A updated, B still at its pre-run commit (not yet run).
			const firstWrite = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(firstWrite["owner/repo-a"]!.commit).toBe(SHA_A);
			expect(firstWrite["owner/repo-b"]!.commit).toBe(INSTALLED_SHA);
			// Group B's write: A's earlier update still present, B now updated.
			const secondWrite = mockWriteManifest.mock.calls[1]![1] as Manifest;
			expect(secondWrite["owner/repo-a"]!.commit).toBe(SHA_A);
			expect(secondWrite["owner/repo-b"]!.commit).toBe(SHA_B);
		});

		it("outcomes[] still trips hasFailedOutcome for copy-failed/aborted/blocked (non-zero exit)", async () => {
			// Three standalone repos, each a group-of-one producing one hard-failure
			// outcome. Per-group persistence doesn't change exit accounting: every
			// member outcome still accumulates into outcomes[], so any
			// copy-failed/aborted/blocked trips the non-zero exit.
			const cf = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/cf/"],
			});
			const ab = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/ab/"],
			});
			const bl = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/bl/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/cf": cf,
				"owner/ab": ab,
				"owner/bl": bl,
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-cf", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-ab", commit: REMOTE_SHA })
				.mockResolvedValueOnce({
					tempDir: "/tmp/clone-bl",
					commit: REMOTE_SHA,
				});
			// ab clone: SKILL.md gone and two skills now carry its name →
			// aborted (cf's present so it reaches copy).
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-ab")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/ab", "y/ab");
			// bl clone: escaping symlink → blocked.
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (
						typeof sourceDir === "string" &&
						sourceDir.includes("/clone-bl")
					) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			// cf clone: copy throws → copy-failed (removes its entry).
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// All three failure outcomes were collected and reported (accumulated into
			// outcomes[]), and the copy-failed one persisted its removal per group.
			// Each group-of-one settles into a ✗ row, its member's reason under it.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/cf", "HEAD", "cf"),
							group("owner/ab", "HEAD", "ab"),
							group("owner/bl", "HEAD", "bl"),
						],
					],
					rows: [
						stopped("owner/cf", "HEAD", HASHES, "failed", [
							"cf",
							"update failed after removing old files (disk full). It is currently uninstalled.",
						]),
						stopped("owner/ab", "HEAD", HASHES, "not updated", [
							"ab",
							"can't be updated: its SKILL.md is gone from ab and 2 skills are now named ab: x/ab, y/ab. The existing install is unchanged.",
						]),
						stopped("owner/bl", "HEAD", HASHES, "not updated", [
							"bl",
							'symlink "evil-link" points outside the clone (target: /etc/passwd). agntc won\'t follow that symlink, so the update is blocked. The existing install is unchanged.',
						]),
					],
					next: [
						{
							subject: "owner/cf",
							remedy: {
								lead: "To install it again:",
								steps: [{ command: "npx agntc add owner/cf" }],
							},
						},
						{
							subject: "owner/ab",
							remedy: {
								lead: "To follow one of them:",
								steps: [
									{ command: "npx agntc remove owner/ab" },
									{
										choice: [
											"npx agntc add owner/ab/x/ab",
											"npx agntc add owner/ab/y/ab",
										],
									},
								],
							},
						},
					],
					tally: closed({ failed: 1, notUpdated: 2 }),
				}),
			);
			expect(mockRemoveEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/cf",
			);
		});
	});

	describe("streamed actioned phase (task 2-4)", () => {
		const A_ROW = updated("owner/repo-a", "HEAD", HASHES, ["repo-a", "skill"]);
		const B_ROW = updated("owner/repo-b", "HEAD", HASHES, ["repo-b", "skill"]);
		const LOCAL_ROW: Row = {
			status: "done",
			subject: "/local/path",
			meta: "local",
			detail: { label: "refreshed", aside: "skill" },
		};

		function gitEntry(name: string): ManifestEntry {
			return makeEntry({
				commit: INSTALLED_SHA,
				files: [`.claude/skills/${name}/`],
			});
		}

		function localPluginEntry(): ManifestEntry {
			return {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/local/"],
				cloneUrl: null,
			};
		}

		it("streams updatable groups and local entries in manifest order", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": gitEntry("a"),
				"/local/path": localPluginEntry(),
				"owner/repo-b": gitEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// Each unit spins in its row's place, the local refreshing, the git
			// groups updating; their rows land in manifest (processing) order.
			expect(progress()).toEqual([
				{ text: "checking for updates…" },
				{ subject: "owner/repo-a", meta: "HEAD", text: "updating to bbbbbbb…" },
				{ subject: "/local/path", meta: "local", text: "refreshing…" },
				{ subject: "owner/repo-b", meta: "HEAD", text: "updating to bbbbbbb…" },
			]);
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "HEAD", "repo-b"),
							local("/local/path"),
						],
					],
					rows: [A_ROW, LOCAL_ROW, B_ROW],
					tally: closed({ updated: 2, refreshed: 1 }),
				}),
			);
		});

		it("draws a standalone updatable group as one row, its entry under it", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": gitEntry("a"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// The group-of-one spins in its row's place, then settles into it.
			expect(ui.blocks[0]!.tasks[1]!.settle.mock.calls).toEqual([
				[updated("owner/repo", "HEAD", HASHES, ["repo", "skill"])],
			]);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [updated("owner/repo", "HEAD", HASHES, ["repo", "skill"])],
					tally: closed({ updated: 1 }),
				}),
			);
		});

		it("names a single updated collection member under its repo, beside its up-to-date sibling", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: REMOTE_SHA,
					files: [".claude/skills/b/"],
				}),
			});
			// One group (same repo + HEAD intent); the shared target advances a but
			// leaves b already-current — a genuine-state split, so only a updates.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});

			await runUpdate(undefined, {}, ui);

			// The repo's one row carries the move; the member that moved and the
			// one already current hang under it, each with its own glyph.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "b")]],
					rows: [
						{
							status: "done",
							subject: "owner/repo",
							meta: "HEAD",
							detail: { move: HASHES },
							children: [
								{ name: "a", status: "done", detail: "skill" },
								{ name: "b", status: "unchanged", detail: "up to date" },
							],
						},
					],
					tally: closed({ updated: 1, upToDate: 1 }),
				}),
			);
		});

		it("draws a standalone whose single member copy-fails as one ✗ row, its recovery under Next", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": gitEntry("a"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			// The re-copy throws after the old files are nuked → copy-failed.
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			// copy-failed trips the non-zero exit; catch so assertions run.
			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						stopped("owner/repo", "HEAD", HASHES, "failed", [
							"repo",
							"update failed after removing old files (disk full). It is currently uninstalled.",
						]),
					],
					next: [
						{
							subject: "owner/repo",
							remedy: {
								lead: "To install it again:",
								steps: [{ command: "npx agntc add owner/repo" }],
							},
						},
					],
					tally: closed({ failed: 1 }),
				}),
			);
		});

		it("draws one row for a >=2-member group, each member's own outcome under it (mixed success/failure)", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
				"owner/repo/c": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/c/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			// c's recorded SKILL.md is gone and two skills now carry its name → aborted.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.endsWith("/c/SKILL.md")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/c", "y/c");
			// b's re-copy throws → copy-failed; a succeeds; c never reaches copy.
			mockCopyBareSkill.mockImplementation(
				async (opts: { sourceDir: string }) => {
					if (opts.sourceDir.endsWith("/b")) {
						throw new Error("disk full");
					}
					return { copiedFiles: [".claude/skills/updated/"] };
				},
			);

			// copy-failed trips the non-zero exit; catch so assertions run.
			await runUpdate(undefined, {}, ui).catch(() => {});

			// One row, its glyph the worst of its members', each member's own
			// glyph and reason under it, their remedies under Next.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "b", "c")]],
					rows: [
						{
							status: "failed",
							subject: "owner/repo",
							meta: "HEAD",
							detail: { move: HASHES },
							children: [
								{ name: "a", status: "done", detail: "skill" },
								{
									name: "b",
									status: "failed",
									detail:
										"update failed after removing old files (disk full). It is currently uninstalled.",
								},
								{
									name: "c",
									status: "failed",
									detail:
										"can't be updated: its SKILL.md is gone from c and 2 skills are now named c: x/c, y/c. The existing install is unchanged.",
								},
							],
						},
					],
					next: [
						{
							subject: "owner/repo/b",
							remedy: {
								lead: "To install it again:",
								steps: [{ command: "npx agntc add owner/repo/b" }],
							},
						},
						{
							subject: "owner/repo/c",
							remedy: {
								lead: "To follow one of them:",
								steps: [
									{ command: "npx agntc remove owner/repo/c" },
									{
										choice: [
											"npx agntc add owner/repo/x/c",
											"npx agntc add owner/repo/y/c",
										],
									},
								],
							},
						},
					],
					tally: closed({ updated: 1, failed: 1, notUpdated: 1 }),
				}),
			);
		});

		it("draws a local entry's refreshed row with no clone, at its manifest position", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"/local/path": localPluginEntry(),
				"owner/repo-a": gitEntry("a"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// The local lands first (manifest index 0); the git group follows. The
			// local never clones: only the git group does.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[group("owner/repo-a", "HEAD", "repo-a"), local("/local/path")],
					],
					rows: [LOCAL_ROW, A_ROW],
					tally: closed({ updated: 1, refreshed: 1 }),
				}),
			);
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
		});

		it("writes the group manifest before its row settles ✓ (persistence before stream)", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": gitEntry("a"),
				"owner/repo-b": gitEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// Two distinct repos → two groups-of-one, each settling into its row.
			const writeOrders = mockWriteManifest.mock.invocationCallOrder;
			const rowA = drawnAt("owner/repo-a");
			const rowB = drawnAt("owner/repo-b");
			// Group A's manifest write precedes its own row (persist before show)...
			expect(writeOrders[0]).toBeLessThan(rowA);
			// ...and A's row lands before group B's write even starts (per-group
			// streaming, not a single batched end-of-run render).
			expect(rowA).toBeLessThan(writeOrders[1]!);
			expect(rowA).toBeLessThan(rowB);
			expect(drawn().rows).toEqual([A_ROW, B_ROW]);
		});

		it("does not tick the spinner per member during reinstall", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
				"owner/repo/c": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/c/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(progress()).toEqual([
				{ text: "checking for updates…" },
				{ subject: "owner/repo", meta: "HEAD", text: "updating to bbbbbbb…" },
			]);
			expect(drawn().rows).toEqual([
				updated(
					"owner/repo",
					"HEAD",
					HASHES,
					["a", "skill"],
					["b", "skill"],
					["c", "skill"],
				),
			]);
		});

		it("spins no task for a group whose members are all non-updatable", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/updatable": gitEntry("u"),
				"owner/pinned": makeEntry({ ref: "v1.0", commit: INSTALLED_SHA }),
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				return key === "owner/updatable"
					? { kind: "head", resolvedSha: REMOTE_SHA }
					: { kind: "tag", tag: "v1.0", newerTags: ["v2.0"] };
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// The updatable group spins while it updates; the pinned (newer-tags)
			// group never clones and its row is drawn once the work has landed.
			expect(progress()).toEqual([
				{ text: "checking for updates…" },
				{
					subject: "owner/updatable",
					meta: "HEAD",
					text: "updating to bbbbbbb…",
				},
			]);
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/updatable", "HEAD", "updatable"),
							group("owner/pinned", "v1.0", "pinned"),
						],
					],
					rows: [
						updated("owner/updatable", "HEAD", HASHES, ["updatable", "skill"]),
						newerTags("owner/pinned", "v1.0"),
					],
					next: [
						{
							subject: "owner/pinned",
							remedy: {
								lead: "Pinned to v1.0, newer tags available (latest: v2.0). To upgrade:",
								steps: [{ command: "npx agntc add owner/pinned@v2.0" }],
							},
						},
					],
					tally: closed({ updated: 1, upToDate: 1 }),
				}),
			);
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
		});
	});

	describe("grouped tag-based version move (task 3-1)", () => {
		function constrainedMember(
			name: string,
			ref: string,
			commit: string,
		): ManifestEntry {
			return makeEntry({
				ref,
				commit,
				constraint: "^1.0",
				files: [`.claude/skills/${name}/`],
			});
		}

		it("grouped streaming threads old = members entry.ref and new = resolved target.tag into the row's move", async () => {
			// A 2-member constrained collection sharing one old tag (v1.2.3) and one
			// old commit → shared-old header renders the tag move v1.2.3 -> v1.3.0.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a", "v1.2.3", INSTALLED_SHA),
				"owner/repo/b": constrainedMember("b", "v1.2.3", INSTALLED_SHA),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// The resolved target.tag (v1.3.0) and the shared members' entry.ref
			// (v1.2.3) render as tags in the group's row — not commit hashes — and
			// it spins saying where it's going.
			expect(progress()[1]).toEqual({
				subject: "owner/repo",
				meta: "^1.0",
				text: "updating to v1.3.0…",
			});
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "a", "b")]],
					rows: [
						updated(
							"owner/repo",
							"^1.0",
							{ from: "v1.2.3", to: "v1.3.0" },
							["a", "skill"],
							["b", "skill"],
						),
					],
					tally: closed({ updated: 2 }),
				}),
			);
		});

		it("divergent-old constrained members each carry their own <oldTag> → <newTag> in tags (row target-only)", async () => {
			const SHA_A = "c".repeat(40);
			const SHA_B = "d".repeat(40);
			// Two members at DIFFERENT old tags/commits, both constrained ^1.0, both
			// advancing to v1.3.0 → divergent-old: header shows the resolved tag only,
			// each member line carries its own <oldTag> -> <newTag> move.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a", "v1.2.0", SHA_A),
				"owner/repo/b": constrainedMember("b", "v1.1.0", SHA_B),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			// Divergent olds → the row carries the resolved tag target only; each
			// member threads its OWN entry.ref as oldRef against the shared
			// target.tag → its own tag move under the row.
			expect(drawn().rows).toEqual([
				{
					status: "done",
					subject: "owner/repo",
					meta: "^1.0",
					detail: { label: "updated to v1.3.0" },
					children: [
						{ name: "a", detail: "v1.2.0 → v1.3.0 · skill" },
						{ name: "b", detail: "v1.1.0 → v1.3.0 · skill" },
					],
				},
			]);
		});

		it("divergent-old members on a branch each carry their own short-hash move", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					commit: "c".repeat(40),
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					commit: "d".repeat(40),
					files: [".claude/skills/b/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn().rows).toEqual([
				{
					status: "done",
					subject: "owner/repo",
					meta: "HEAD",
					detail: { label: "updated to bbbbbbb" },
					children: [
						{ name: "a", detail: "ccccccc → bbbbbbb · skill" },
						{ name: "b", detail: "ddddddd → bbbbbbb · skill" },
					],
				},
			]);
		});
	});

	describe("trailing non-actioned collapse (task 2-5)", () => {
		function member(name: string, overrides: Partial<ManifestEntry> = {}) {
			return makeEntry({
				commit: INSTALLED_SHA,
				files: [`.claude/skills/${name}/`],
				...overrides,
			});
		}

		function installPipelineMocks(): void {
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});
		}

		it("collapses N up-to-date members of a group to one up to date row", async () => {
			const manifest: Manifest = {};
			for (let i = 1; i <= 7; i++) {
				manifest[`owner/repo/${i}`] = member(String(i));
			}
			// A separate updating standalone keeps the run out of the
			// all-up-to-date short-circuit so the collapse actually renders.
			manifest["owner/other"] = member("other");
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				// owner/repo group: target sha == installed sha → every member up-to-date.
				// owner/other group: target sha advanced → the standalone updates.
				return key.startsWith("owner/repo")
					? { kind: "head", resolvedSha: INSTALLED_SHA }
					: { kind: "head", resolvedSha: REMOTE_SHA };
			});
			installPipelineMocks();

			await runUpdate(undefined, {}, ui);

			// ONE row for the 7-member group, counted 7 in the tally, never 7
			// near-identical per-member lines.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo", "HEAD", "1", "2", "3", "4", "5", "6", "7"),
							group("owner/other", "HEAD", "other"),
						],
					],
					rows: [
						updated("owner/other", "HEAD", HASHES, ["other", "skill"]),
						upToDate("owner/repo", "HEAD"),
					],
					tally: closed({ updated: 1, upToDate: 7 }),
				}),
			);
		});

		it("collapses newer-tags to one line per group: its loose skills on one --skill command, each pack on its own", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/zeta": member("zeta", {
					ref: "v1.0",
					sourceSubpath: "skills/zeta",
				}),
				"owner/repo/web": member("web", { ref: "v1.0", type: "pack" }),
				"owner/repo/alpha": member("alpha", { ref: "v1.0" }),
				"owner/repo/tools": member("tools", { ref: "v1.0", type: "pack" }),
			});
			// One exact-pin group; the shared tag target reports newer tags for all.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "tag",
				tag: "v1.0",
				newerTags: ["v2.0", "v3.0"],
			});

			await runUpdate(undefined, {}, ui);

			// One row and one Next item for the group, not one per member.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[group("owner/repo", "v1.0", "zeta", "web", "alpha", "tools")],
					],
					rows: [newerTags("owner/repo", "v1.0")],
					next: [
						{
							subject: "owner/repo",
							remedy: {
								lead: "Pinned to v1.0, newer tags available (latest: v3.0). To upgrade:",
								steps: [
									{
										command: "npx agntc add owner/repo@v3.0 --skill alpha zeta",
									},
									{ command: "npx agntc add owner/repo/web@v3.0 --pack" },
									{ command: "npx agntc add owner/repo/tools@v3.0 --pack" },
								],
							},
						},
					],
					tally: closed({ upToDate: 4 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("an exact-pin member's newer-tags command re-adds that member at the newest tag, never the bare repo", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { ref: "v1.0" }),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "tag",
				tag: "v1.0",
				newerTags: ["v2.0", "v3.0"],
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn().next).toEqual([
				{
					subject: "owner/repo",
					remedy: {
						lead: "Pinned to v1.0, newer tags available (latest: v3.0). To upgrade:",
						steps: [{ command: "npx agntc add owner/repo/a@v3.0" }],
					},
				},
			]);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("collapses a check-failed group to one line with the shared probe reason (exit 0)", async () => {
			const REASON = "ls-remote failed: could not read from remote";
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "check-failed",
				reason: REASON,
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// All-mode check-failed exits 0 (excluded from hasFailedOutcome).
			expect(err).toBeUndefined();
			// ONE row carrying the shared probe reason — no per-member enumeration.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "b", "c")]],
					rows: [notChecked("owner/repo", "HEAD", REASON)],
					tally: closed({ notChecked: 3 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("collapses git's error in a check-failed group to its one-line cause", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"leeovery/agentic-workflows": member("agentic-workflows"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "check-failed",
				reason: SSH_REFUSAL,
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn().rows).toEqual([
				notChecked(
					"leeovery/agentic-workflows",
					"HEAD",
					"git@github.com: Permission denied (publickey).",
				),
			]);
		});

		it("collapses a constrained-no-match group to one line with the shared constraint", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { ref: "v1.2.3", constraint: "^2.0" }),
				"owner/repo/b": member("b", { ref: "v1.2.3", constraint: "^2.0" }),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained-no-match",
			});

			await runUpdate(undefined, {}, ui);

			// ONE row carrying the shared constraint.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^2.0", "a", "b")]],
					rows: [noMatch("owner/repo", "^2.0")],
					tally: closed({ notChecked: 2 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("renders separate @intent-disambiguated trailing lines for two distinct-intent groups of one repo", async () => {
			// Same repo, two intents → two groups: a caret group (constrained-no-match)
			// and an exact-pin group (up-to-date). Each keeps its own @intent line.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { ref: "v1.2.3", constraint: "^1.2.3" }),
				"owner/repo/b": member("b", { ref: "v2.0.0" }),
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				return group.members[0]!.entry.constraint !== undefined
					? { kind: "constrained-no-match" }
					: { kind: "tag", tag: "v2.0.0", newerTags: [] };
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo@^1.2.3", "^1.2.3", "a"),
							group("owner/repo@v2.0.0", "v2.0.0", "b"),
						],
					],
					rows: [
						noMatch("owner/repo@^1.2.3", "^1.2.3"),
						upToDate("owner/repo@v2.0.0", "v2.0.0"),
					],
					tally: closed({ notChecked: 1, upToDate: 1 }),
				}),
			);
		});

		it("draws a split group's up-to-date members under its row, each with its own status", async () => {
			// One HEAD group: member a is behind (updates), members b and c are
			// already at the resolved target (up to date).
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a", { commit: INSTALLED_SHA }),
				"owner/repo/b": member("b", { commit: REMOTE_SHA }),
				"owner/repo/c": member("c", { commit: REMOTE_SHA }),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			installPipelineMocks();

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "b", "c")]],
					rows: [
						{
							status: "done",
							subject: "owner/repo",
							meta: "HEAD",
							detail: { move: HASHES },
							children: [
								{ name: "a", status: "done", detail: "skill" },
								{ name: "b", status: "unchanged", detail: "up to date" },
								{ name: "c", status: "unchanged", detail: "up to date" },
							],
						},
					],
					tally: closed({ updated: 1, upToDate: 2 }),
				}),
			);
		});
	});

	describe("empty manifest", () => {
		it("displays message and exits 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({});

			await runUpdate("owner/repo", {}, ui);

			expect(drawn()).toEqual(NOTHING_INSTALLED);
			expect(mockCheckForUpdate).not.toHaveBeenCalled();
		});
	});

	describe("non-existent key", () => {
		it("exits 1 with error message", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"other/plugin": makeEntry(),
			});

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(ui.fail).toHaveBeenCalledExactlyOnceWith(
				"owner/repo is not installed.",
			);
		});
	});

	describe("up-to-date", () => {
		it("displays up-to-date message and exits 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate("owner/repo", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [upToDate("owner/repo", "HEAD", { member: "repo" })],
					tally: closed({ upToDate: 1 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("single-key update of a v4-branch entry that is up-to-date exits 0", async () => {
			// Cross-surface recovery: a branch ref that looks like a tag ("v4") now
			// resolves to a real status. The single-key path must take the up-to-date
			// branch (its row + exit 0), NOT the check-failed exit-1 branch it hit
			// before Task 1.2's classification fix.
			mockReadManifestOrExit.mockResolvedValue({
				"nuxt/ui": makeEntry({ ref: "v4", commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			const err = await runUpdate("nuxt/ui", {}, ui).catch((e) => e);

			// Resolves (no ExitSignal) — up-to-date, not the check-failed exit-1 path.
			expect(err).toBeUndefined();
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("nuxt/ui", "v4", "ui")]],
					rows: [upToDate("nuxt/ui", "v4", { member: "ui" })],
					tally: closed({ upToDate: 1 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("check-failed", () => {
		it("exits 1 with error when update check fails", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						notChecked("owner/repo", "HEAD", "network timeout", {
							member: "repo",
						}),
					],
					tally: closed({ notChecked: 1 }),
				}),
			);
		});

		it("prints git's error as its one-line cause", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry(),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: SSH_REFUSAL,
			});

			await runUpdate("owner/repo", {}, ui).catch(() => undefined);

			expect(drawn().rows).toEqual([
				notChecked(
					"owner/repo",
					"HEAD",
					"git@github.com: Permission denied (publickey).",
					{ member: "repo" },
				),
			]);
		});
	});

	describe("update-available — full pipeline", () => {
		it("clones before nuking existing files", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			const callOrder: string[] = [];
			mockCloneSource.mockImplementation(async () => {
				callOrder.push("clone");
				return { tempDir: "/tmp/agntc-clone", commit: REMOTE_SHA };
			});
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});

			await runUpdate("owner/repo", {}, ui);

			expect(callOrder).toEqual(["clone", "nuke"]);
		});

		it("copies from temp dir after nuke", async () => {
			const entry = makeEntry({
				type: "pack",
				files: [".claude/skills/my-skill/"],
			});
			mockDiscover.mockResolvedValue(onlyPack(LARAVEL_PACK));
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/new-skill/"],
				assetCounts: { skills: 1 },
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockCopyPack).toHaveBeenCalledWith(
				LARAVEL_PACK,
				{ root: "/tmp/agntc-clone", local: false },
				"/fake/project",
			);
		});

		it("updates manifest with new commit and files", async () => {
			const entry = makeEntry({
				ref: null,
				commit: INSTALLED_SHA,
				files: [".claude/skills/old-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ "owner/repo": entry },
				"owner/repo",
				expect.objectContaining({
					ref: null,
					commit: REMOTE_SHA,
					files: [".claude/skills/my-skill/"],
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("shows summary with old and new commit", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [updated("owner/repo", "HEAD", HASHES, ["repo", "skill"])],
					tally: closed({ updated: 1 }),
				}),
			);
		});
	});

	describe("no confirmation needed", () => {
		it("does not prompt for confirmation before updating", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			// No confirm mock was set up — would throw if called
			// Also explicitly verify no confirm import usage
			expect(mockWriteManifest).toHaveBeenCalled();
		});
	});

	describe("legacy multi-agent entry migrates to .claude", () => {
		const legacyFiles = [
			".claude/skills/my-skill/",
			".agents/skills/my-skill/",
			".cursor/skills/my-skill/",
		];

		function setupLegacyUpdate(files: string[]): void {
			const legacyEntry = {
				...makeEntry({ type: "skill", commit: INSTALLED_SHA, files }),
				agents: ["claude", "codex", "cursor"],
			};
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": legacyEntry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});
		}

		it("nukes every recorded file and reinstalls into .claude only", async () => {
			setupLegacyUpdate(legacyFiles);

			await runUpdate("owner/repo", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith(
				"/fake/project",
				legacyFiles,
			);
			expect(mockCopyBareSkill).toHaveBeenCalledWith({
				sourceDir: "/tmp/agntc-clone",
				source: { root: "/tmp/agntc-clone", local: false },
				projectDir: "/fake/project",
				skillName: "repo",
			});
		});

		it("persists the reinstalled entry with .claude files and no agents field", async () => {
			setupLegacyUpdate(legacyFiles);

			await runUpdate("owner/repo", {}, ui);

			const written = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(written["owner/repo"]!.files).toEqual([".claude/skills/repo/"]);
			expect(written["owner/repo"]).not.toHaveProperty("agents");
		});

		it("migrates a Codex-only entry", async () => {
			setupLegacyUpdate([".agents/skills/my-skill/"]);

			await runUpdate("owner/repo", {}, ui);

			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".agents/skills/my-skill/",
			]);
			const written = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(written["owner/repo"]!.files).toEqual([".claude/skills/repo/"]);
		});

		it("names no agent in the update summary", async () => {
			setupLegacyUpdate(legacyFiles);

			await runUpdate("owner/repo", {}, ui);

			expect(drawn().rows).toEqual([
				updated("owner/repo", "HEAD", HASHES, ["repo", "skill"]),
			]);
		});
	});

	describe("irreconcilable-change abort (derive-before-delete)", () => {
		function arrangeRecordedSkillAbort(key = "owner/repo"): ManifestEntry {
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ [key]: entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// The recorded SKILL.md is gone and two skills now carry its name -> aborted.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("a/repo", "b/repo");
			return entry;
		}

		it("single-key update of aborting entry exits non-zero", async () => {
			arrangeRecordedSkillAbort();

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("abort message names recorded type, current structure change, and remove+add remedy", async () => {
			arrangeRecordedSkillAbort();

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						stopped("owner/repo", "HEAD", HASHES, "not updated", [
							"repo",
							nowNamed("repo", "a/repo", "b/repo"),
						]),
					],
					next: [
						followOne(
							"owner/repo",
							"npx agntc add owner/repo/a/repo",
							"npx agntc add owner/repo/b/repo",
						),
					],
					tally: closed({ notUpdated: 1 }),
				}),
			);
		});

		it("does not nuke or mutate the manifest on abort (install intact)", async () => {
			arrangeRecordedSkillAbort();

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		it("is distinct from copy-failed: install intact, no entry removal, no retry hint", async () => {
			arrangeRecordedSkillAbort();

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			// Copy-failed removes the entry + writes the manifest; abort must not.
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			// Copy-failed tells the user the unit is currently uninstalled and
			// offers its re-add; an abort leaves the install intact.
			const { rows, next } = drawn();
			expect(JSON.stringify(rows)).not.toContain("currently uninstalled");
			expect(next.map(({ remedy }) => remedy.lead)).toEqual([
				"To follow one of them:",
			]);
		});

		it("all-updates: aborted outcome does not mutate the manifest", async () => {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-a", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			// repo-a's SKILL.md is gone and two skills now carry its name -> aborted;
			// repo-b's is present -> succeeds.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/repo-a", "y/repo-a");
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			// All-updates partial abort exits non-zero (after writing successful
			// siblings); catch so the manifest assertions below still run.
			await runUpdate(undefined, {}, ui).catch(() => {});

			// Manifest write must NOT include any add/remove for the aborted entry.
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			const writeCalls = mockWriteManifest.mock.calls;
			expect(writeCalls.length).toBeGreaterThan(0);
			for (const call of writeCalls) {
				const written = call[1] as Manifest;
				// aborted entry stays exactly as it was, never removed.
				expect(written["owner/repo-a"]).toBeDefined();
			}
		});

		it("all-updates: aborted outcome reports loud per-unit message naming remedy", async () => {
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("a/repo", "b/repo");

			// All-updates abort exits non-zero after drawing its row; catch so
			// the assertions below still run.
			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						stopped("owner/repo", "HEAD", HASHES, "not updated", [
							"repo",
							nowNamed("repo", "a/repo", "b/repo"),
						]),
					],
					next: [
						followOne(
							"owner/repo",
							"npx agntc add owner/repo/a/repo",
							"npx agntc add owner/repo/b/repo",
						),
					],
					tally: closed({ notUpdated: 1 }),
				}),
			);
		});
	});

	describe("symlink-escape copy-safety block (distinct from derive-before-delete abort)", () => {
		function arrangeSymlinkEscape(key = "owner/repo"): ManifestEntry {
			const entry = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ [key]: entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// The recorded unit is still structurally present (derive gate would
			// pass), but the re-clone contains an escaping symlink -> copy-safety block.
			mockAccess.mockResolvedValue(undefined);
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);
			return entry;
		}

		it("single-key update with an escaping symlink exits non-zero", async () => {
			arrangeSymlinkEscape();

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("reports a copy-safety message describing the symlink escape, NOT a type change or remove+add", async () => {
			arrangeSymlinkEscape();

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			// No derive-before-delete framing, and no remedy: nothing in Next.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						stopped("owner/repo", "HEAD", HASHES, "not updated", [
							"repo",
							ESCAPE,
						]),
					],
					tally: closed({ notUpdated: 1 }),
				}),
			);
		});

		it("does not nuke or mutate the manifest on a symlink-escape block (install intact)", async () => {
			arrangeSymlinkEscape();

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		it("all-updates: a symlink-escape member produces a non-success outcome (non-zero exit), manifest untouched, sibling still updates", async () => {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			// Distinct temp dirs per sequential clone so the scan can be made to
			// fail for repo-a (first) and pass for repo-b (second).
			mockCloneSource
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-a",
					commit: REMOTE_SHA,
				})
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			// repo-a's re-clone has an escaping symlink -> blocked; repo-b is clean.
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (
						typeof sourceDir === "string" &&
						sourceDir.includes("/agntc-clone-a")
					) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// Non-zero exit from the blocked member.
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);

			// Blocked member's manifest entry never removed; sibling still written.
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			const writeCalls = mockWriteManifest.mock.calls;
			expect(writeCalls.length).toBeGreaterThan(0);
			for (const call of writeCalls) {
				const written = call[1] as Manifest;
				expect(written["owner/repo-a"]).toBeDefined();
			}

			// The copy-safety reason under the blocked member's row; the sibling
			// updated beside it.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "HEAD", "repo-b"),
						],
					],
					rows: [
						stopped("owner/repo-a", "HEAD", HASHES, "not updated", [
							"repo-a",
							ESCAPE,
						]),
						updated("owner/repo-b", "HEAD", HASHES, ["repo-b", "skill"]),
					],
					tally: closed({ notUpdated: 1, updated: 1 }),
				}),
			);
		});
	});

	describe("all-updates partial-success exit (per-entry abort granularity)", () => {
		// repo-a (recorded skill) aborts because its SKILL.md is gone in the
		// re-clone; repo-b (sibling collection member / skill) and owner/x both
		// update cleanly. Models per-entry isolation: one unit aborting must not
		// stop the others, and the successful units must still be written.
		function arrangePartialAbort(): {
			entryA: ManifestEntry;
			entryB: ManifestEntry;
		} {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			// Distinct temp dirs per sequential clone so the derive gate can be made
			// to fail for repo-a (first) and pass for repo-b (second).
			mockCloneSource
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-a",
					commit: REMOTE_SHA,
				})
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			// repo-a's recorded SKILL.md is gone and two skills now carry its name ->
			// aborted; repo-b stays.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/agntc-clone-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/repo-a", "y/repo-a");
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});
			return { entryA, entryB };
		}

		it("one member aborting does not stop siblings — sibling is updated and written", async () => {
			arrangePartialAbort();

			await runUpdate(undefined, {}, ui).catch(() => {});

			// Sibling repo-b was processed (copied) and added to the manifest.
			expect(mockCopyBareSkill).toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo-b"]).toBeDefined();
			expect(writtenManifest["owner/repo-b"]!.commit).toBe(REMOTE_SHA);
		});

		it("partial abort exits non-zero", async () => {
			arrangePartialAbort();

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("writes successful updates BEFORE throwing the non-zero exit", async () => {
			arrangePartialAbort();

			const callOrder: string[] = [];
			mockWriteManifest.mockImplementation(async () => {
				callOrder.push("write");
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => {
				callOrder.push("throw");
				return e;
			});

			expect(err).toBeInstanceOf(ExitSignal);
			expect(callOrder).toEqual(["write", "throw"]);
		});

		it("does not roll back the successful sibling when a member aborts", async () => {
			arrangePartialAbort();

			await runUpdate(undefined, {}, ui).catch(() => {});

			// No coherence rollback: repo-b's successful entry is never removed.
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
			);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo-b"]).toBeDefined();
		});

		it("leaves the aborted entry's manifest entry unchanged (install intact)", async () => {
			const { entryA } = arrangePartialAbort();

			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest["owner/repo-a"]).toEqual(entryA);
		});

		it("draws the aborted and the succeeded unit each in its own row, the abort's remedy in Next", async () => {
			arrangePartialAbort();

			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "HEAD", "repo-b"),
						],
					],
					rows: [
						stopped("owner/repo-a", "HEAD", HASHES, "not updated", [
							"repo-a",
							nowNamed("repo-a", "x/repo-a", "y/repo-a"),
						]),
						updated("owner/repo-b", "HEAD", HASHES, ["repo-b", "skill"]),
					],
					next: [
						followOne(
							"owner/repo-a",
							"npx agntc add owner/repo-a/x/repo-a",
							"npx agntc add owner/repo-a/y/repo-a",
						),
					],
					tally: closed({ notUpdated: 1, updated: 1 }),
				}),
			);
		});

		it("reports each aborted entry with its own reason (two rows, two remedies)", async () => {
			const entryA = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// Both recorded skills are gone and each name now matches two skills ->
			// both abort.
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("x/repo-a", "y/repo-a", "x/repo-b", "y/repo-b");

			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "HEAD", "repo-b"),
						],
					],
					rows: [
						stopped("owner/repo-a", "HEAD", HASHES, "not updated", [
							"repo-a",
							nowNamed("repo-a", "x/repo-a", "y/repo-a"),
						]),
						stopped("owner/repo-b", "HEAD", HASHES, "not updated", [
							"repo-b",
							nowNamed("repo-b", "x/repo-b", "y/repo-b"),
						]),
					],
					next: [
						followOne(
							"owner/repo-a",
							"npx agntc add owner/repo-a/x/repo-a",
							"npx agntc add owner/repo-a/y/repo-a",
						),
						followOne(
							"owner/repo-b",
							"npx agntc add owner/repo-b/x/repo-b",
							"npx agntc add owner/repo-b/y/repo-b",
						),
					],
					tally: closed({ notUpdated: 2 }),
				}),
			);
		});

		it("exits non-zero once even when multiple units abort", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
					files: [".claude/skills/skill-a/"],
				}),
				"owner/repo-b": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
					files: [".claude/skills/skill-b/"],
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("x/repo-a", "y/repo-a", "x/repo-b", "y/repo-b");

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("abort is not swallowed by the all-up-to-date early return", async () => {
			// owner/repo-current is up to date; owner/repo-a aborts. The abort must
			// still be reported and force a non-zero exit (not the up-to-date path).
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-current": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/current/"],
				}),
				"owner/repo-a": makeEntry({
					type: "skill",
					commit: INSTALLED_SHA,
					files: [".claude/skills/skill-a/"],
				}),
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-current") return { status: "up-to-date" };
					return { status: "update-available", remoteCommit: REMOTE_SHA };
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds("x/repo-a", "y/repo-a");

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-current", "HEAD", "repo-current"),
							group("owner/repo-a", "HEAD", "repo-a"),
						],
					],
					rows: [
						stopped("owner/repo-a", "HEAD", HASHES, "not updated", [
							"repo-a",
							nowNamed("repo-a", "x/repo-a", "y/repo-a"),
						]),
						upToDate("owner/repo-current", "HEAD"),
					],
					next: [
						followOne(
							"owner/repo-a",
							"npx agntc add owner/repo-a/x/repo-a",
							"npx agntc add owner/repo-a/y/repo-a",
						),
					],
					tally: closed({ notUpdated: 1, upToDate: 1 }),
				}),
			);
		});

		it("pack single-entry abort is atomic — the entry stays intact and exits non-zero", async () => {
			const entry = makeEntry({
				type: "pack",
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-plugin/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// The pack's folder now holds declared packs -> derive gate aborts.
			mockDiscover.mockRejectedValue(
				new PackConflictError("contains packs", "contains-packs"),
			);

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Whole-entry atomic: no nuke, no manifest mutation for the one entry.
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
			);
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});
	});

	describe("temp dir cleanup", () => {
		it("cleans up temp dir on successful update", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});

		it("cleans up temp dir when copy fails", async () => {
			const entry = makeEntry();
			const manifest = { "owner/repo": entry };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect(mockCleanupTempDir).toHaveBeenCalledWith("/tmp/agntc-clone");
		});
	});

	describe("clone failure", () => {
		it("does not modify existing files when clone fails", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("shows error message on clone failure", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockRejectedValue(
				new Error("git clone failed after 3 attempts: network error"),
			);

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			// A failure, drawn ✗ in its row: never a cancel, which reads ○.
			expect(ui.cancel).not.toHaveBeenCalled();
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [cloneFailed("owner/repo", "HEAD", "network error", "repo")],
					tally: closed({ failed: 1 }),
				}),
			);
		});
	});

	describe("clone-fatal fan-out & grouped rendering — all-mode group (task 1-7 / 2-6)", () => {
		// A 3-member collection sharing one (cloneUrl, versionIntent) → one group,
		// one shared clone. When that clone throws, every member of the group's
		// UPDATING subset becomes a `failed` outcome attributed to its own key (the
		// MODEL — Phase 1 task 1-7, preserved). The DISPLAY (task 2-6) collapses those
		// N failed outcomes to ONE enumerated grouped error line naming the affected
		// members — never N identical anonymous lines — while the model + exit stay
		// exactly as Phase 1 built them.
		function threeMemberCollection(): void {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
		}

		it("renders a group clone failure as one row naming the affected members, not N lines", async () => {
			threeMemberCollection();
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await runUpdate(undefined, {}, ui).catch(() => {});

			// ONE row naming the affected members beneath it, its task settling
			// into it; the tally still counts the N failed outcomes.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "b", "c")]],
					rows: [
						cloneFailed(
							"owner/repo",
							"HEAD",
							"git clone failed",
							"a",
							"b",
							"c",
						),
					],
					tally: closed({ failed: 3 }),
				}),
			);
			expect(ui.blocks[0]!.tasks[1]!.settle).toHaveBeenCalledOnce();
		});

		it("mutates no manifest state for the clone-failed group", async () => {
			threeMemberCollection();
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await runUpdate(undefined, {}, ui).catch(() => {});

			// clone-failed removes no entries (only copy-failed does) → the persistence
			// fold sees only `failed` outcomes → no add/remove → no write for the group.
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("keeps N failed outcomes in the model so the run exits non-zero (ExitSignal 1)", async () => {
			threeMemberCollection();
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// The DISPLAY collapsed to one line, but the model still holds N `failed`
			// outcomes → hasFailedOutcome trips → runGroupedUpdates throws ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});

		it("a sibling group still streams and persists when another group clone fails", async () => {
			// Two 2-member collections → two groups. Group A (manifest-first) clone
			// throws (group-fatal → enumerated error line); group B clones and streams
			// its member lines. Isolation: A removes/writes nothing; B streams both
			// member ✓ lines and persists; the run exits non-zero because A failed.
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a/x": member("x"),
				"owner/repo-a/y": member("y"),
				"owner/repo-b/m": member("m"),
				"owner/repo-b/n": member("n"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			// Group A (manifest-first) clone fails; group B clone succeeds.
			mockCloneSource
				.mockRejectedValueOnce(new Error("git clone failed"))
				.mockResolvedValueOnce({
					tempDir: "/tmp/agntc-clone-b",
					commit: REMOTE_SHA,
				});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Group A settles as one clone-failed row; group B's row carries both
			// members updated.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "x", "y"),
							group("owner/repo-b", "HEAD", "m", "n"),
						],
					],
					rows: [
						cloneFailed("owner/repo-a", "HEAD", "git clone failed", "x", "y"),
						updated(
							"owner/repo-b",
							"HEAD",
							HASHES,
							["m", "skill"],
							["n", "skill"],
						),
					],
					tally: closed({ failed: 2, updated: 2 }),
				}),
			);
			// Only group B persisted; group A (clone-failed) wrote nothing.
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b/m",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b/n",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("owner/repo-a"),
				expect.anything(),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		it("a group-of-one clone failure settles into the same row as a larger group's", async () => {
			// A standalone repo → a group-of-one. Its clone throws: one row, its
			// one member beneath it, as any group's.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/solo/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockRejectedValue(new Error("git clone failed"));

			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [cloneFailed("owner/repo", "HEAD", "git clone failed", "repo")],
					tally: closed({ failed: 1 }),
				}),
			);
		});
	});

	describe("check/resolve-fatal fan-out — all-mode group (task 1-8)", () => {
		// A group's single resolution probe (resolveGroupTarget) can itself fail —
		// dead remote / ls-remote error — BEFORE any clone. By analogy to a clone
		// failure, every member of the group becomes a check-failed outcome
		// attributed to its own key and carrying the shared probe reason; no clone or
		// reinstall runs, so no manifest mutation occurs. Per the ratified exit
		// posture, all-mode check-failed WARNS and exits 0 (it is excluded from
		// hasFailedOutcome); the single-key path still exits 1 (see the "check-failed"
		// block above — untouched here).
		const PROBE_REASON = "ls-remote failed: could not read from remote";

		function threeMemberCollection(): void {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": member("a"),
				"owner/repo/b": member("b"),
				"owner/repo/c": member("c"),
			});
			// The group's single resolution probe fails BEFORE any clone.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "check-failed",
				reason: PROBE_REASON,
			});
		}

		it("collapses a group probe failure to one check-failed line carrying the shared reason", async () => {
			threeMemberCollection();

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// All-mode check-failed exits 0 (excluded from hasFailedOutcome).
			expect(err).toBeUndefined();
			// The MODEL stays N check-failed outcomes (the tally counts 3); the
			// DISPLAY is ONE group row — a group-level probe failure is one shared
			// reason, never one line per member.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "b", "c")]],
					rows: [notChecked("owner/repo", "HEAD", PROBE_REASON)],
					tally: closed({ notChecked: 3 }),
				}),
			);
		});

		it("a check-failed group runs no clone and mutates no manifest state", async () => {
			threeMemberCollection();

			await runUpdate(undefined, {}, ui).catch(() => {});

			// The probe failed BEFORE any clone; no reinstall runs, so nothing persists.
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("all-mode with a check-failed group (others succeeding) exits 0", async () => {
			// Two standalone repos → two groups-of-one. Group A's probe fails
			// (check-failed → warn, no clone); group B resolves update-available and
			// updates. Per the ratified posture, the check-failed group does NOT feed
			// hasFailedOutcome, so the run exits 0 while B still updates and persists.
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				if (group.members[0]!.key === "owner/repo-a") {
					return { kind: "check-failed", reason: PROBE_REASON };
				}
				return { kind: "head", resolvedSha: REMOTE_SHA };
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone-b",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-b/"],
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// check-failed excluded from hasFailedOutcome → no ExitSignal (exit 0).
			expect(err).toBeUndefined();
			// B still clones, updates, and persists; A's failed probe wrote nothing.
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
				expect.anything(),
			);
		});

		it("draws the group's row under its label — no per-member row or child", async () => {
			threeMemberCollection();

			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(drawn().rows).toEqual([
				notChecked("owner/repo", "HEAD", PROBE_REASON),
			]);
			expect(ui.warn).not.toHaveBeenCalled();
		});
	});

	describe("ratified exit-code posture — safe-vs-major bump gating (task 4-3 regression lock)", () => {
		// The ratified spec ("Exit-code posture — single-key vs all-mode") pins an
		// INTENTIONAL divergence for the two non-hard-failure categories, check-failed
		// and constrained-no-match:
		//
		//   | category               | single-key      | all-mode           |
		//   | ---------------------- | --------------- | ------------------ |
		//   | check-failed           | ExitSignal(1)   | warn, exit 0       |
		//   | constrained-no-match   | ExitSignal(1)   | warn, exit 0       |
		//   | aborted                | ExitSignal(1)   | ExitSignal(1)      |
		//   | blocked                | ExitSignal(1)   | ExitSignal(1)      |
		//   | failed (clone fan-out) | ExitSignal(1)   | ExitSignal(1)      |
		//   | copy-failed            | ExitSignal(1)   | ExitSignal(1)      |
		//   | up-to-date/newer-tags  | exit 0          | exit 0             |
		//
		// Single-key exits 1 on check-failed / constrained-no-match because the
		// requested action did not happen; all-mode WARNS and exits 0 (both are
		// excluded from hasFailedOutcome — a batch is not sunk by one dead remote or
		// one stuck constraint). hasFailedOutcome membership is EXACTLY
		// aborted | blocked | failed | copy-failed. This block is a verification /
		// regression lock: the posture is already implemented (Phase 1 task 1-8 for the
		// all-mode fan-out, pre-existing runSingleUpdate code for single-key). It
		// authors one NAMED lock per matrix cell so the posture cannot drift; each cell
		// asserts the exit explicitly. Finer-grained behavioural coverage lives in the
		// "check-failed", "constrained-no-match — single plugin", "check/resolve-fatal
		// fan-out — all-mode group (task 1-8)", "constrained statuses — all-plugins
		// mode", "all-updates partial-success exit", "symlink-escape copy-safety block",
		// "clone-fatal fan-out & grouped rendering", and "copy-failed — all-updates
		// mode" blocks; these tests reference and consolidate them into the matrix.
		// A regression here is a genuine posture break, NOT a test to relax.

		function skillEntry(name: string): ManifestEntry {
			return makeEntry({
				type: "skill",
				commit: INSTALLED_SHA,
				files: [`.claude/skills/${name}/`],
			});
		}

		// --- single-key: strict, exit 1 on both non-hard-failure categories ---

		it("single-key check-failed exits 1", async () => {
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": makeEntry() });
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			// The requested action did not happen -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						notChecked("owner/repo", "HEAD", "network timeout", {
							member: "repo",
						}),
					],
					tally: closed({ notChecked: 1 }),
				}),
			);
		});

		it("single-key constrained-no-match exits 1", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
				}),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "constrained-no-match" });

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^2.0", "repo")]],
					rows: [noMatch("owner/repo", "^2.0", { member: "repo" })],
					tally: closed({ notChecked: 1 }),
				}),
			);
		});

		// --- all-mode: the two non-hard-failure categories warn and exit 0 ---

		it("all-mode check-failed warns and exits 0 (excluded from hasFailedOutcome), no manifest mutation", async () => {
			const REASON = "ls-remote failed: could not read from remote";
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo-b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
			});
			// Group A's resolution probe fails (Phase 1 seam); group B resolves
			// update-available and succeeds.
			mockResolveGroupTarget.mockImplementation(async (group) =>
				group.members[0]!.key === "owner/repo-a"
					? { kind: "check-failed", reason: REASON }
					: { kind: "head", resolvedSha: REMOTE_SHA },
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone-b",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/b/"],
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// Excluded from hasFailedOutcome -> the batch resolves (exit 0).
			expect(err).toBeUndefined();
			// Drawn as needing attention (!), never failed (✗).
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "HEAD", "repo-b"),
						],
					],
					rows: [
						updated("owner/repo-b", "HEAD", HASHES, ["repo-b", "skill"]),
						notChecked("owner/repo-a", "HEAD", REASON),
					],
					tally: closed({ updated: 1, notChecked: 1 }),
				}),
			);
			// The check-failed group mutates no manifest state (probe failed before any
			// clone); the succeeding sibling B still persists.
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
				expect.anything(),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
		});

		it("all-mode constrained-no-match warns and exits 0, entry left untouched", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained-no-match",
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// Excluded from hasFailedOutcome -> the batch resolves (exit 0).
			expect(err).toBeUndefined();
			// Drawn as needing attention (!), never failed (✗).
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^2.0", "repo")]],
					rows: [noMatch("owner/repo", "^2.0")],
					tally: closed({ notChecked: 1 }),
				}),
			);
			// Entry left untouched: no clone, no write, no add/remove.
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(mockAddEntry).not.toHaveBeenCalled();
			expect(mockRemoveEntry).not.toHaveBeenCalled();
		});

		// --- all-mode: the four hard-failure categories each trip ExitSignal(1),
		// while a succeeding sibling still persists (partial-success) ---

		it("all-mode aborted exits 1 while the succeeded sibling persists", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": skillEntry("a"),
				"owner/repo-b": skillEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			// Distinct temp dirs so the derive gate can be failed for repo-a only.
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-a", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			// repo-a's recorded SKILL.md is gone and two skills now carry its name ->
			// derive-before-delete abort (install intact, entry untouched); repo-b clean.
			mockAccess.mockImplementation(async (path: unknown) => {
				if (typeof path === "string" && path.includes("/clone-a/")) {
					throw new Error("ENOENT");
				}
				return undefined;
			});
			rewalkFinds("x/repo-a", "y/repo-a");
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/b/"],
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// aborted is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Partial success: sibling B persisted; aborted A entry left intact.
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(mockWriteManifest.mock.calls.length).toBeGreaterThan(0);
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-b"],
			).toBeDefined();
			// aborted A's original entry is preserved in the persisted manifest, not
			// merely not-removed.
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-a"],
			).toBeDefined();
		});

		it("all-mode blocked exits 1 while the succeeded sibling persists", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": skillEntry("a"),
				"owner/repo-b": skillEntry("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-a", commit: REMOTE_SHA })
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			// repo-a's re-clone has an escaping symlink -> copy-safety block (install
			// intact, entry untouched); repo-b clean.
			mockScanForEscapingSymlinks.mockImplementation(
				async (sourceDir: unknown) => {
					if (typeof sourceDir === "string" && sourceDir.includes("/clone-a")) {
						throw new SymlinkEscapeError("evil-link", "/etc/passwd");
					}
					return undefined;
				},
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/b/"],
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// blocked is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Partial success: sibling B persisted; blocked A entry left intact.
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockRemoveEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-b"],
			).toBeDefined();
			// blocked A's original entry is preserved in the persisted manifest, not
			// merely not-removed.
			expect(
				(mockWriteManifest.mock.calls.at(-1)![1] as Manifest)["owner/repo-a"],
			).toBeDefined();
		});

		it("all-mode failed (clone-failure fan-out) exits 1, no entries removed", async () => {
			const member = (name: string): ManifestEntry =>
				makeEntry({
					commit: INSTALLED_SHA,
					files: [`.claude/skills/${name}/`],
				});
			// Two 2-member collections -> two groups. Group A's shared clone throws
			// (group-fatal), fanning out to N `failed` outcomes (Phase 1 task 1-7);
			// group B clones and updates.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a/x": member("x"),
				"owner/repo-a/y": member("y"),
				"owner/repo-b/m": member("m"),
				"owner/repo-b/n": member("n"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource
				.mockRejectedValueOnce(new Error("git clone failed"))
				.mockResolvedValueOnce({ tempDir: "/tmp/clone-b", commit: REMOTE_SHA });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/x/"],
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// `failed` is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// A clone failure removes NO entries (only copy-failed does).
			expect(mockRemoveEntry).not.toHaveBeenCalled();
			// Sibling group B still streamed and persisted; group A wrote nothing.
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b/m",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			expect(mockAddEntry).not.toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining("owner/repo-a"),
				expect.anything(),
			);
		});

		it("all-mode copy-failed exits 1, its entry removed, siblings persist", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/a/"],
				}),
				"owner/repo-b": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/b/"],
				}),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "head",
				resolvedSha: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/clone",
				commit: REMOTE_SHA,
			});
			// repo-a's re-copy throws AFTER its old files are nuked -> copy-failed
			// (its entry is removed); repo-b succeeds.
			mockCopyBareSkill
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/b/"] });

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// copy-failed is in hasFailedOutcome membership -> ExitSignal(1).
			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Its own entry removed; the sibling still persists.
			expect(mockRemoveEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-a",
			);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo-b",
				expect.objectContaining({ commit: REMOTE_SHA }),
			);
			const lastWrite = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(lastWrite["owner/repo-a"]).toBeUndefined();
			expect(lastWrite["owner/repo-b"]).toBeDefined();
		});

		// --- capstone: hasFailedOutcome membership is EXACTLY the four hard failures;
		// no non-actioned category trips the all-mode non-zero exit ---

		it("no non-actioned status (up-to-date / newer-tags / check-failed / constrained-no-match) trips the all-mode non-zero exit", async () => {
			const CHECK_REASON = "ls-remote failed: dead remote";
			// Four groups, one per non-actioned category — none of which is a member
			// of hasFailedOutcome (aborted | blocked | failed | copy-failed).
			mockReadManifestOrExit.mockResolvedValue({
				"owner/uptodate": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/uptodate/"],
				}),
				"owner/newer": makeEntry({
					ref: "v1.0",
					commit: INSTALLED_SHA,
					files: [".claude/skills/newer/"],
				}),
				"owner/checkfail": makeEntry({
					commit: INSTALLED_SHA,
					files: [".claude/skills/checkfail/"],
				}),
				"owner/nomatch": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
					files: [".claude/skills/nomatch/"],
				}),
			});
			mockResolveGroupTarget.mockImplementation(async (group) => {
				const key = group.members[0]!.key;
				if (key === "owner/uptodate") {
					return { kind: "head", resolvedSha: INSTALLED_SHA };
				}
				if (key === "owner/newer") {
					return { kind: "tag", tag: "v1.0", newerTags: ["v2.0"] };
				}
				if (key === "owner/checkfail") {
					return { kind: "check-failed", reason: CHECK_REASON };
				}
				return { kind: "constrained-no-match" };
			});

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			// None of the four categories is a hasFailedOutcome member -> exit 0.
			expect(err).toBeUndefined();
			// Every category was genuinely produced (not swallowed by an early
			// return), and none drew as failed.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/uptodate", "HEAD", "uptodate"),
							group("owner/newer", "v1.0", "newer"),
							group("owner/checkfail", "HEAD", "checkfail"),
							group("owner/nomatch", "^2.0", "nomatch"),
						],
					],
					rows: [
						upToDate("owner/uptodate", "HEAD"),
						newerTags("owner/newer", "v1.0"),
						notChecked("owner/checkfail", "HEAD", CHECK_REASON),
						noMatch("owner/nomatch", "^2.0"),
					],
					next: [
						{
							subject: "owner/newer",
							remedy: {
								lead: "Pinned to v1.0, newer tags available (latest: v2.0). To upgrade:",
								steps: [{ command: "npx agntc add owner/newer@v2.0" }],
							},
						},
					],
					tally: closed({ upToDate: 2, notChecked: 2 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("constructs ParsedSource for cloneSource", () => {
		it("creates github-shorthand ParsedSource from manifest key and entry ref", async () => {
			const entry = makeEntry({ ref: "dev" });
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "github-shorthand",
					owner: "owner",
					repo: "repo",
					ref: "dev",
				}),
			);
		});

		it.each([
			["by key", "owner/repo"],
			["in all-mode", undefined],
		])("keeps a branch entry on its branch when updated %s", async (_, key) => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "dev", commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(key, {}, ui);

			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{
					"owner/repo": expect.objectContaining({
						ref: "dev",
						commit: REMOTE_SHA,
					}),
				},
			);
		});

		it("uses stored cloneUrl for cloneSource when available", async () => {
			const entry = makeEntry({
				ref: "dev",
				cloneUrl: "https://gitlab.com/owner/repo.git",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					cloneUrl: "https://gitlab.com/owner/repo.git",
				}),
			);
		});

		it("falls back to github-shorthand when cloneUrl is null", async () => {
			const entry = makeEntry({ ref: "dev", cloneUrl: null });
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "github-shorthand",
					owner: "owner",
					repo: "repo",
				}),
			);
		});

		it("uses null ref for HEAD-tracking plugins", async () => {
			const entry = makeEntry({ ref: null });
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: null,
				}),
			);
		});
	});

	describe("recorded type replay — pack", () => {
		it("re-walks a pack entry and copies what it holds now", async () => {
			const entry = makeEntry({
				type: "pack",
				files: [".claude/skills/old-skill/", ".claude/agents/executor.md"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockDiscover.mockResolvedValue(onlyPack(LARAVEL_PACK));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [
					".claude/skills/new-skill/",
					".claude/agents/executor.md",
				],
				assetCounts: { skills: 1, agents: 1 },
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockDiscover).toHaveBeenCalledWith("/tmp/agntc-clone", {
				startPath: "",
				forcePack: true,
				rootName: "repo",
			});
			expect(mockCopyPack).toHaveBeenCalledWith(
				LARAVEL_PACK,
				{ root: "/tmp/agntc-clone", local: false },
				"/fake/project",
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo",
				expect.objectContaining({
					type: "pack",
					files: [".claude/skills/new-skill/", ".claude/agents/executor.md"],
				}),
			);
		});

		it("notes a pack entry that is now a single skill under its row", async () => {
			const entry = makeEntry({
				type: "pack",
				files: [".claude/agents/openai.yaml"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo/swift": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockDiscover.mockRejectedValue(
				new PackConflictError("single skill", "single-skill"),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/swift/"],
			});

			await runUpdate("owner/repo/swift", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "swift")]],
					rows: [updated("owner/repo", "HEAD", HASHES, ["swift", "skill"])],
					notes: [
						sentence(
							"owner/repo/swift is a single skill — reinstalled as a skill",
						),
					],
					tally: closed({ updated: 1 }),
				}),
			);
			// Noted while its task spins, so it prints under the row it settles.
			const [, updating] = ui.blocks[0]!.tasks;
			expect(ui.note.mock.invocationCallOrder[0]).toBeLessThan(
				updating!.settle.mock.invocationCallOrder[0]!,
			);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/agents/openai.yaml",
			]);
			expect(mockAddEntry).toHaveBeenCalledWith(
				expect.anything(),
				"owner/repo/swift",
				expect.objectContaining({
					type: "skill",
					files: [".claude/skills/swift/"],
				}),
			);
		});
	});

	describe("all-mode reinstall notes", () => {
		it("notes a member while its group's task spins, so it prints under the group's row", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/swift": makeEntry({
					type: "pack",
					files: [".claude/agents/openai.yaml"],
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockDiscover.mockRejectedValue(
				new PackConflictError("single skill", "single-skill"),
			);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/swift/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "swift")]],
					rows: [updated("owner/repo", "HEAD", HASHES, ["swift", "skill"])],
					notes: [
						sentence(
							"owner/repo/swift is a single skill — reinstalled as a skill",
						),
					],
					tally: closed({ updated: 1 }),
				}),
			);
			const [, updating] = ui.blocks[0]!.tasks;
			expect(ui.note.mock.invocationCallOrder[0]).toBeLessThan(
				updating!.settle.mock.invocationCallOrder[0]!,
			);
		});
	});

	describe("recorded type replay — skill", () => {
		it("uses copyBareSkill for a skill entry", async () => {
			const entry = makeEntry();
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: "/tmp/agntc-clone",
					projectDir: "/fake/project",
				}),
			);
			expect(mockCopyPack).not.toHaveBeenCalled();
		});
	});

	describe("newer-tags", () => {
		it("shows pinned ref and newer tags available message", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "v1.0", "repo")]],
					rows: [newerTags("owner/repo", "v1.0", { member: "repo" })],
					next: [
						pinnedKey(
							"owner/repo",
							"v1.0",
							["v3.0", "v2.0"],
							"npx agntc add owner/repo@v3.0",
						),
					],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});

		it("lists newer tags newest-first", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0", "v4.0"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(drawn().next).toEqual([
				pinnedKey(
					"owner/repo",
					"v1.0",
					["v4.0", "v3.0", "v2.0"],
					"npx agntc add owner/repo@v4.0",
				),
			]);
		});

		it("does not clone, nuke, or write manifest", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("exits 0 (does not throw)", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0"],
			});

			await expect(runUpdate("owner/repo", {}, ui)).resolves.toBeUndefined();
		});

		it("shows re-add command for collection plugin key", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/go": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate("owner/repo/go", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "v1.0", "go")]],
					rows: [newerTags("owner/repo", "v1.0", { member: "go" })],
					next: [
						pinnedKey(
							"owner/repo/go",
							"v1.0",
							["v3.0", "v2.0"],
							"npx agntc add owner/repo/go@v3.0",
						),
					],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});

		it("single-key exact-pin standalone queues npx agntc add owner/repo@<newest>", async () => {
			// Regression-lock (task 4-2): the single-key path for an exact-pin
			// standalone stays key-scoped — it suggests the newest tag as
			// `add owner/repo@v3.0` (update.ts:151, pre-existing), NEVER the bare
			// caret footer form `add owner/repo` (which would silently switch the
			// user into caret tracking).
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate("owner/repo", {}, ui);

			// Exact-pin keeps the @<newest> suffix — never the bare caret re-add.
			expect(drawn().next).toEqual([
				pinnedKey(
					"owner/repo",
					"v1.0",
					["v3.0", "v2.0"],
					"npx agntc add owner/repo@v3.0",
				),
			]);
		});

		it("single-key exact-pin collection member queues npx agntc add owner/repo/<member>@<newest>", async () => {
			// Regression-lock (task 4-2): a single-key COLLECTION MEMBER stays
			// member-scoped — the command targets the one plugin
			// (`add owner/repo/go@v3.0`), NOT the repo-level collapse
			// (`add owner/repo@v3.0`) the all-mode collapsed line uses.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/go": makeEntry({ ref: "v1.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "newer-tags",
				tags: ["v2.0", "v3.0"],
			});

			await runUpdate("owner/repo/go", {}, ui);

			// Member-scoped, NOT the repo-level command the all-mode collapse uses.
			expect(drawn().next).toEqual([
				pinnedKey(
					"owner/repo/go",
					"v1.0",
					["v3.0", "v2.0"],
					"npx agntc add owner/repo/go@v3.0",
				),
			]);
		});
	});

	describe("tag-pinned up-to-date", () => {
		it("shows up-to-date for tag-pinned plugin with no newer tags", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: "v3.0" }),
			});
			mockCheckForUpdate.mockResolvedValue({ status: "up-to-date" });

			await runUpdate("owner/repo", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "v3.0", "repo")]],
					rows: [upToDate("owner/repo", "v3.0", { member: "repo" })],
					tally: closed({ upToDate: 1 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});
	});

	describe("local path re-copy", () => {
		const LOCAL_KEY = "/Users/lee/Code/my-plugin";
		const LOCAL_ENTRY: ManifestEntry = {
			ref: null,
			commit: null,
			installedAt: "2026-02-01T00:00:00.000Z",
			files: [".claude/skills/my-plugin/"],
			cloneUrl: null,
		};

		function setupLocalBase(): void {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});
		}

		it("triggers re-copy from stored path when status is local", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(mockStat).toHaveBeenCalledWith(LOCAL_KEY);
			expect(mockCopyBareSkill).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceDir: LOCAL_KEY,
					projectDir: "/fake/project",
				}),
			);
		});

		it("validates path exists and is a directory", async () => {
			setupLocalBase();
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(mockStat).toHaveBeenCalledWith(LOCAL_KEY);
		});

		it("errors when path does not exist", async () => {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockRejectedValue(
				Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
			);

			const err = await runUpdate(LOCAL_KEY, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(drawn()).toEqual(
				screen({
					subjects: [[local(LOCAL_KEY)]],
					rows: [
						{
							status: "failed",
							subject: LOCAL_KEY,
							meta: "local",
							detail: "path does not exist",
						},
					],
					tally: closed({ failed: 1 }),
				}),
			);
		});

		it("errors when path is not a directory", async () => {
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: LOCAL_ENTRY });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => false } as Stats);

			const err = await runUpdate(LOCAL_KEY, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(drawn().rows).toEqual([
				{
					status: "failed",
					subject: LOCAL_KEY,
					meta: "local",
					detail: "path is not a directory",
				},
			]);
		});

		it("does not use git clone for local updates", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});

		it("nukes then copies for local re-copy", async () => {
			setupLocalBase();

			const callOrder: string[] = [];
			mockNukeManifestFiles.mockImplementation(async () => {
				callOrder.push("nuke");
				return { removed: [], skipped: [] };
			});
			mockCopyBareSkill.mockImplementation(async () => {
				callOrder.push("copy");
				return { copiedFiles: [".claude/skills/my-plugin/"] };
			});

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(callOrder).toEqual(["nuke", "copy"]);
		});

		it("updates manifest with null ref and commit", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ [LOCAL_KEY]: LOCAL_ENTRY },
				LOCAL_KEY,
				expect.objectContaining({
					ref: null,
					commit: null,
					files: [".claude/skills/my-plugin/"],
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("shows Refreshed summary", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[local(LOCAL_KEY)]],
					rows: [
						{
							status: "done",
							subject: LOCAL_KEY,
							meta: "local",
							detail: { label: "refreshed", aside: "skill" },
						},
					],
					tally: closed({ refreshed: 1 }),
				}),
			);
			expect(progress()).toEqual([
				{ subject: LOCAL_KEY, meta: "local", text: "refreshing…" },
			]);
		});

		it("draws a local entry under the home folder by its path from ~, in all-mode too", async () => {
			const underHome = join(homedir(), "Code", "my-plugin");
			mockReadManifestOrExit.mockResolvedValue({ [underHome]: LOCAL_ENTRY });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-plugin/"],
			});

			await runUpdate(undefined, {}, ui);

			const shortened = `~${sep}Code${sep}my-plugin`;
			expect(progress()).toEqual([
				{ subject: shortened, meta: "local", text: "refreshing…" },
			]);
			expect(drawn()).toEqual(
				screen({
					subjects: [[local(shortened)]],
					rows: [refreshed(shortened, "skill")],
					tally: closed({ refreshed: 1 }),
				}),
			);
		});

		it("does not create a temp dir for local updates", async () => {
			setupLocalBase();

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockCleanupTempDir).not.toHaveBeenCalled();
		});

		it("re-walks a local pack entry from its folder", async () => {
			const pluginEntry: ManifestEntry = { ...LOCAL_ENTRY, type: "pack" };
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: pluginEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockDiscover.mockResolvedValue(onlyPack(LARAVEL_PACK));
			mockCopyPack.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/", ".claude/agents/executor.md"],
				assetCounts: { skills: 1, agents: 1 },
			});

			await runUpdate(LOCAL_KEY, {}, ui);

			expect(mockDiscover).toHaveBeenCalledWith(LOCAL_KEY, {
				startPath: "",
				forcePack: true,
				rootName: basename(LOCAL_KEY),
			});
			expect(mockCopyPack).toHaveBeenCalledWith(
				LARAVEL_PACK,
				{ root: LOCAL_KEY, local: true },
				"/fake/project",
			);
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});

		it("says why when its recorded path leads outside its folder", async () => {
			setupLocalBase();
			mockReadManifestOrExit.mockResolvedValue({
				[LOCAL_KEY]: {
					...LOCAL_ENTRY,
					localRoot: LOCAL_KEY,
					sourceSubpath: "../x",
				},
			});

			const err = await runUpdate(LOCAL_KEY, {}, ui).catch((e) => e);

			expect((err as ExitSignal).code).toBe(1);
			expect(drawn().rows).toEqual([
				{
					status: "failed",
					subject: LOCAL_KEY,
					meta: "local",
					detail: 'subpath "../x" resolves outside the clone root',
				},
			]);
			expect(ui.cancel).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
		});
	});

	describe("collection plugin key", () => {
		it("resolves collection key and clones from owner/repo", async () => {
			const entry = makeEntry({
				type: "skill",
				files: [".claude/skills/go/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo/go": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// readConfig for the subdir go/
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			await runUpdate("owner/repo/go", {}, ui);

			// Clone uses owner/repo (first two segments)
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					owner: "owner",
					repo: "repo",
				}),
			);
			// The recorded-skill validation gate uses the subdir
			expect(mockAccess).toHaveBeenCalledWith("/tmp/agntc-clone/go/SKILL.md");
			expect(mockCopyBareSkill).toHaveBeenCalledOnce();
		});
	});

	describe("manifest read error", () => {
		it("exits 1 on manifest read failure", async () => {
			mockReadManifestOrExit.mockRejectedValue(new ExitSignal(1));

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
		});
	});

	describe("collection prefix matching", () => {
		it("resolves owner/repo to multiple collection keys and updates each", async () => {
			const goEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/go/"],
			});
			const tsEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/ts/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/go": goEntry,
				"owner/repo/ts": tsEntry,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});

			// Return distinct copiedFiles per key so we can verify both entries
			mockCopyBareSkill
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/go/"] })
				.mockResolvedValueOnce({ copiedFiles: [".claude/skills/ts/"] });

			await runUpdate("owner/repo", {}, ui);

			// One group: probed once, cloned once, recorded in one write.
			expect(mockResolveGroupTarget).toHaveBeenCalledOnce();
			expect(mockCloneSource).toHaveBeenCalledOnce();
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{
					"owner/repo/go": expect.objectContaining({
						commit: REMOTE_SHA,
						files: [".claude/skills/go/"],
					}),
					"owner/repo/ts": expect.objectContaining({
						commit: REMOTE_SHA,
						files: [".claude/skills/ts/"],
					}),
				},
			);
		});

		it("resolves owner/repo/plugin-name to exact match", async () => {
			const goEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/go/"],
			});
			const tsEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/ts/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/go": goEntry,
				"owner/repo/ts": tsEntry,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/go/"],
			});

			await runUpdate("owner/repo/go", {}, ui);

			expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
			expect(mockCheckForUpdate).toHaveBeenCalledWith("owner/repo/go", goEntry);
		});

		it("shows error for nonexistent prefix", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"other/plugin": makeEntry(),
			});

			const err = await runUpdate("nonexistent/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(ui.fail).toHaveBeenCalledExactlyOnceWith(
				"nonexistent/repo is not installed.",
			);
		});

		it("prefers exact match when key exists as both standalone and collection prefix", async () => {
			const standaloneEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/standalone/"],
			});
			const collectionEntry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/sub-plugin/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": standaloneEntry,
				"owner/repo/sub-plugin": collectionEntry,
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/standalone/"],
			});

			await runUpdate("owner/repo", {}, ui);

			// Should only update the exact match, not the collection entry
			expect(mockCheckForUpdate).toHaveBeenCalledTimes(1);
			expect(mockCheckForUpdate).toHaveBeenCalledWith(
				"owner/repo",
				standaloneEntry,
			);
		});
	});

	describe("copy-failed — single-update git path", () => {
		it("throws ExitSignal and removes manifest entry on copy failure", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			const manifest = { "owner/repo": entry };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ "owner/repo": expect.anything() }),
			);
		});

		it("logs a recovery hint naming the copy error on copy failure", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			const manifest = { "owner/repo": entry };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(
				new Error("ENOSPC: no space left on device, write"),
			);

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						stopped("owner/repo", "HEAD", HASHES, "failed", [
							"repo",
							"update failed after removing old files (ENOSPC: no space left on device, write). It is currently uninstalled.",
						]),
					],
					next: [
						{
							subject: "owner/repo",
							remedy: {
								lead: "To install it again:",
								steps: [{ command: "npx agntc add owner/repo" }],
							},
						},
					],
					tally: closed({ failed: 1 }),
				}),
			);
		});
	});

	describe("copy-failed — single-update local path", () => {
		const LOCAL_KEY = "/Users/lee/Code/my-plugin";
		const LOCAL_ENTRY: ManifestEntry = {
			ref: null,
			commit: null,
			installedAt: "2026-02-01T00:00:00.000Z",
			files: [".claude/skills/my-plugin/"],
			cloneUrl: null,
		};

		it("throws ExitSignal and removes manifest entry on local copy failure", async () => {
			const manifest = { [LOCAL_KEY]: LOCAL_ENTRY };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate(LOCAL_KEY, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledWith(
				"/fake/project",
				expect.not.objectContaining({ [LOCAL_KEY]: expect.anything() }),
			);
		});

		it("logs recovery hint on local copy failure", async () => {
			const manifest = { [LOCAL_KEY]: LOCAL_ENTRY };
			mockReadManifestOrExit.mockResolvedValue(manifest);
			mockReadManifest.mockResolvedValue(manifest);
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			await runUpdate(LOCAL_KEY, {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [[local(LOCAL_KEY)]],
					rows: [
						{
							status: "failed",
							subject: LOCAL_KEY,
							meta: "local",
							detail:
								"update failed after removing old files (disk full). It is currently uninstalled.",
						},
					],
					next: [
						{
							subject: LOCAL_KEY,
							remedy: {
								lead: "To install it again:",
								steps: [{ command: `npx agntc add ${LOCAL_KEY}` }],
							},
						},
					],
					tally: closed({ failed: 1 }),
				}),
			);
		});
	});

	describe("constrained-update-available — single plugin", () => {
		it("triggers nuke-and-reinstall at the new tag", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
		});

		it("passes new tag as newRef and new commit as newCommit to reinstallEntry", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			// cloneSource should be called with the new tag as ref
			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: "v1.3.0",
				}),
			);
		});

		it("single-key draws the move from entry.ref to result.manifestEntry.ref", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			// oldRef = pre-update entry.ref (v1.2.3), newRef = post-update
			// result.manifestEntry.ref (resolved v1.3.0) → the shared versionMove
			// draws the tag move, not commit hashes.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [
						updated("owner/repo", "^1.0", { from: "v1.2.3", to: "v1.3.0" }, [
							"repo",
							"skill",
						]),
					],
					tally: closed({ updated: 1 }),
				}),
			);
			expect(progress()[1]!.text).toBe("updating to v1.3.0…");
		});

		it("updates ref and commit in manifest to new resolved tag values", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ "owner/repo": entry },
				"owner/repo",
				expect.objectContaining({
					ref: "v1.3.0",
					commit: REMOTE_SHA,
				}),
			);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("preserves constraint value in manifest after update", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockAddEntry).toHaveBeenCalledWith(
				{ "owner/repo": entry },
				"owner/repo",
				expect.objectContaining({
					constraint: "^1.0",
				}),
			);
		});

		it("shows update summary with old and new version (tags for a constrained update)", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			// Both refs are semver tags and the ref moved (v1.2.3 -> v1.3.0) → the
			// shared versionMove draws tags, not the commit hashes.
			expect(drawn().rows[0]!.detail).toEqual({
				move: { from: "v1.2.3", to: "v1.3.0" },
			});
		});

		it("never downgrades — reports up-to-date when current ref is higher than resolved tag", async () => {
			const entry = makeEntry({
				ref: "v1.5.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.4.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [upToDate("owner/repo", "^1.0", { member: "repo" })],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});
	});

	describe("constrained-up-to-date — single plugin", () => {
		it("reports plugin is up to date", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate("owner/repo", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [upToDate("owner/repo", "^1.0", { member: "repo" })],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});

		it("does not clone, nuke, or write manifest", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate("owner/repo", {}, ui);

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("returns null (no manifest changes)", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await expect(runUpdate("owner/repo", {}, ui)).resolves.toBeUndefined();
		});
	});

	describe("constrained-no-match — single plugin", () => {
		it("reports error when no tags satisfy constraint", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^2.0", "repo")]],
					rows: [noMatch("owner/repo", "^2.0", { member: "repo" })],
					tally: closed({ notChecked: 1 }),
				}),
			);
		});

		it("does not clone, nuke, or write manifest", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("leaves plugin untouched — no addEntry call", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			expect(mockAddEntry).not.toHaveBeenCalled();
		});
	});

	describe("constrained statuses — all-plugins mode", () => {
		it("processes constrained-update-available plugins via nuke-and-reinstall with resolved tag", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockCloneSource).toHaveBeenCalledWith(
				expect.objectContaining({
					ref: "v1.3.0",
				}),
			);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/my-skill/",
			]);
			expect(mockWriteManifest).toHaveBeenCalled();
		});

		it("adds constrained-up-to-date plugins to up-to-date list", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.3.0",
					commit: INSTALLED_SHA,
					constraint: "^1.0",
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [upToDate("owner/repo", "^1.0")],
					tally: closed({ upToDate: 1 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("draws a constrained-no-match group as one row with the shared constraint", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^2.0",
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-no-match",
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^2.0", "repo")]],
					rows: [noMatch("owner/repo", "^2.0")],
					tally: closed({ notChecked: 1 }),
				}),
			);
			expect(mockCloneSource).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("handles batch with all constrained plugins — mixed constrained statuses", async () => {
			const entryA = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				ref: "v2.1.0",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			const entryC = makeEntry({
				ref: "v3.0.0",
				commit: INSTALLED_SHA,
				constraint: "^4.0",
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
				"owner/repo-c": entryC,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "constrained-update-available",
							tag: "v1.3.0",
							commit: REMOTE_SHA,
							latestOverall: "v2.0.0",
						} as UpdateCheckResult;
					if (key === "owner/repo-b")
						return {
							status: "constrained-up-to-date",
							latestOverall: "v3.1.0",
						} as UpdateCheckResult;
					return {
						status: "constrained-no-match",
					} as UpdateCheckResult;
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate(undefined, {}, ui);

			// A should be updated (constrained-update-available)
			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockWriteManifest).toHaveBeenCalled();
			// A row for each of the three, the updated repo-a settling first.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "^1.0", "repo-a"),
							group("owner/repo-b", "^2.0", "repo-b"),
							group("owner/repo-c", "^4.0", "repo-c"),
						],
					],
					rows: [
						updated("owner/repo-a", "^1.0", { from: "v1.2.3", to: "v1.3.0" }, [
							"repo-a",
							"skill",
						]),
						upToDate("owner/repo-b", "^2.0"),
						noMatch("owner/repo-c", "^4.0"),
					],
					next: [
						upgrade(
							"owner/repo-a",
							"v1.3.0",
							"v2.0.0",
							"npx agntc add owner/repo-a",
						),
						upgrade(
							"owner/repo-b",
							"v2.1.0",
							"v3.1.0",
							"npx agntc add owner/repo-b",
						),
					],
					tally: closed({ updated: 1, upToDate: 1, notChecked: 1 }),
				}),
			);
		});

		it("handles mix of constrained + branch-tracking + tag-pinned + local plugins", async () => {
			const constrainedEntry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/constrained-skill/"],
			});
			const branchEntry = makeEntry({
				ref: null,
				commit: INSTALLED_SHA,
				files: [".claude/skills/branch-skill/"],
			});
			const tagEntry = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				files: [".claude/skills/tagged-skill/"],
			});
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/local-skill/"],
				cloneUrl: null,
			};

			mockReadManifestOrExit.mockResolvedValue({
				"owner/constrained": constrainedEntry,
				"owner/branch": branchEntry,
				"owner/tagged": tagEntry,
				"/local/path": localEntry,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/constrained")
						return {
							status: "constrained-update-available",
							tag: "v1.3.0",
							commit: REMOTE_SHA,
							latestOverall: null,
						} as UpdateCheckResult;
					if (key === "owner/branch")
						return {
							status: "update-available",
							remoteCommit: REMOTE_SHA,
						} as UpdateCheckResult;
					if (key === "owner/tagged")
						return {
							status: "newer-tags",
							tags: ["v2.0"],
						} as UpdateCheckResult;
					return { status: "local" } as UpdateCheckResult;
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/some-skill/"],
			});
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);

			await runUpdate(undefined, {}, ui);

			// Constrained and branch should be processed (clone called)
			// Local should be processed (stat called)
			// Tagged should NOT be processed (newer-tags is info only)
			// Per-group persistence (task 1-6): constrained, branch, and local each
			// persist as their own unit → three writes (tagged never mutates).
			expect(mockWriteManifest).toHaveBeenCalledTimes(3);
			// All four draw a row: the actioned three as they settle, then the
			// tagged one left alone.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/constrained", "^1.0", "constrained"),
							group("owner/branch", "HEAD", "branch"),
							group("owner/tagged", "v1.0", "tagged"),
							local("/local/path"),
						],
					],
					rows: [
						updated(
							"owner/constrained",
							"^1.0",
							{ from: "v1.2.3", to: "v1.3.0" },
							["constrained", "skill"],
						),
						updated("owner/branch", "HEAD", HASHES, ["branch", "skill"]),
						{
							status: "done",
							subject: "/local/path",
							meta: "local",
							detail: { label: "refreshed", aside: "skill" },
						},
						newerTags("owner/tagged", "v1.0"),
					],
					next: [
						{
							subject: "owner/tagged",
							remedy: {
								lead: "Pinned to v1.0, newer tags available (latest: v2.0). To upgrade:",
								steps: [{ command: "npx agntc add owner/tagged@v2.0" }],
							},
						},
					],
					tally: closed({ updated: 2, refreshed: 1, upToDate: 1 }),
				}),
			);
		});

		it("batch with no constrained plugins behaves identically to pre-feature", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "update-available",
							remoteCommit: REMOTE_SHA,
						};
					return { status: "newer-tags", tags: ["v2.0"] };
				},
			);
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/skill-a/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockCloneSource).toHaveBeenCalledTimes(1);
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "HEAD", "repo-a"),
							group("owner/repo-b", "v1.0", "repo-b"),
						],
					],
					rows: [
						updated("owner/repo-a", "HEAD", HASHES, ["repo-a", "skill"]),
						newerTags("owner/repo-b", "v1.0"),
					],
					next: [
						{
							subject: "owner/repo-b",
							remedy: {
								lead: "Pinned to v1.0, newer tags available (latest: v2.0). To upgrade:",
								steps: [{ command: "npx agntc add owner/repo-b@v2.0" }],
							},
						},
					],
					tally: closed({ updated: 1, upToDate: 1 }),
				}),
			);
		});

		it("collects out-of-constraint info from constrained-update-available results", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(mockWriteManifest).toHaveBeenCalled();
			expect(drawn().next).toEqual([
				upgrade("owner/repo", "v1.3.0", "v2.0.0", "npx agntc add owner/repo"),
			]);
		});

		it("collects out-of-constraint info from constrained-up-to-date results", async () => {
			const entryA = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
			});
			const entryB = makeEntry({
				ref: "v2.1.0",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "constrained-up-to-date",
							latestOverall: "v2.0.0",
						} as UpdateCheckResult;
					return {
						status: "constrained-up-to-date",
						latestOverall: null,
					} as UpdateCheckResult;
				},
			);

			await runUpdate(undefined, {}, ui);

			// Both up to date; only the one with a newer version outside its
			// constraint queues an upgrade.
			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo-a", "^1.0", "repo-a"),
							group("owner/repo-b", "^2.0", "repo-b"),
						],
					],
					rows: [
						upToDate("owner/repo-a", "^1.0"),
						upToDate("owner/repo-b", "^2.0"),
					],
					next: [
						upgrade(
							"owner/repo-a",
							"v1.3.0",
							"v2.0.0",
							"npx agntc add owner/repo-a",
						),
					],
					tally: closed({ upToDate: 2 }),
				}),
			);
		});

		it("never downgrades constrained plugins in batch mode", async () => {
			const entry = makeEntry({
				ref: "v1.5.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.4.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});

			await runUpdate(undefined, {}, ui);

			// Should not clone (no downgrade)
			expect(mockCloneSource).not.toHaveBeenCalled();
			// The never-downgraded member is demoted to up to date.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [upToDate("owner/repo", "^1.0")],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});

		it("constrained-update-available draws the update, not up to date", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [
						updated("owner/repo", "^1.0", { from: "v1.2.3", to: "v1.3.0" }, [
							"repo",
							"skill",
						]),
					],
					tally: closed({ updated: 1 }),
				}),
			);
		});
	});

	describe("copy-failed — all-updates mode", () => {
		it("removes entry from batch manifest for git copy failure", async () => {
			const entryA = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});

			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return { status: "update-available", remoteCommit: REMOTE_SHA };
					return { status: "update-available", remoteCommit: REMOTE_SHA };
				},
			);

			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});

			// First plugin copy fails, second succeeds
			mockCopyBareSkill
				.mockRejectedValueOnce(new Error("disk full"))
				.mockResolvedValueOnce({
					copiedFiles: [".claude/skills/skill-b/"],
				});

			// Copy failure makes the run exit non-zero, but the successful sibling
			// is still written first. Catch so the manifest assertions below run.
			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			// Per-group persistence (task 1-6): repo-a's group (copy-failed → remove)
			// and repo-b's group (updated → add) each write once → two writes.
			expect(mockWriteManifest).toHaveBeenCalledTimes(2);
			const writtenManifest = mockWriteManifest.mock.calls.at(
				-1,
			)![1] as Manifest;
			// copy-failed entry should be removed
			expect(writtenManifest["owner/repo-a"]).toBeUndefined();
			// successful entry should be present
			expect(writtenManifest["owner/repo-b"]).toBeDefined();
		});

		it("queues the recovery re-add in Next for a copy-failed plugin", async () => {
			const entry = makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			// Copy failure exits non-zero after the run is drawn; catch so the
			// assertion below still runs.
			await runUpdate(undefined, {}, ui).catch(() => {});

			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "repo")]],
					rows: [
						stopped("owner/repo", "HEAD", HASHES, "failed", [
							"repo",
							"update failed after removing old files (disk full). It is currently uninstalled.",
						]),
					],
					next: [
						{
							subject: "owner/repo",
							remedy: {
								lead: "To install it again:",
								steps: [{ command: "npx agntc add owner/repo" }],
							},
						},
					],
					tally: closed({ failed: 1 }),
				}),
			);
		});

		it("removes entry from batch manifest for local copy failure", async () => {
			const LOCAL_KEY = "/Users/lee/Code/my-plugin";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/my-plugin/"],
				cloneUrl: null,
			};
			mockReadManifestOrExit.mockResolvedValue({ [LOCAL_KEY]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockCopyBareSkill.mockRejectedValue(new Error("disk full"));

			// Copy failure exits non-zero after the manifest write; catch so the
			// removal assertion below still runs.
			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect((err as ExitSignal).code).toBe(1);
			expect(mockWriteManifest).toHaveBeenCalledTimes(1);
			const writtenManifest = mockWriteManifest.mock.calls[0]![1] as Manifest;
			expect(writtenManifest[LOCAL_KEY]).toBeUndefined();
		});
	});

	describe("out-of-constraint info section", () => {
		it("all-mode footer names the post-bump landed tag as current when a safe bump applies this run", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(undefined, {}, ui);

			// A same-run safe bump lands v1.3.0; the footer names that POST-BUMP
			// landed tag (group target.tag), not the pre-bump ref, so it agrees with
			// the row's move.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [
						updated("owner/repo", "^1.0", { from: "v1.2.3", to: "v1.3.0" }, [
							"repo",
							"skill",
						]),
					],
					next: [
						upgrade(
							"owner/repo",
							"v1.3.0",
							"v2.0.0",
							"npx agntc add owner/repo",
						),
					],
					tally: closed({ updated: 1 }),
				}),
			);
		});

		it("omits info section in batch mode when no out-of-constraint versions exist", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate(undefined, {}, ui);

			expect(drawn().next).toEqual([]);
		});

		it("renders info section for multiple plugins in batch mode", async () => {
			const entryA = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/skill-a/"],
			});
			const entryB = makeEntry({
				ref: "v2.1.0",
				commit: INSTALLED_SHA,
				constraint: "^2.0",
				files: [".claude/skills/skill-b/"],
			});
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo-a": entryA,
				"owner/repo-b": entryB,
			});
			mockCheckForUpdate.mockImplementation(
				async (key: string, _entry: ManifestEntry) => {
					if (key === "owner/repo-a")
						return {
							status: "constrained-up-to-date",
							latestOverall: "v2.0.0",
						} as UpdateCheckResult;
					return {
						status: "constrained-up-to-date",
						latestOverall: "v3.1.0",
					} as UpdateCheckResult;
				},
			);

			await runUpdate(undefined, {}, ui);

			expect(drawn().next).toEqual([
				upgrade(
					"owner/repo-a",
					"v1.2.3",
					"v2.0.0",
					"npx agntc add owner/repo-a",
				),
				upgrade(
					"owner/repo-b",
					"v2.1.0",
					"v3.1.0",
					"npx agntc add owner/repo-b",
				),
			]);
		});

		it("single-key names the post-bump landed tag as current (v1.3.0 -> v2.0.0), consistent with the inline Updated line", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			// current is the LANDED tag (checkResult.tag = v1.3.0), NOT the pre-bump
			// entry.ref (v1.2.3) — matching the row's move to v1.3.0. Anything
			// queued gets Next and the tally, even after one outcome.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [
						updated("owner/repo", "^1.0", { from: "v1.2.3", to: "v1.3.0" }, [
							"repo",
							"skill",
						]),
					],
					next: [
						upgrade(
							"owner/repo",
							"v1.3.0",
							"v2.0.0",
							"npx agntc add owner/repo",
						),
					],
					tally: closed({ updated: 1 }),
				}),
			);
		});

		it("omits info section in single-plugin mode when no out-of-constraint version", async () => {
			const entry = makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: null,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/my-skill/"],
			});

			await runUpdate("owner/repo", {}, ui);

			expect(drawn().next).toEqual([]);
		});

		it("single-key constrained-up-to-date names entry.ref as current (pre/post coincide)", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: "v2.0.0",
			});

			await runUpdate("owner/repo", {}, ui);

			// No safe bump this run: pre/post coincide, so current = entry.ref = v1.3.0.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "repo")]],
					rows: [upToDate("owner/repo", "^1.0", { member: "repo" })],
					next: [
						upgrade(
							"owner/repo",
							"v1.3.0",
							"v2.0.0",
							"npx agntc add owner/repo",
						),
					],
					tally: closed({ upToDate: 1 }),
				}),
			);
		});

		it("a ^0.3.3 entry with 0.4.0 out of constraint renders the same actionable line (0.x-minor gate)", async () => {
			const entry = makeEntry({
				ref: "v0.3.3",
				commit: INSTALLED_SHA,
				constraint: "^0.3.3",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: "v0.4.0",
			});

			await runUpdate("owner/repo", {}, ui);

			// A 0.x-minor (^0.3.3 gates 0.4.0) rides the SAME out-of-constraint path as
			// a major — identical actionable wording, current from the check result.
			expect(drawn().next).toEqual([
				upgrade("owner/repo", "v0.3.3", "v0.4.0", "npx agntc add owner/repo"),
			]);
		});

		it("queues no upgrade for a key whose update failed, its install unmoved", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^1.0",
					files: [".claude/skills/my-skill/"],
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			// Blocked leaves the entry installed as it was, so only the gate on
			// the failure keeps its upgrade out of Next.
			mockScanForEscapingSymlinks.mockRejectedValue(
				new SymlinkEscapeError("evil-link", "/etc/passwd"),
			);

			await runUpdate("owner/repo", {}, ui).catch(() => {});

			expect(drawn().rows[0]!.status).toBe("failed");
			expect(drawn().next).toEqual([]);
		});

		it("does not render info line when within-constraint best equals absolute latest", async () => {
			const entry = makeEntry({
				ref: "v1.3.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [".claude/skills/my-skill/"],
			});
			mockReadManifestOrExit.mockResolvedValue({ "owner/repo": entry });
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: null,
			});

			await runUpdate("owner/repo", {}, ui);

			expect(drawn().next).toEqual([]);
		});

		// --- Per-group footer collapse (task 2-7) ---
		// A constrained member (constraint ^1.0) already at the resolved best tag,
		// with a newer out-of-constraint version available (latestOverall v2.0.0).
		const constrainedMember = (name: string): ManifestEntry =>
			makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0",
				files: [`.claude/skills/${name}/`],
			});

		it("renders one footer line per group for a constrained mixed collection: one bare --skill command for its loose skills, one per pack", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a"),
				"owner/repo/b": {
					...constrainedMember("b"),
					sourceSubpath: "skills/b",
				},
				"owner/repo/tools": { ...constrainedMember("tools"), type: "pack" },
			});
			// ONE constrained group whose shared target is out of constraint
			// (latestOverall set) and at the members' installed tag (all up to date).
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate(undefined, {}, ui);

			// ONE Next item for the whole collection: current = group target.tag,
			// keyed by the group label, the group's bare re-add commands — not N
			// near-identical per-member items.
			expect(drawn().next).toEqual([
				upgrade(
					"owner/repo",
					"v1.2.3",
					"v2.0.0",
					"npx agntc add owner/repo --skill a b",
					"npx agntc add owner/repo/tools --pack",
				),
			]);
		});

		it("a multi-group repo renders two @intent-prefixed footer lines, each with its member's bare re-add command", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": makeEntry({
					ref: "v1.2.3",
					commit: INSTALLED_SHA,
					constraint: "^1.2.3",
					files: [".claude/skills/a/"],
				}),
				"owner/repo/b": makeEntry({
					ref: "v2.0.0",
					commit: INSTALLED_SHA,
					constraint: "^2.0.0",
					files: [".claude/skills/b/"],
				}),
			});
			// Same repo, two intents → two groups, each out of constraint at its own
			// installed tag.
			mockResolveGroupTarget.mockImplementation(async (group) => {
				return group.members[0]!.entry.constraint === "^1.2.3"
					? {
							kind: "constrained",
							tag: "v1.2.3",
							commit: INSTALLED_SHA,
							latestOverall: "v3.0.0",
						}
					: {
							kind: "constrained",
							tag: "v2.0.0",
							commit: INSTALLED_SHA,
							latestOverall: "v3.0.0",
						};
			});

			await runUpdate(undefined, {}, ui);

			// Two Next items: subject disambiguated by @intent, command stays bare
			// (no @intent). current = each group's own target.tag.
			expect(drawn().next).toEqual([
				upgrade(
					"owner/repo@^1.2.3",
					"v1.2.3",
					"v3.0.0",
					"npx agntc add owner/repo/a",
				),
				upgrade(
					"owner/repo@^2.0.0",
					"v2.0.0",
					"v3.0.0",
					"npx agntc add owner/repo/b",
				),
			]);
		});

		it("all-mode footer names the group target tag as current and the group's bare --skill re-add command", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a"),
				"owner/repo/b": constrainedMember("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate(undefined, {}, ui);

			// current = group target.tag (v1.2.3), a bare --skill command, no
			// (constraint: ...) tail.
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "^1.0", "a", "b")]],
					rows: [upToDate("owner/repo", "^1.0")],
					next: [
						upgrade(
							"owner/repo",
							"v1.2.3",
							"v2.0.0",
							"npx agntc add owner/repo --skill a b",
						),
					],
					tally: closed({ upToDate: 2 }),
				}),
			);
		});

		it("the out-of-constraint footer keeps the all-mode (and single-key) exit at 0", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": constrainedMember("a"),
				"owner/repo/b": constrainedMember("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			const allModeErr = await runUpdate(undefined, {}, ui).catch((e) => e);

			// The footer does not feed hasFailedOutcome, so all-mode exit stays 0.
			expect(allModeErr).toBeUndefined();
			expect(drawn().next).toEqual([
				upgrade(
					"owner/repo",
					"v1.2.3",
					"v2.0.0",
					"npx agntc add owner/repo --skill a b",
				),
			]);

			// Single-key path: constrained-up-to-date, out of constraint — also exit 0.
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({
					ref: "v1.3.0",
					commit: INSTALLED_SHA,
					constraint: "^1.0",
					files: [".claude/skills/my-skill/"],
				}),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "constrained-up-to-date",
				latestOverall: "v2.0.0",
			});

			const singleKeyErr = await runUpdate("owner/repo", {}, ui).catch(
				(e) => e,
			);
			expect(singleKeyErr).toBeUndefined();
		});

		// --- Caret disjointness (task 4-2) ---
		// A CONSTRAINED (caret) entry — constraint ^1.2.3, ref v1.2.3 — with a newer
		// OUT-OF-CONSTRAINT major (latestOverall v2.0.0). It resolves to a
		// constrained-* status, so it can only ever reach the task 4-1 caret footer;
		// it is NEVER routed onto the exact-pin @<newest> newer-tags surface. This
		// proves the two surfaces are disjoint: a caret user is never told to
		// `add …@<newest>`.
		const caretMember = (name: string): ManifestEntry =>
			makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.2.3",
				files: [`.claude/skills/${name}/`],
			});

		it("a caret entry with an out-of-constraint major is never routed to a @<newest> newer-tags line", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": caretMember("a"),
				"owner/repo/b": caretMember("b"),
			});
			// Constrained target at the members' installed tag (all up to date) with a
			// newer out-of-constraint major available.
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate(undefined, {}, ui);

			const { rows, next } = drawn();
			// No newer-tags surface at all: neither the "newer tags available" row...
			expect(rows).toEqual([upToDate("owner/repo", "^1.2.3")]);
			// ...nor any @<newest> re-add command (`npx agntc add <anything>@…`). The
			// caret footer's command is the BARE `npx agntc add owner/repo` (no @).
			const commands = next.flatMap(({ remedy }) =>
				remedy.steps.flatMap((step) =>
					"command" in step ? [step.command] : [],
				),
			);
			expect(commands).toEqual(["npx agntc add owner/repo --skill a b"]);
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("a caret entry with an out-of-constraint major emits the bare re-add footer instead", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo/a": caretMember("a"),
				"owner/repo/b": caretMember("b"),
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "constrained",
				tag: "v1.2.3",
				commit: INSTALLED_SHA,
				latestOverall: "v2.0.0",
			});

			await runUpdate(undefined, {}, ui);

			// The caret out-of-constraint footer: current -> newer with the group's
			// BARE re-add command (no @ suffix), one item for the group.
			expect(drawn().next).toEqual([
				upgrade(
					"owner/repo",
					"v1.2.3",
					"v2.0.0",
					"npx agntc add owner/repo --skill a b",
				),
			]);
		});
	});
});

describe("a bare `failed` draws failed on every layout", () => {
	// A bare `failed` member outcome (a per-member reinstall that threw, or a
	// group-fatal clone failure fanned out per member) draws ✗ — the row's
	// status, and a divergent member's own — on every layout: a member of a
	// group, a local entry, a group of one. Never ! (attention). Exit accounting
	// is unchanged: `failed` still trips hasFailedOutcome → ExitSignal(1).

	it("draws a group member's `failed` under the group's row, the row failed", async () => {
		// A 2-member collection → one group, one shared clone that SUCCEEDS. Member a
		// reinstalls cleanly; member b's per-member symlink scan throws, propagating
		// to reinstallMember's defensive catch → a bare `failed` outcome, not the
		// group's clone failure.
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/a": makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/a/"],
			}),
			"owner/repo/b": makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/b/"],
			}),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "head",
			resolvedSha: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/clone",
			commit: REMOTE_SHA,
		});
		// b's per-member reinstall throws BEFORE the copy try/catch (a non-escape
		// error from the symlink scan) → a bare `failed` outcome (not copy-failed);
		// a succeeds.
		mockScanForEscapingSymlinks.mockImplementation(async (dir: unknown) => {
			if (typeof dir === "string" && dir.endsWith("/b")) {
				throw new Error("boom");
			}
		});
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/a/"],
		});

		// `failed` trips the non-zero exit; catch so assertions run.
		await runUpdate(undefined, {}, ui).catch(() => {});

		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "a", "b")]],
				rows: [
					{
						status: "failed",
						subject: "owner/repo",
						meta: "HEAD",
						detail: { move: HASHES },
						children: [
							{ name: "a", status: "done", detail: "skill" },
							{ name: "b", status: "failed", detail: "boom" },
						],
					},
				],
				tally: closed({ updated: 1, failed: 1 }),
			}),
		);
		expect(ui.warn).not.toHaveBeenCalled();
	});

	it("draws a local `failed` as a failed row", async () => {
		// A lone local entry (commit null) whose source path fails validation (stat
		// rejects) → a bare `failed` outcome.
		const LOCAL_KEY = "/local/path";
		mockReadManifestOrExit.mockResolvedValue({
			[LOCAL_KEY]: {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/local/"],
				cloneUrl: null,
			},
		});
		mockStat.mockRejectedValue(new Error("ENOENT"));

		// `failed` trips the non-zero exit; catch so assertions run.
		await runUpdate(undefined, {}, ui).catch(() => {});

		expect(drawn()).toEqual(
			screen({
				subjects: [[local(LOCAL_KEY)]],
				rows: [
					{
						status: "failed",
						subject: LOCAL_KEY,
						meta: "local",
						detail: "path does not exist",
					},
				],
				tally: closed({ failed: 1 }),
			}),
		);
		expect(ui.warn).not.toHaveBeenCalled();
	});

	it("draws a group of one's clone `failed` as a failed row, never a cancel", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo": makeEntry({
				commit: INSTALLED_SHA,
				files: [".claude/skills/solo/"],
			}),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "head",
			resolvedSha: REMOTE_SHA,
		});
		mockCloneSource.mockRejectedValue(new Error("git clone failed"));

		await runUpdate(undefined, {}, ui).catch(() => {});

		expect(drawn().rows).toEqual([
			cloneFailed("owner/repo", "HEAD", "git clone failed", "repo"),
		]);
		expect(ui.cancel).not.toHaveBeenCalled();
		expect(ui.warn).not.toHaveBeenCalled();
	});
});

describe("update without a terminal", () => {
	function targetsByKey(targets: Record<string, GroupTarget>): void {
		mockResolveGroupTarget.mockImplementation(async ({ members: [first] }) => {
			const target = first && targets[first.key];
			if (!target) throw new Error(`no target for ${first?.key}`);
			return target;
		});
	}

	it("prints one document of every entry, a move carrying both ends, and nothing else", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/caret": makeEntry({
				type: "skill",
				ref: "v1.0.0",
				commit: INSTALLED_SHA,
				constraint: "^1.0.0",
				files: [".claude/skills/caret/"],
			}),
			"owner/pinned": makeEntry({ ref: "v3.0.0", commit: INSTALLED_SHA }),
		});
		targetsByKey({
			"owner/caret": {
				kind: "constrained",
				tag: "v1.1.0",
				commit: REMOTE_SHA,
				latestOverall: "v2.0.0",
			},
			"owner/pinned": { kind: "tag", tag: "v3.0.0", newerTags: ["v3.1.0"] },
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/caret/"],
		});

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document).toEqual({
			ok: true,
			command: "update",
			scope: "project",
			items: [
				{
					key: "owner/caret",
					type: "skill",
					status: "updated",
					ref: "v1.1.0",
					commit: REMOTE_SHA,
					constraint: "^1.0.0",
					previousRef: "v1.0.0",
					previousCommit: INSTALLED_SHA,
					latestOutsideConstraint: "v2.0.0",
				},
				{
					key: "owner/pinned",
					type: "skill",
					status: "newer-tags",
					ref: "v3.0.0",
					commit: INSTALLED_SHA,
					constraint: null,
					newerTags: ["v3.1.0"],
				},
			],
			warnings: [],
			notes: [],
		});
		expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
	});

	it("reports each entry when one fails, exiting 1", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/a": makeEntry({ commit: INSTALLED_SHA }),
			"owner/b": makeEntry({ commit: INSTALLED_SHA }),
		});
		targetsByKey({
			"owner/a": { kind: "head", resolvedSha: REMOTE_SHA },
			"owner/b": { kind: "head", resolvedSha: REMOTE_SHA },
		});
		mockCloneSource
			.mockRejectedValueOnce(new Error("network down"))
			.mockResolvedValueOnce({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/b/"],
		});

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document.ok).toBe(false);
		expect(run.document.items).toEqual([
			{
				key: "owner/a",
				type: "skill",
				status: "failed",
				ref: null,
				commit: INSTALLED_SHA,
				constraint: null,
				message: "owner/a: Failed — network down",
			},
			expect.objectContaining({ key: "owner/b", status: "updated" }),
		]);
	});

	it("reports a check that failed with its reason, and stays ok as all-mode does", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/a": makeEntry({ commit: INSTALLED_SHA }),
		});
		targetsByKey({ "owner/a": { kind: "check-failed", reason: "timeout" } });

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document).toMatchObject({
			ok: true,
			items: [{ key: "owner/a", status: "check-failed", reason: "timeout" }],
		});
	});

	it("keeps git's whole error in a failed check's reason", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/a": makeEntry({ commit: INSTALLED_SHA }),
		});
		targetsByKey({ "owner/a": { kind: "check-failed", reason: SSH_REFUSAL } });

		const run = await runMachine(updateCommand, []);

		expect(run.document).toMatchObject({
			items: [{ key: "owner/a", status: "check-failed", reason: SSH_REFUSAL }],
		});
	});

	it("carries a reinstall's note as a note", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/swift": makeEntry({
				type: "pack",
				files: [".claude/agents/openai.yaml"],
			}),
		});
		mockCheckForUpdate.mockResolvedValue({
			status: "update-available",
			remoteCommit: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockDiscover.mockRejectedValue(
			new PackConflictError("single skill", "single-skill"),
		);
		mockCopyBareSkill.mockResolvedValue({
			copiedFiles: [".claude/skills/swift/"],
		});

		const run = await runMachine(updateCommand, []);

		expect(run.document.notes).toEqual([
			"owner/repo/swift is a single skill — reinstalled as a skill",
		]);
		expect(run.document.items).toEqual([
			expect.objectContaining({ key: "owner/repo/swift", type: "skill" }),
		]);
	});

	describe("for one key", () => {
		it("prints the entry it updated", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ ref: null, commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "update-available",
				remoteCommit: REMOTE_SHA,
			});
			mockCloneSource.mockResolvedValue({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/repo/"],
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toEqual({
				ok: true,
				command: "update",
				scope: "project",
				items: [
					{
						key: "owner/repo",
						type: "skill",
						status: "updated",
						ref: null,
						commit: REMOTE_SHA,
						constraint: null,
						previousRef: null,
						previousCommit: INSTALLED_SHA,
					},
				],
				warnings: [],
				notes: [],
			});
			expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
		});

		it("reports a failed check and exits 1, as at a terminal", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toMatchObject({
				ok: false,
				items: [
					{
						key: "owner/repo",
						status: "check-failed",
						reason: "network timeout",
					},
				],
			});
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it("keeps git's whole error in a failed check's reason", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"owner/repo": makeEntry({ commit: INSTALLED_SHA }),
			});
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: SSH_REFUSAL,
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.document).toMatchObject({
				items: [
					{ key: "owner/repo", status: "check-failed", reason: SSH_REFUSAL },
				],
			});
		});

		it("prints an error document for a key that isn't installed", async () => {
			mockReadManifestOrExit.mockResolvedValue({
				"other/plugin": makeEntry(),
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toEqual({
				ok: false,
				command: "update",
				scope: "project",
				error: { message: "owner/repo is not installed." },
				warnings: [],
				notes: [],
			});
		});
	});
});

describe("a key naming several entries", () => {
	function skill(name: string, overrides: Partial<ManifestEntry> = {}) {
		return makeEntry({
			type: "skill",
			commit: INSTALLED_SHA,
			files: [`.claude/skills/${name}/`],
			...overrides,
		});
	}

	function localSkill(name: string): ManifestEntry {
		return {
			ref: null,
			commit: null,
			installedAt: "2026-02-01T00:00:00.000Z",
			files: [`.claude/skills/${name}/`],
			cloneUrl: null,
			type: "skill",
		};
	}

	/** Every group the run probes is behind, and every clone and copy works. */
	function arrangeBehind(manifest: Manifest): void {
		mockReadManifestOrExit.mockResolvedValue(manifest);
		mockResolveGroupTarget.mockResolvedValue({
			kind: "head",
			resolvedSha: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockCopyBareSkill.mockImplementation(async ({ sourceDir }) => ({
			copiedFiles: [`.claude/skills/${basename(sourceDir)}/`],
		}));
	}

	function probedKeys(): string[][] {
		return mockResolveGroupTarget.mock.calls.map(([group]) =>
			group.members.map(({ key }) => key),
		);
	}

	const landed = (name: string) =>
		expect.objectContaining({
			commit: REMOTE_SHA,
			files: [`.claude/skills/${name}/`],
		});

	it("probes and clones a repo once for all of its entries, leaving the rest of the manifest alone", async () => {
		const other = skill("other");
		arrangeBehind({
			"owner/repo/a": skill("a"),
			"other/repo": other,
			"owner/repo/b": skill("b"),
			"owner/repo/c": skill("c"),
		});

		await runUpdate("owner/repo", {}, ui);

		expect(probedKeys()).toEqual([
			["owner/repo/a", "owner/repo/b", "owner/repo/c"],
		]);
		expect(mockCheckForUpdate).not.toHaveBeenCalled();
		expect(mockCloneSource).toHaveBeenCalledOnce();
		expect(mockCopyBareSkill).toHaveBeenCalledTimes(3);
		expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith("/fake/project", {
			"owner/repo/a": landed("a"),
			"other/repo": other,
			"owner/repo/b": landed("b"),
			"owner/repo/c": landed("c"),
		});
	});

	it("draws the repo's group as one row", async () => {
		arrangeBehind({
			"owner/repo/a": skill("a"),
			"owner/repo/b": skill("b"),
		});

		await runUpdate("owner/repo", {}, ui);

		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "a", "b")]],
				rows: [
					updated("owner/repo", "HEAD", HASHES, ["a", "skill"], ["b", "skill"]),
				],
				tally: closed({ updated: 2 }),
			}),
		);
	});

	it("probes and clones each group once when the key spans several", async () => {
		arrangeBehind({
			"owner/one/a": skill("a"),
			"owner/one/b": skill("b"),
			"owner/two/c": skill("c"),
			"owner/two/d": skill("d", { ref: "main" }),
		});

		await runUpdate("owner", {}, ui);

		expect(probedKeys()).toEqual([
			["owner/one/a", "owner/one/b"],
			["owner/two/c"],
			["owner/two/d"],
		]);
		expect(mockCloneSource).toHaveBeenCalledTimes(3);
		expect(mockWriteManifest).toHaveBeenLastCalledWith("/fake/project", {
			"owner/one/a": landed("a"),
			"owner/one/b": landed("b"),
			"owner/two/c": landed("c"),
			"owner/two/d": landed("d"),
		});
	});

	it("labels a group by the groups the key names, not the whole manifest", async () => {
		arrangeBehind({
			"owner/repo/packs/x": skill("x"),
			"owner/repo/packs/y": skill("y"),
			"owner/repo/z": skill("z", { ref: "main" }),
		});

		await runUpdate("owner/repo/packs", {}, ui);

		expect(probedKeys()).toEqual([
			["owner/repo/packs/x", "owner/repo/packs/y"],
		]);
		// Bare owner/repo: the @ref the manifest's other group would need
		// stays off. Each skill moves to the key add gives it.
		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "x", "y")]],
				rows: [
					updated(
						"owner/repo",
						"HEAD",
						HASHES,
						["x", "skill · now keyed owner/repo/x"],
						["y", "skill · now keyed owner/repo/y"],
					),
				],
				// The rows say where each moved; machine mode alone hears the notes.
				notes: [
					{
						text: "",
						plain: "owner/repo/packs/x is now keyed owner/repo/x",
					},
					{
						text: "",
						plain: "owner/repo/packs/y is now keyed owner/repo/y",
					},
				],
				tally: closed({ updated: 2 }),
			}),
		);
	});

	it("reinstalls each local entry it names on its own, without probing or cloning", async () => {
		arrangeBehind({
			"/Users/lee/Code/a": localSkill("a"),
			"/Users/lee/Code/b": localSkill("b"),
		});
		mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);

		await runUpdate("/Users/lee/Code", {}, ui);

		expect(mockResolveGroupTarget).not.toHaveBeenCalled();
		expect(mockCloneSource).not.toHaveBeenCalled();
		expect(
			mockCopyBareSkill.mock.calls.map(([{ sourceDir }]) => sourceDir),
		).toEqual(["/Users/lee/Code/a", "/Users/lee/Code/b"]);
		expect(mockWriteManifest).toHaveBeenCalledTimes(2);
		expect(drawn()).toEqual(
			screen({
				subjects: [[local("/Users/lee/Code/a"), local("/Users/lee/Code/b")]],
				rows: [
					refreshed("/Users/lee/Code/a", "skill"),
					refreshed("/Users/lee/Code/b", "skill"),
				],
				tally: closed({ refreshed: 2 }),
			}),
		);
	});

	it("carries on past a group whose clone fails, then exits 1", async () => {
		const failing = skill("a");
		arrangeBehind({ "owner/one/a": failing, "owner/two/b": skill("b") });
		mockCloneSource
			.mockRejectedValueOnce(new Error("git clone failed"))
			.mockResolvedValueOnce({
				tempDir: "/tmp/agntc-clone",
				commit: REMOTE_SHA,
			});

		const err = await runUpdate("owner", {}, ui).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect((err as ExitSignal).code).toBe(1);
		expect(mockCloneSource).toHaveBeenCalledTimes(2);
		expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith("/fake/project", {
			"owner/one/a": failing,
			"owner/two/b": landed("b"),
		});
	});

	it("carries on past a group whose check fails, then exits 1 as a single key does", async () => {
		const unchecked = skill("a");
		arrangeBehind({ "owner/one/a": unchecked, "owner/two/b": skill("b") });
		mockResolveGroupTarget.mockImplementation(async ({ cloneUrl }) =>
			cloneUrl.includes("owner/one")
				? { kind: "check-failed", reason: "network timeout" }
				: { kind: "head", resolvedSha: REMOTE_SHA },
		);

		const err = await runUpdate("owner", {}, ui).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect((err as ExitSignal).code).toBe(1);
		expect(mockCloneSource).toHaveBeenCalledOnce();
		expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith("/fake/project", {
			"owner/one/a": unchecked,
			"owner/two/b": landed("b"),
		});
		expect(drawn()).toEqual(
			screen({
				subjects: [
					[group("owner/one", "HEAD", "a"), group("owner/two", "HEAD", "b")],
				],
				rows: [
					updated("owner/two", "HEAD", HASHES, ["b", "skill"]),
					notChecked("owner/one", "HEAD", "network timeout", "prefix"),
				],
				tally: closed({ updated: 1, notChecked: 1 }),
			}),
		);
	});

	it("prints one document carrying every entry it named", async () => {
		arrangeBehind({
			"owner/one/a": skill("a"),
			"owner/two/b": skill("b"),
			"other/repo": skill("other"),
		});
		mockResolveGroupTarget.mockImplementation(async ({ cloneUrl }) =>
			cloneUrl.includes("owner/one")
				? { kind: "check-failed", reason: "network timeout" }
				: { kind: "head", resolvedSha: REMOTE_SHA },
		);

		const run = await runMachine(updateCommand, ["owner"]);

		expect(run.exitCode).toBe(1);
		expect(run.document).toEqual({
			ok: false,
			command: "update",
			scope: "project",
			items: [
				{
					key: "owner/one/a",
					type: "skill",
					status: "check-failed",
					ref: null,
					commit: INSTALLED_SHA,
					constraint: null,
					reason: "network timeout",
				},
				{
					key: "owner/two/b",
					type: "skill",
					status: "updated",
					ref: null,
					commit: REMOTE_SHA,
					constraint: null,
					previousRef: null,
					previousCommit: INSTALLED_SHA,
				},
			],
			warnings: [],
			notes: [],
		});
		expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
	});

	describe("exits 1 on a dead remote however many entries the key names", () => {
		function arrangeDeadRemote(manifest: Manifest): void {
			arrangeBehind(manifest);
			mockCheckForUpdate.mockResolvedValue({
				status: "check-failed",
				reason: "network timeout",
			});
			mockResolveGroupTarget.mockResolvedValue({
				kind: "check-failed",
				reason: "network timeout",
			});
		}

		it("one entry", async () => {
			arrangeDeadRemote({ "owner/repo/a": skill("a") });

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toMatchObject({ ok: false });
		});

		it("two entries", async () => {
			arrangeDeadRemote({
				"owner/repo/a": skill("a"),
				"owner/repo/b": skill("b"),
			});

			const run = await runMachine(updateCommand, ["owner/repo"]);

			expect(run.exitCode).toBe(1);
			expect(run.document).toMatchObject({ ok: false });
			expect(mockCloneSource).not.toHaveBeenCalled();
		});

		it("but not without a key", async () => {
			arrangeDeadRemote({
				"owner/repo/a": skill("a"),
				"owner/repo/b": skill("b"),
			});

			const run = await runMachine(updateCommand, []);

			expect(run.exitCode).toBe(0);
			expect(run.document).toMatchObject({ ok: true });
		});
	});

	it("exits 1 when no tag satisfies a constraint the key's entries share", async () => {
		const constrained = { ref: "v1.0.0", constraint: "^1.0.0" };
		arrangeBehind({
			"owner/repo/a": skill("a", constrained),
			"owner/repo/b": skill("b", constrained),
		});
		mockResolveGroupTarget.mockResolvedValue({ kind: "constrained-no-match" });

		const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect((err as ExitSignal).code).toBe(1);
	});

	it("a key naming one entry by prefix keeps the single-key path", async () => {
		arrangeBehind({ "owner/repo/go": skill("go"), "other/repo": skill("x") });
		mockCheckForUpdate.mockResolvedValue({
			status: "update-available",
			remoteCommit: REMOTE_SHA,
		});

		await runUpdate("owner/repo", {}, ui);

		expect(mockResolveGroupTarget).not.toHaveBeenCalled();
		expect(mockCheckForUpdate).toHaveBeenCalledExactlyOnceWith(
			"owner/repo/go",
			expect.anything(),
		);
		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "go")]],
				rows: [updated("owner/repo", "HEAD", HASHES, ["go", "skill"])],
				tally: closed({ updated: 1 }),
			}),
		);
	});
});

describe("an entry gone upstream", () => {
	const GONE_KEY = "owner/repo/go";
	/** The row go's question is asked under. */
	const ASKED: Row = {
		status: "attention",
		subject: GONE_KEY,
		detail: { label: "gone upstream", aside: "skill" },
		fields: [{ label: ".claude/skills/", value: ["go"], noun: "folder" }],
	};
	const QUESTION = {
		message: "Remove it and its folder?",
		initialValue: false,
	};

	function goneEntry(): ManifestEntry {
		return makeEntry({
			type: "skill",
			commit: INSTALLED_SHA,
			files: [".claude/skills/go/"],
		});
	}

	function looseEntry(name: string): ManifestEntry {
		return makeEntry({
			type: "skill",
			commit: INSTALLED_SHA,
			files: [`.claude/skills/${name}/`],
		});
	}

	/** go's SKILL.md is gone from the source and nothing named go turns up anywhere. */
	function arrangeGone(manifest: Manifest = { [GONE_KEY]: goneEntry() }): void {
		mockReadManifestOrExit.mockResolvedValue(manifest);
		mockCheckForUpdate.mockResolvedValue({
			status: "update-available",
			remoteCommit: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockAccess.mockImplementation(async (path: unknown) => {
			if (typeof path === "string" && path.endsWith("/go/SKILL.md")) {
				throw new Error("ENOENT");
			}
			return undefined;
		});
		rewalkFinds("skills/other");
	}

	const KEPT_DETAIL = "kept — it's gone upstream; update will ask again";
	const REMOVED_DETAIL = "removed — it's gone upstream";

	/** The row of a group whose one member, go, was gone upstream and `ended` so: no move, as it made none. */
	function goneRow(ended: "kept" | "removed"): Row {
		return {
			status: ended === "kept" ? "attention" : "done",
			subject: "owner/repo",
			meta: "HEAD",
			detail: { label: ended },
			children: [
				{ name: "go", detail: ended === "kept" ? KEPT_DETAIL : REMOVED_DETAIL },
			],
		};
	}

	/** The row of a group whose a updated while go, gone upstream, was kept. */
	const KEPT_BESIDE_A: Row = {
		status: "attention",
		subject: "owner/repo",
		meta: "HEAD",
		detail: { move: HASHES },
		children: [
			{ name: "a", status: "done", detail: "skill" },
			{ name: "go", status: "attention", detail: KEPT_DETAIL },
		],
	};

	/** Asked while the group's own task spun, the terminal pausing it to ask. */
	function askedWhileSpinning(): void {
		const asked = ui.confirm.mock.invocationCallOrder[0]!;
		const updating = ui.blocks[0]!.tasks.at(-1)!;
		expect(updating.settle.mock.invocationCallOrder[0]).toBeGreaterThan(asked);
		expect(ui.blocks[0]!.task.mock.invocationCallOrder.at(-1)).toBeLessThan(
			asked,
		);
	}

	function recordOrder(): string[] {
		const order: string[] = [];
		mockNukeManifestFiles.mockImplementation(async () => {
			order.push("nuke");
			return { removed: [], skipped: [] };
		});
		mockWriteManifest.mockImplementation(async () => {
			order.push("write");
		});
		return order;
	}

	describe("for one key at a terminal", () => {
		it("asks whether to remove it, no by default", async () => {
			arrangeGone();
			ui.confirm.mockResolvedValue(false);

			await runUpdate(GONE_KEY, {}, ui);

			expect(ui.block).toHaveBeenLastCalledWith([ASKED]);
			expect(ui.blocks.at(-1)!.confirm).toHaveBeenCalledExactlyOnceWith(
				ASKED,
				QUESTION,
			);
			expect(ui.blocks.at(-1)!.row).not.toHaveBeenCalled();
		});

		it("keeps its files and entry on no, says update will ask again, and exits 0", async () => {
			arrangeGone();
			ui.confirm.mockResolvedValue(false);

			const err = await runUpdate(GONE_KEY, {}, ui).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "go")], [ASKED]],
					rows: [goneRow("kept")],
					tally: closed({ kept: 1 }),
				}),
			);
			askedWhileSpinning();
		});

		it("removes its files and then its entry on yes, and exits 0", async () => {
			const other = looseEntry("other");
			arrangeGone({ [GONE_KEY]: goneEntry(), "owner/other": other });
			ui.confirm.mockResolvedValue(true);
			const order = recordOrder();

			const err = await runUpdate(GONE_KEY, {}, ui).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/go/"],
			);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{ "owner/other": other },
			);
			expect(order).toEqual(["nuke", "write"]);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "go")], [ASKED]],
					rows: [goneRow("removed")],
					tally: closed({ removed: 1 }),
				}),
			);
		});

		it("removes it without asking under -y", async () => {
			arrangeGone();

			await runUpdate(GONE_KEY, { yes: true }, ui);

			expect(ui.confirm).not.toHaveBeenCalled();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});

		it("treats a local entry the same way, its folder standing in for the repo", async () => {
			const localKey = "/Users/lee/Code/go";
			const localEntry: ManifestEntry = {
				ref: null,
				commit: null,
				installedAt: "2026-02-01T00:00:00.000Z",
				files: [".claude/skills/go/"],
				cloneUrl: null,
				type: "skill",
			};
			mockReadManifestOrExit.mockResolvedValue({ [localKey]: localEntry });
			mockCheckForUpdate.mockResolvedValue({ status: "local" });
			mockStat.mockResolvedValue({ isDirectory: () => true } as Stats);
			mockAccess.mockRejectedValue(new Error("ENOENT"));
			rewalkFinds();
			ui.confirm.mockResolvedValue(true);

			const err = await runUpdate(localKey, {}, ui).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockDiscover).toHaveBeenCalledWith(localKey, { rootName: "go" });
			expect(ui.blocks.at(-1)!.confirm).toHaveBeenCalledExactlyOnceWith(
				{ ...ASKED, subject: localKey, meta: "local" },
				QUESTION,
			);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});
	});

	describe("in all-mode at a terminal", () => {
		it("asks while the group's task spins, its row settling with the answer", async () => {
			arrangeGone({ "owner/repo/a": looseEntry("a"), [GONE_KEY]: goneEntry() });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});
			ui.confirm.mockResolvedValue(false);

			await runUpdate(undefined, {}, ui);

			askedWhileSpinning();
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "go")], [ASKED]],
					rows: [KEPT_BESIDE_A],
					tally: closed({ updated: 1, kept: 1 }),
				}),
			);
		});

		it("asks a group of one under its task too", async () => {
			arrangeGone();
			ui.confirm.mockResolvedValue(false);

			await runUpdate(undefined, {}, ui);

			askedWhileSpinning();
			expect(drawn().rows).toEqual([goneRow("kept")]);
		});

		it("keeps it on no and exits 0 while its sibling updates", async () => {
			const entryA = looseEntry("a");
			const gone = goneEntry();
			arrangeGone({ "owner/repo/a": entryA, [GONE_KEY]: gone });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});
			ui.confirm.mockResolvedValue(false);

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).not.toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(written[GONE_KEY]).toEqual(gone);
			expect(written["owner/repo/a"]!.commit).toBe(REMOTE_SHA);
			expect(drawn().rows).toEqual([KEPT_BESIDE_A]);
		});

		it("removes its files and then its entry on yes", async () => {
			arrangeGone({ "owner/repo/a": looseEntry("a"), [GONE_KEY]: goneEntry() });
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});
			ui.confirm.mockResolvedValue(true);

			const err = await runUpdate(undefined, {}, ui).catch((e) => e);

			expect(err).toBeUndefined();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
			expect(Object.keys(written)).toEqual(["owner/repo/a"]);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "go")], [ASKED]],
					rows: [
						updated(
							"owner/repo",
							"HEAD",
							HASHES,
							["a", "skill"],
							["go", REMOVED_DETAIL],
						),
					],
					tally: closed({ updated: 1, removed: 1 }),
				}),
			);
		});

		it("removes it without asking under -y", async () => {
			arrangeGone();

			await runUpdate(undefined, { yes: true }, ui);

			expect(ui.confirm).not.toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenLastCalledWith("/fake/project", {});
		});
	});

	describe("for a key naming several", () => {
		it("removes it without asking under -y while its sibling updates from the same clone", async () => {
			const other = looseEntry("other");
			arrangeGone({
				"owner/repo/a": looseEntry("a"),
				[GONE_KEY]: goneEntry(),
				"other/repo": other,
			});
			mockCopyBareSkill.mockResolvedValue({
				copiedFiles: [".claude/skills/a/"],
			});

			const err = await runUpdate("owner/repo", { yes: true }, ui).catch(
				(e) => e,
			);

			expect(err).toBeUndefined();
			expect(ui.confirm).not.toHaveBeenCalled();
			expect(mockCloneSource).toHaveBeenCalledOnce();
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenLastCalledWith("/fake/project", {
				"owner/repo/a": expect.objectContaining({ commit: REMOTE_SHA }),
				"other/repo": other,
			});
			expect(drawn().rows).toEqual([
				updated(
					"owner/repo",
					"HEAD",
					HASHES,
					["a", "skill"],
					["go", REMOVED_DETAIL],
				),
			]);
		});
	});

	describe("without a terminal", () => {
		const KEPT = {
			key: GONE_KEY,
			type: "skill",
			status: "gone-kept",
			ref: null,
			commit: INSTALLED_SHA,
			constraint: null,
			message:
				"Kept owner/repo/go — it's gone upstream; npx agntc update owner/repo/go -y removes it",
			flags: ["-y"],
		};

		it("keeps it without -y, naming the flag that removes it, and exits 0", async () => {
			arrangeGone();

			const run = await runMachine(updateCommand, [GONE_KEY]);

			expect(run.exitCode).toBe(0);
			expect(run.document).toEqual({
				ok: true,
				command: "update",
				scope: "project",
				items: [KEPT],
				warnings: [],
				notes: [],
			});
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
			expect(run.stdout).toBe(`${JSON.stringify(run.document, null, 2)}\n`);
		});

		it("keeps it the same way in all-mode", async () => {
			arrangeGone();

			const run = await runMachine(updateCommand, []);

			expect(run.exitCode).toBe(0);
			expect(run.document).toMatchObject({ ok: true, items: [KEPT] });
			expect(mockNukeManifestFiles).not.toHaveBeenCalled();
			expect(mockWriteManifest).not.toHaveBeenCalled();
		});

		it.each([
			["one key", [GONE_KEY, "-y"]],
			["all-mode", ["--yes"]],
		])("removes it under -y (%s) and reports it removed", async (_mode, args) => {
			arrangeGone();

			const run = await runMachine(updateCommand, args);

			expect(run.exitCode).toBe(0);
			expect(run.document.items).toEqual([
				{
					key: GONE_KEY,
					type: "skill",
					status: "gone-removed",
					ref: null,
					commit: INSTALLED_SHA,
					constraint: null,
					message: "Removed owner/repo/go — it's gone upstream",
				},
			]);
			expect(mockNukeManifestFiles).toHaveBeenCalledWith("/fake/project", [
				".claude/skills/go/",
			]);
			expect(mockWriteManifest).toHaveBeenCalledWith("/fake/project", {});
		});
	});
});

describe("a pack taking over loose skills from its own source", () => {
	const PACK_KEY = "owner/repo/tools";
	const TOOLS: FoundPack = {
		name: "tools",
		path: "tools",
		skills: [
			{ name: "a", path: "tools/skills/a" },
			{ name: "b", path: "tools/skills/b" },
		],
		supportFolders: [],
		assetDirs: [],
	};
	const NOTE = "owner/repo/tools now includes a, installed on its own before";
	/** The note machine mode prints; at a terminal the skill's own line under the pack tells it. */
	const TOLD = machineOnly(NOTE);

	function packEntry(): ManifestEntry {
		return makeEntry({
			type: "pack",
			commit: INSTALLED_SHA,
			files: [".claude/skills/b/"],
		});
	}

	/** The Next item that clears the files in the pack's way, `-g ` given for a global run. */
	function replaceThem(global = ""): NextItem {
		return {
			subject: PACK_KEY,
			remedy: {
				lead: "Clear them and update again, or replace them:",
				steps: [
					{ command: `npx agntc remove ${global}${PACK_KEY}` },
					{ command: `npx agntc add ${global}${PACK_KEY} --pack --overwrite` },
				],
			},
		};
	}

	function looseA(overrides: Partial<ManifestEntry> = {}): ManifestEntry {
		return makeEntry({
			type: "skill",
			commit: INSTALLED_SHA,
			files: [".claude/skills/a/"],
			...overrides,
		});
	}

	/** The pack now holds a as well as b. */
	function arrangeTakeover(manifest: Manifest): void {
		mockReadManifestOrExit.mockResolvedValue(manifest);
		mockCheckForUpdate.mockResolvedValue({
			status: "update-available",
			remoteCommit: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockDiscover.mockResolvedValue(onlyPack(TOOLS));
		mockCopyPack.mockResolvedValue({
			copiedFiles: [".claude/skills/a/", ".claude/skills/b/"],
			assetCounts: { skills: 2 },
		});
	}

	it("all-mode updates the pack first, then skips the loose entry it took over in its group", async () => {
		arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });

		await runUpdate(undefined, {}, ui);

		expect(mockCloneSource).toHaveBeenCalledOnce();
		expect(mockCopyPack).toHaveBeenCalledOnce();
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
			"/fake/project",
			[".claude/skills/b/", ".claude/skills/a/"],
		);
		const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
		expect(Object.keys(written)).toEqual([PACK_KEY]);
		expect(written[PACK_KEY]!.files).toEqual([
			".claude/skills/a/",
			".claude/skills/b/",
		]);
		expect(ui.note).toHaveBeenCalledWith(TOLD);
	});

	it("all-mode skips a taken-over loose entry whose own group comes after the pack's", async () => {
		arrangeTakeover({
			[PACK_KEY]: packEntry(),
			"owner/repo/a": looseA({ ref: "main" }),
		});

		await runUpdate(undefined, {}, ui);

		// Two groups (head and main), but only the pack's ever clones.
		expect(mockCloneSource).toHaveBeenCalledOnce();
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		const written = mockWriteManifest.mock.calls.at(-1)![1] as Manifest;
		expect(Object.keys(written)).toEqual([PACK_KEY]);
		// The skill shows under the pack's row, where it went; its own group,
		// with nothing left to do, draws no row.
		expect(drawn()).toEqual(
			screen({
				subjects: [
					[
						group("owner/repo@HEAD", "HEAD", "tools"),
						group("owner/repo@main", "main", "a"),
					],
				],
				rows: [
					updated(
						"owner/repo@HEAD",
						"HEAD",
						HASHES,
						["tools", "pack · 2 skills"],
						["a", "is now part of the pack owner/repo/tools"],
					),
				],
				notes: [TOLD],
				tally: closed({ updated: 2 }),
			}),
		);
	});

	it("draws no row for a pinned loose entry a pack on HEAD took over from another group, telling it under the pack", async () => {
		arrangeTakeover({
			[PACK_KEY]: packEntry(),
			"owner/repo/a": looseA({ ref: "v1.0" }),
		});
		// The pin is up to date, so its group is only left alone: the pack's
		// takeover is all that keeps it from drawing a row of its own.
		mockResolveGroupTarget.mockImplementation(async (group) =>
			group.versionIntent === null
				? { kind: "head", resolvedSha: REMOTE_SHA }
				: { kind: "tag", tag: "v1.0", newerTags: [] },
		);

		await runUpdate(undefined, {}, ui);

		expect(drawn().rows).toEqual([
			updated(
				"owner/repo@HEAD",
				"HEAD",
				HASHES,
				["tools", "pack · 2 skills"],
				["a", "is now part of the pack owner/repo/tools"],
			),
		]);
		expect(drawn().tally).toEqual(closed({ updated: 2 }));
	});

	describe("when the loose entry's own group comes before the pack's", () => {
		function arrangeSkillGroupFirst(): void {
			arrangeTakeover({
				"owner/repo/a": looseA({ ref: "main" }),
				[PACK_KEY]: packEntry(),
			});
		}

		const ABSORBED = {
			key: "owner/repo/a",
			type: "skill",
			status: "absorbed",
			ref: "main",
			commit: INSTALLED_SHA,
			constraint: null,
			message: "owner/repo/a is now part of the pack owner/repo/tools",
		};

		it.each([
			["all-mode", []],
			["a key naming both", ["owner/repo"]],
		])("%s runs the pack first and never clones or copies the skill", async (_mode, args) => {
			arrangeSkillGroupFirst();

			const run = await runMachine(updateCommand, args);

			expect(run.exitCode).toBe(0);
			expect(mockCloneSource).toHaveBeenCalledOnce();
			expect(mockCopyPack).toHaveBeenCalledOnce();
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(mockWriteManifest).toHaveBeenLastCalledWith("/fake/project", {
				[PACK_KEY]: expect.objectContaining({ commit: REMOTE_SHA }),
			});
			// The document stays in manifest order.
			expect(run.document.items).toEqual([
				ABSORBED,
				expect.objectContaining({ key: PACK_KEY, status: "updated" }),
			]);
		});

		it("draws the pack's row, the skill under it, never a row of its own", async () => {
			arrangeSkillGroupFirst();

			await runUpdate("owner/repo", {}, ui);

			expect(drawn()).toEqual(
				screen({
					subjects: [
						[
							group("owner/repo@main", "main", "a"),
							group("owner/repo@HEAD", "HEAD", "tools"),
						],
					],
					rows: [
						updated(
							"owner/repo@HEAD",
							"HEAD",
							HASHES,
							["tools", "pack · 2 skills"],
							["a", "is now part of the pack owner/repo/tools"],
						),
					],
					notes: [TOLD],
					tally: closed({ updated: 2 }),
				}),
			);
		});
	});

	it("reports the loose entry as absorbed into the pack, with the pack's note", async () => {
		arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });

		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(0);
		expect(run.document.items).toEqual([
			{
				key: "owner/repo/a",
				type: "skill",
				status: "absorbed",
				ref: null,
				commit: INSTALLED_SHA,
				constraint: null,
				message: "owner/repo/a is now part of the pack owner/repo/tools",
			},
			expect.objectContaining({
				key: PACK_KEY,
				type: "pack",
				status: "updated",
			}),
		]);
		expect(run.document.notes).toEqual([NOTE]);
	});

	describe("when the pack's copy then fails", () => {
		const LOOSE_MESSAGE =
			"owner/repo/a was removed — the pack owner/repo/tools took it over, then failed to install";
		const PACK_MESSAGE =
			"Update failed for owner/repo/tools after removing old files (disk full), and the skill it took over was removed: owner/repo/a. It is currently uninstalled. Run `npx agntc add owner/repo/tools --pack` to install it again.";

		it("all-mode drops the loose entry with the pack's, since its files are gone", async () => {
			arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });
			mockCopyPack.mockRejectedValue(new Error("disk full"));

			const run = await runMachine(updateCommand, []);

			expect(run.exitCode).toBe(1);
			expect(mockNukeManifestFiles).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				[".claude/skills/b/", ".claude/skills/a/"],
			);
			expect(mockWriteManifest).toHaveBeenLastCalledWith("/fake/project", {});
			expect(mockCopyBareSkill).not.toHaveBeenCalled();
			expect(run.document.items).toEqual([
				{
					key: "owner/repo/a",
					type: "skill",
					status: "absorbed",
					ref: null,
					commit: INSTALLED_SHA,
					constraint: null,
					message: LOOSE_MESSAGE,
				},
				{
					key: PACK_KEY,
					type: "pack",
					status: "copy-failed",
					ref: null,
					commit: INSTALLED_SHA,
					constraint: null,
					message: PACK_MESSAGE,
				},
			]);
			expect(run.document.notes).toEqual([]);
		});

		it("a key naming both drops the loose entry with the pack's", async () => {
			arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });
			mockCopyPack.mockRejectedValue(new Error("disk full"));

			const err = await runUpdate("owner/repo", {}, ui).catch((e) => e);

			expect(err).toBeInstanceOf(ExitSignal);
			expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith(
				"/fake/project",
				{},
			);
			expect(drawn()).toEqual(
				screen({
					subjects: [[group("owner/repo", "HEAD", "a", "tools")]],
					rows: [
						{
							status: "failed",
							subject: "owner/repo",
							meta: "HEAD",
							detail: { move: HASHES, note: "failed" },
							children: [
								{
									name: "tools",
									status: "failed",
									detail:
										"update failed after removing old files (disk full), and the skill it took over was removed: owner/repo/a. It is currently uninstalled.",
								},
								{
									name: "a",
									status: "done",
									detail:
										"was removed — the pack owner/repo/tools took it over, then failed to install",
								},
							],
						},
					],
					next: [
						{
							subject: PACK_KEY,
							remedy: {
								lead: "To install it again:",
								steps: [{ command: "npx agntc add owner/repo/tools --pack" }],
							},
						},
					],
					tally: closed({ failed: 1, updated: 1 }),
				}),
			);
		});
	});

	it("a key naming both updates the pack and skips the loose entry", async () => {
		arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });

		await runUpdate("owner/repo", {}, ui);

		expect(mockCloneSource).toHaveBeenCalledOnce();
		expect(mockCopyPack).toHaveBeenCalledOnce();
		expect(mockCopyBareSkill).not.toHaveBeenCalled();
		expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith("/fake/project", {
			[PACK_KEY]: expect.objectContaining({ commit: REMOTE_SHA }),
		});
		expect(ui.note).toHaveBeenCalledWith(TOLD);
	});

	it("a key naming the pack alone draws the skill it took over under its row, as a group's row does", async () => {
		arrangeTakeover({ "owner/repo/a": looseA(), [PACK_KEY]: packEntry() });

		await runUpdate(PACK_KEY, {}, ui);

		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "tools")]],
				rows: [
					updated(
						"owner/repo",
						"HEAD",
						HASHES,
						["tools", "pack · 2 skills"],
						["a", "is now part of the pack owner/repo/tools"],
					),
				],
				notes: [TOLD],
				tally: closed({ updated: 2 }),
			}),
		);
	});

	it("aborts the pack, install intact, when its skills would land on another source's files", async () => {
		const other = looseA();
		arrangeTakeover({ [PACK_KEY]: packEntry(), "other/repo/a": other });
		mockResolveGroupTarget.mockImplementation(async ({ members: [first] }) =>
			first!.key === PACK_KEY
				? { kind: "head", resolvedSha: REMOTE_SHA }
				: { kind: "head", resolvedSha: INSTALLED_SHA },
		);

		const err = await runUpdate(undefined, {}, ui).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockCopyPack).not.toHaveBeenCalled();
		expect(mockWriteManifest).not.toHaveBeenCalled();
	});

	it("names the other entry and its files when it aborts", async () => {
		arrangeTakeover({ [PACK_KEY]: packEntry(), "other/repo/a": looseA() });

		await runUpdate(PACK_KEY, {}, ui).catch(() => {});

		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "tools")]],
				rows: [
					stopped("owner/repo", "HEAD", HASHES, "not updated", [
						"tools",
						"can't be updated: files of other/repo/a are in the way: .claude/skills/a/. The existing install is unchanged.",
					]),
				],
				next: [replaceThem()],
				tally: closed({ notUpdated: 1 }),
			}),
		);
	});

	it("aborts, install intact, when files agntc didn't install sit at a new skill's target", async () => {
		arrangeTakeover({ [PACK_KEY]: packEntry() });
		mockCheckUnmanaged.mockResolvedValue([".claude/skills/a/"]);

		const err = await runUpdate(PACK_KEY, {}, ui).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect(mockCheckUnmanaged).toHaveBeenCalledWith(
			[".claude/skills/a/", ".claude/skills/b/"],
			{ [PACK_KEY]: packEntry() },
			"/fake/project",
		);
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockCopyPack).not.toHaveBeenCalled();
		expect(mockWriteManifest).not.toHaveBeenCalled();
		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "tools")]],
				rows: [
					stopped("owner/repo", "HEAD", HASHES, "not updated", [
						"tools",
						"can't be updated: files agntc didn't install are in the way: .claude/skills/a/. The existing install is unchanged.",
					]),
				],
				next: [replaceThem()],
				tally: closed({ notUpdated: 1 }),
			}),
		);
	});

	it("checks and names the remedy in the global scope for a global entry", async () => {
		arrangeTakeover({ [PACK_KEY]: packEntry() });
		mockCheckUnmanaged.mockResolvedValue([".claude/skills/a/"]);

		await runUpdate(PACK_KEY, {}, ui, GLOBAL).catch(() => {});

		expect(mockReadManifestOrExit).toHaveBeenCalledWith(HOME, ui);
		expect(mockCheckUnmanaged).toHaveBeenCalledWith(
			[".claude/skills/a/", ".claude/skills/b/"],
			{ [PACK_KEY]: packEntry() },
			HOME,
		);
		expect(drawn().next).toEqual([replaceThem("-g ")]);
	});
});

describe("a pack that would remove folders still in its source", () => {
	const KEY = "owner/repo/tools";
	const TOOLS: FoundPack = {
		name: "tools",
		path: "tools",
		skills: [{ name: "a", path: "tools/skills/a" }],
		supportFolders: [],
		assetDirs: [],
	};
	const ENTRY = makeEntry({
		type: "pack",
		commit: INSTALLED_SHA,
		files: [
			".claude/skills/a/",
			".claude/skills/workflow-shared/",
			".claude/skills/workflow-gates/",
		],
	});
	const MESSAGE =
		"owner/repo/tools can't be updated: it would remove workflow-shared and workflow-gates, which are still in the source but would no longer be installed. The existing install is unchanged. To update it anyway: npx agntc remove owner/repo/tools then npx agntc add owner/repo/tools --pack";

	beforeEach(() => {
		mockReadManifestOrExit.mockResolvedValue({ [KEY]: ENTRY });
		mockCheckForUpdate.mockResolvedValue({
			status: "update-available",
			remoteCommit: REMOTE_SHA,
		});
		mockCloneSource.mockResolvedValue({
			tempDir: "/tmp/agntc-clone",
			commit: REMOTE_SHA,
		});
		mockDiscover.mockResolvedValue(onlyPack(TOOLS));
		mockDroppedButInSource.mockResolvedValue([
			"workflow-shared",
			"workflow-gates",
		]);
	});

	it("by key, asks the source about what the pack would no longer write, before removing anything", async () => {
		await runUpdate(KEY, {}, ui).catch(() => {});

		expect(mockDroppedButInSource).toHaveBeenCalledExactlyOnceWith(
			ENTRY.files,
			[".claude/skills/a/"],
			{ kind: "pack", pack: TOOLS },
			"/tmp/agntc-clone",
		);
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockCopyPack).not.toHaveBeenCalled();
	});

	it("by key, names them and how to update anyway, leaving the install as recorded", async () => {
		const err = await runUpdate(KEY, {}, ui).catch((e) => e);

		expect(err).toBeInstanceOf(ExitSignal);
		expect(drawn()).toEqual(
			screen({
				subjects: [[group("owner/repo", "HEAD", "tools")]],
				rows: [
					stopped("owner/repo", "HEAD", HASHES, "not updated", [
						"tools",
						"can't be updated: it would remove workflow-shared and workflow-gates, which are still in the source but would no longer be installed. The existing install is unchanged.",
					]),
				],
				next: [
					{
						subject: KEY,
						remedy: {
							lead: "To update it anyway:",
							steps: [
								{ command: `npx agntc remove ${KEY}` },
								{ command: `npx agntc add ${KEY} --pack` },
							],
						},
					},
				],
				tally: closed({ notUpdated: 1 }),
			}),
		);
		expect(mockWriteManifest).not.toHaveBeenCalled();
	});

	it("in all-mode, reports it aborted with the same message, exiting 1", async () => {
		const run = await runMachine(updateCommand, []);

		expect(run.exitCode).toBe(1);
		expect(run.document.items).toEqual([
			expect.objectContaining({
				key: KEY,
				status: "aborted",
				message: MESSAGE,
			}),
		]);
		expect(mockNukeManifestFiles).not.toHaveBeenCalled();
		expect(mockWriteManifest).not.toHaveBeenCalled();
	});
});

describe("a global update", () => {
	it("opens on the header and reads the global manifest", async () => {
		mockReadManifestOrExit.mockResolvedValue({});

		await runUpdate(undefined, {}, ui, GLOBAL);

		expect(ui.header).toHaveBeenCalledOnce();
		expect(mockReadManifestOrExit).toHaveBeenCalledWith(HOME, ui);
	});

	it("carries -g in a pinned key's upgrade command", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo": makeEntry({ ref: "v1.0" }),
		});
		mockCheckForUpdate.mockResolvedValue({
			status: "newer-tags",
			tags: ["v2.0", "v3.0"],
		});

		await runUpdate("owner/repo", {}, ui, GLOBAL);

		expect(drawn().next).toEqual([
			pinnedKey(
				"owner/repo",
				"v1.0",
				["v3.0", "v2.0"],
				"npx agntc add -g owner/repo@v3.0",
			),
		]);
	});

	it("carries -g in a key's out-of-constraint upgrade command", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo": makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.0.0",
			}),
		});
		mockCheckForUpdate.mockResolvedValue({
			status: "constrained-up-to-date",
			latestOverall: "v2.0.0",
		});

		await runUpdate("owner/repo", {}, ui, GLOBAL);

		expect(drawn().next).toEqual([
			upgrade("owner/repo", "v1.2.3", "v2.0.0", "npx agntc add -g owner/repo"),
		]);
	});

	it("carries -g on every line of a pinned group's upgrade commands", async () => {
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/a": makeEntry({ ref: "v1.0", commit: INSTALLED_SHA }),
			"owner/repo/tools": makeEntry({
				ref: "v1.0",
				commit: INSTALLED_SHA,
				type: "pack",
			}),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "tag",
			tag: "v1.0",
			newerTags: ["v3.0"],
		});

		await runUpdate(undefined, {}, ui, GLOBAL);

		expect(drawn().next).toEqual([
			{
				subject: "owner/repo",
				remedy: {
					lead: "Pinned to v1.0, newer tags available (latest: v3.0). To upgrade:",
					steps: [
						{ command: "npx agntc add -g owner/repo/a@v3.0" },
						{ command: "npx agntc add -g owner/repo/tools@v3.0 --pack" },
					],
				},
			},
		]);
	});

	it("carries -g in a constrained group's out-of-constraint upgrade command", async () => {
		const member = () =>
			makeEntry({
				ref: "v1.2.3",
				commit: INSTALLED_SHA,
				constraint: "^1.2.3",
			});
		mockReadManifestOrExit.mockResolvedValue({
			"owner/repo/a": member(),
			"owner/repo/b": member(),
		});
		mockResolveGroupTarget.mockResolvedValue({
			kind: "constrained",
			tag: "v1.2.3",
			commit: INSTALLED_SHA,
			latestOverall: "v2.0.0",
		});

		await runUpdate(undefined, {}, ui, GLOBAL);

		expect(drawn().next).toEqual([
			upgrade(
				"owner/repo",
				"v1.2.3",
				"v2.0.0",
				"npx agntc add -g owner/repo --skill a b",
			),
		]);
	});
});

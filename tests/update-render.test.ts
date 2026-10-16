import { describe, expect, it } from "vitest";
import type { ManifestEntry } from "../src/manifest.js";
import type { SubjectMessage } from "../src/message.js";
import type { Row } from "../src/terminal/types.js";
import {
	absorbedOutcome,
	type EntryGroup,
	failedOutcome,
	type PluginOutcome,
} from "../src/update-groups.js";
import {
	adviceItem,
	cloneFailedRow,
	groupLabel,
	groupSubject,
	intentMeta,
	leftAloneRow,
	localRow,
	newerTagsMessage,
	outcomeStatus,
	pinnedTagsMessage,
	reinstalledRow,
	remedyItem,
	updateTally,
} from "../src/update-render.js";
import { makeEntry } from "./helpers/factories.js";
import { SSH_REFUSAL } from "./helpers/git-mocks.js";

function makeGroup(
	memberKeys: string[],
	versionIntent: string | null,
): EntryGroup {
	return {
		cloneUrl: "https://github.com/owner/repo.git",
		versionIntent,
		constrained:
			typeof versionIntent === "string" && versionIntent.startsWith("^"),
		members: memberKeys.map((key) => ({ key, entry: makeEntry() })),
	};
}

describe("groupLabel", () => {
	it("returns the bare owner/repo label when the repo has a single group", () => {
		const group = makeGroup(["owner/repo"], "^1.2.3");

		expect(groupLabel(group, [group])).toBe("owner/repo");
	});

	it("disambiguates two groups of one repo with @<constraint> and @<tag> intent suffixes", () => {
		const caret = makeGroup(["owner/repo/a"], "^1.2.3");
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [caret, pin];

		expect(groupLabel(caret, groups)).toBe("owner/repo@^1.2.3");
		expect(groupLabel(pin, groups)).toBe("owner/repo@v2.0.0");
	});

	it("uses the @HEAD sentinel for a HEAD-tracked group (versionIntent===null) in a multi-group repo", () => {
		const head = makeGroup(["owner/repo/a"], null);
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [head, pin];

		expect(groupLabel(head, groups)).toBe("owner/repo@HEAD");
	});

	it("renders @main for a branch group and @v2.0.0 for an exact-pin group when the repo is multi-group", () => {
		const branch = makeGroup(["owner/repo/a"], "main");
		const pin = makeGroup(["owner/repo/b"], "v2.0.0");
		const groups = [branch, pin];

		expect(groupLabel(branch, groups)).toBe("owner/repo@main");
		expect(groupLabel(pin, groups)).toBe("owner/repo@v2.0.0");
	});

	it("derives the same repo label for a standalone (owner/repo) and a collection member (owner/repo/member)", () => {
		const standalone = makeGroup(["owner/repo"], "^1.2.3");
		const collection = makeGroup(["owner/repo/member"], "^1.2.3");

		expect(groupLabel(standalone, [standalone])).toBe("owner/repo");
		expect(groupLabel(collection, [collection])).toBe("owner/repo");
	});
});

describe("intentMeta", () => {
	it("is the constraint or ref a group tracks, HEAD when it tracks none", () => {
		expect(intentMeta("^1.2.3")).toBe("^1.2.3");
		expect(intentMeta("main")).toBe("main");
		expect(intentMeta(null)).toBe("HEAD");
	});
});

const HEAD = { subject: "owner/repo", meta: "^1.0.0" };
const MOVE = { from: "v1.0.0", to: "v1.1.0" };

function updated(
	key: string,
	fields: Partial<Extract<PluginOutcome, { status: "updated" }>> = {},
): PluginOutcome {
	return {
		status: "updated",
		key,
		summary: "",
		newEntry: makeEntry({ type: "skill" }),
		notes: [],
		absorbed: [],
		assetCounts: { skills: 1 },
		...fields,
	};
}

function packUpdated(key: string, entry?: Partial<ManifestEntry>) {
	return updated(key, {
		newEntry: makeEntry({ type: "pack", ...entry }),
		assetCounts: { skills: 2, folders: 1, agents: 1 },
	});
}

const STILL_IN_SOURCE: SubjectMessage = {
	subject: "owner/repo/macos",
	detail:
		"can't be updated: it would remove macos-hig. The existing install is unchanged.",
	text: "owner/repo/macos can't be updated: it would remove macos-hig. The existing install is unchanged.",
	remedy: {
		lead: "To update it anyway:",
		steps: [
			{ command: "npx agntc remove owner/repo/macos" },
			{ command: "npx agntc add owner/repo/macos --pack" },
		],
	},
	plain: "the machine sentence",
};

function aborted(key: string): PluginOutcome {
	return {
		status: "aborted",
		key,
		summary: STILL_IN_SOURCE.plain,
		message: { ...STILL_IN_SOURCE, subject: key },
	};
}

describe("how an outcome reads", () => {
	it.each<[PluginOutcome["status"], Row["status"]]>([
		["updated", "done"],
		["refreshed", "done"],
		["absorbed", "done"],
		["gone-removed", "done"],
		["up-to-date", "unchanged"],
		["newer-tags", "unchanged"],
		["check-failed", "attention"],
		["constrained-no-match", "attention"],
		["gone-kept", "attention"],
		["aborted", "failed"],
		["blocked", "failed"],
		["copy-failed", "failed"],
		["failed", "failed"],
	])("draws %s with the %s glyph", (status, glyph) => {
		expect(outcomeStatus({ status, key: "k" } as PluginOutcome)).toBe(glyph);
	});

	it("counts each outcome in its tally category: absorbed as updated, newer tags as up to date", () => {
		const outcomes = (
			[
				"updated",
				"absorbed",
				"refreshed",
				"up-to-date",
				"newer-tags",
				"check-failed",
				"constrained-no-match",
				"aborted",
				"blocked",
				"copy-failed",
				"failed",
				"failed",
				"gone-removed",
				"gone-kept",
			] as const
		).map((status) => ({ status, key: "k" }) as PluginOutcome);

		expect(updateTally(outcomes)).toEqual({
			updated: 2,
			refreshed: 1,
			upToDate: 2,
			notChecked: 2,
			notUpdated: 2,
			failed: 3,
			removed: 1,
			kept: 1,
		});
	});

	it("counts nothing for a run with no outcomes", () => {
		expect(updateTally([])).toEqual({});
	});
});

describe("a group the run reinstalled", () => {
	it("carries the shared move, its members hanging under it with their kind and counts", () => {
		expect(
			reinstalledRow(HEAD, { move: MOVE }, [
				{ outcome: packUpdated("owner/repo/laravel") },
				{ outcome: updated("owner/repo/nuxt") },
			]),
		).toEqual({
			status: "done",
			...HEAD,
			detail: { move: MOVE },
			children: [
				{ name: "laravel", detail: "pack · 2 skills, 1 folder, 1 agent" },
				{ name: "nuxt", detail: "skill" },
			],
		});
	});

	it("words a pack's skills even when it has none, and one counted nothing as a pack", () => {
		const row = reinstalledRow(HEAD, { move: MOVE }, [
			{
				outcome: updated("owner/repo/kit", {
					newEntry: makeEntry({ type: "pack" }),
					assetCounts: { agents: 1 },
				}),
			},
			{
				outcome: updated("owner/repo/bare", {
					newEntry: makeEntry({ type: "pack" }),
					assetCounts: undefined,
				}),
			},
		]);

		expect(row.children).toEqual([
			{ name: "kit", detail: "pack · 0 skills, 1 agent" },
			{ name: "bare", detail: "pack · 0 skills" },
		]);
	});

	it("names a member that moved by the key it moved to, and says so", () => {
		const row = reinstalledRow(HEAD, { move: MOVE }, [
			{
				outcome: updated("owner/repo/foo", { previousKey: "owner/repo" }),
			},
		]);

		expect(row.children).toEqual([
			{ name: "foo", detail: "skill · now keyed owner/repo/foo" },
		]);
	});

	it("counts the files a single key's reinstall copied", () => {
		const row = reinstalledRow(HEAD, { move: MOVE }, [
			{ outcome: updated("owner/repo"), files: 3 },
		]);

		expect(row.children).toEqual([{ name: "repo", detail: "skill · 3 files" }]);
	});

	it("says where its members landed when they started apart, each carrying its own move", () => {
		const row = reinstalledRow(HEAD, { to: "v1.3.0" }, [
			{
				outcome: updated("owner/repo/a"),
				move: { from: "v1.2.0", to: "v1.3.0" },
			},
			{
				outcome: updated("owner/repo/b"),
				move: { from: "v1.1.0", to: "v1.3.0" },
			},
		]);

		expect(row.detail).toEqual({ label: "updated to v1.3.0" });
		expect(row.children).toEqual([
			{ name: "a", detail: "v1.2.0 → v1.3.0 · skill" },
			{ name: "b", detail: "v1.1.0 → v1.3.0 · skill" },
		]);
	});

	it("says how it ended beside the move when no member landed, each member's reason as its detail", () => {
		expect(
			reinstalledRow(HEAD, { move: MOVE }, [
				{ outcome: aborted("owner/repo/macos") },
			]),
		).toEqual({
			status: "failed",
			...HEAD,
			detail: { move: MOVE, note: "not updated" },
			children: [{ name: "macos", detail: STILL_IN_SOURCE.detail }],
		});
	});

	it("says how it ended alone when its members started apart and none landed", () => {
		const row = reinstalledRow(HEAD, { to: "v1.3.0" }, [
			{ outcome: failedOutcome("owner/repo/a", "boom") },
		]);

		expect(row.detail).toEqual({ label: "failed" });
		expect(row.children).toEqual([{ name: "a", detail: "boom" }]);
	});

	it("gives members that ended apart their own glyphs, the row the worst of them", () => {
		const row = reinstalledRow(HEAD, { move: MOVE }, [
			{ outcome: updated("owner/repo/a") },
			{ outcome: aborted("owner/repo/b") },
			{ outcome: { status: "up-to-date", key: "owner/repo/c" } },
		]);

		expect(row.status).toBe("failed");
		expect(row.detail).toEqual({ move: MOVE });
		expect(row.children).toEqual([
			{ name: "a", status: "done", detail: "skill" },
			{ name: "b", status: "failed", detail: STILL_IN_SOURCE.detail },
			{ name: "c", status: "unchanged", detail: "up to date" },
		]);
	});

	it("reads a member a needs-a-look outcome left as worse than one that landed", () => {
		const row = reinstalledRow(HEAD, { move: MOVE }, [
			{ outcome: updated("owner/repo/a") },
			{
				outcome: {
					status: "gone-kept",
					key: "owner/repo/b",
					summary:
						"Kept owner/repo/b — it's gone upstream; update will ask again",
				},
			},
		]);

		expect(row.status).toBe("attention");
		expect(row.children?.[1]).toEqual({
			name: "b",
			status: "attention",
			detail: "Kept owner/repo/b — it's gone upstream; update will ask again",
		});
	});

	it("tells a member a pack in its group took over by what became of it", () => {
		const pack = packUpdated("owner/repo/tools");
		const row = reinstalledRow(HEAD, { move: MOVE }, [
			{ outcome: pack },
			{ outcome: absorbedOutcome("owner/repo/loose", pack) },
		]);

		expect(row.children).toEqual([
			{ name: "tools", detail: "pack · 2 skills, 1 folder, 1 agent" },
			{ name: "loose", detail: "is now part of the pack owner/repo/tools" },
		]);
	});
});

describe("a local entry's row", () => {
	const LOCAL = { subject: "~/Code/skills/foo", meta: "local" };

	it("says it refreshed, with its kind and the files it copied", () => {
		expect(
			localRow(LOCAL, {
				outcome: {
					status: "refreshed",
					key: "/home/lee/Code/skills/foo",
					summary: "",
					newEntry: makeEntry({ ref: null, commit: null, type: "skill" }),
					notes: [],
					absorbed: [],
					assetCounts: { skills: 1 },
				},
				files: 2,
			}),
		).toEqual({
			status: "done",
			...LOCAL,
			detail: { label: "refreshed", aside: "skill · 2 files" },
		});
	});

	it("gives a failure's reason as its detail", () => {
		expect(
			localRow(LOCAL, {
				outcome: failedOutcome("/home/lee/Code/skills/foo", "path not found"),
			}),
		).toEqual({ status: "failed", ...LOCAL, detail: "path not found" });
	});
});

describe("a group whose clone failed", () => {
	it("names the failure with git's whole reason, and every member it took down", () => {
		expect(
			cloneFailedRow(HEAD, "git clone failed: fatal: not found", [
				"owner/repo/a",
				"owner/repo/b",
			]),
		).toEqual({
			status: "failed",
			...HEAD,
			detail: {
				label: "clone failed",
				aside: "git clone failed: fatal: not found",
			},
			children: [{ name: "a" }, { name: "b" }],
		});
	});
});

describe("a group the run left alone", () => {
	it("is up to date, dim", () => {
		expect(leftAloneRow(HEAD, { status: "up-to-date" })).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "up to date",
		});
	});

	it("is up to date with newer tags out", () => {
		expect(leftAloneRow(HEAD, { status: "newer-tags" })).toEqual({
			status: "unchanged",
			...HEAD,
			detail: "newer tags available",
		});
	});

	it("couldn't be checked, the cause the first line of git's error that names it", () => {
		expect(
			leftAloneRow(HEAD, { status: "check-failed", reason: SSH_REFUSAL }),
		).toEqual({
			status: "attention",
			...HEAD,
			detail: {
				label: "not checked",
				aside: "git@github.com: Permission denied (publickey).",
			},
		});
	});

	it("has no tag satisfying its constraint", () => {
		expect(
			leftAloneRow(HEAD, {
				status: "constrained-no-match",
				constraint: "^9.0.0",
			}),
		).toEqual({
			status: "attention",
			...HEAD,
			detail: { label: "no tags satisfy ^9.0.0" },
		});
	});
});

describe("a group's block subject", () => {
	it("measures each member as a child with a glyph's room, whichever way it ends", () => {
		expect(groupSubject(HEAD, ["owner/repo/a", "owner/repo/b"])).toEqual({
			...HEAD,
			children: [
				{ name: "a", status: "done" },
				{ name: "b", status: "done" },
			],
		});
	});
});

describe("Next items", () => {
	it("puts a message's remedy under its subject, the row having said what happened", () => {
		expect(remedyItem(STILL_IN_SOURCE)).toEqual({
			subject: "owner/repo/macos",
			remedy: STILL_IN_SOURCE.remedy,
		});
	});

	it("queues nothing for a message with no remedy", () => {
		const { remedy: _, ...told } = STILL_IN_SOURCE;
		expect(remedyItem(told)).toBeNull();
	});

	it("leads an advice's remedy with what it says, the row having said less", () => {
		expect(
			adviceItem(
				newerTagsMessage("owner/repo", "v1.0.0", "v1.2.0", [
					"npx agntc add owner/repo@v1.2.0",
				]),
			),
		).toEqual({
			subject: "owner/repo",
			remedy: {
				lead: "Pinned to v1.0.0 — newer tags available (latest: v1.2.0). To upgrade:",
				steps: [{ command: "npx agntc add owner/repo@v1.2.0" }],
			},
		});
	});
});

describe("newerTagsMessage", () => {
	it("words a pinned group's newer tags and the one member's re-add, inline in its sentence", () => {
		expect(
			newerTagsMessage("owner/repo", "v1.0.0", "v1.2.0", [
				"npx agntc add owner/repo@v1.2.0",
			]),
		).toEqual({
			subject: "owner/repo",
			detail: "Pinned to v1.0.0 — newer tags available (latest: v1.2.0).",
			text: "owner/repo: Pinned to v1.0.0 — newer tags available (latest: v1.2.0).",
			remedy: {
				lead: "To upgrade:",
				steps: [{ command: "npx agntc add owner/repo@v1.2.0" }],
			},
			plain:
				"owner/repo: Pinned to v1.0.0 — newer tags available (latest: v1.2.0). To upgrade: npx agntc add owner/repo@v1.2.0",
		});
	});

	it("keeps the @intent display label out of the commands, and sets several commands a line each", () => {
		const message = newerTagsMessage("owner/repo@v1.0.0", "v1.0.0", "v1.2.0", [
			"npx agntc add owner/repo/a@v1.2.0",
			"npx agntc add owner/repo/tools@v1.2.0 --pack",
		]);

		expect(message.remedy.steps).toEqual([
			{ command: "npx agntc add owner/repo/a@v1.2.0" },
			{ command: "npx agntc add owner/repo/tools@v1.2.0 --pack" },
		]);
		expect(message.plain).toBe(
			[
				"owner/repo@v1.0.0: Pinned to v1.0.0 — newer tags available (latest: v1.2.0). To upgrade:",
				"    npx agntc add owner/repo/a@v1.2.0",
				"    npx agntc add owner/repo/tools@v1.2.0 --pack",
			].join("\n"),
		);
	});
});

describe("pinnedTagsMessage", () => {
	it("lists one key's newer tags newest first, and the re-add that pins the newest", () => {
		expect(
			pinnedTagsMessage(
				"owner/repo",
				"v1.0.0",
				["v1.1.0", "v1.2.0"],
				"npx agntc add owner/repo@v1.2.0",
			),
		).toEqual({
			subject: "owner/repo",
			detail: "Pinned to v1.0.0. Newer tags available: v1.2.0, v1.1.0.",
			text: "Pinned to v1.0.0. Newer tags available: v1.2.0, v1.1.0.",
			remedy: {
				lead: "To upgrade:",
				steps: [{ command: "npx agntc add owner/repo@v1.2.0" }],
			},
			plain: [
				"Pinned to v1.0.0. Newer tags available:",
				"  v1.2.0",
				"  v1.1.0",
				"To upgrade: npx agntc add owner/repo@v1.2.0",
			].join("\n"),
		});
	});
});

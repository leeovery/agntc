import { describe, expect, it } from "vitest";
import { listBody, removeBody, updateBody } from "../src/documents.js";
import type { Manifest } from "../src/manifest.js";
import type { UpdateCheckResult } from "../src/update-check.js";
import type { PluginOutcome } from "../src/update-groups.js";
import { makeEntry } from "./helpers/factories.js";

const OLD = "a".repeat(40);
const NEW = "b".repeat(40);

const before: Manifest = {
	"owner/repo": makeEntry({
		ref: "v1.0.0",
		commit: OLD,
		constraint: "^1.0.0",
		type: "pack",
	}),
};

describe("updateBody", () => {
	it("carries the failure's message for each status that failed", () => {
		for (const status of [
			"failed",
			"copy-failed",
			"aborted",
			"blocked",
		] as const) {
			const outcome: PluginOutcome = {
				status,
				key: "owner/repo",
				summary: `owner/repo: ${status}`,
			};

			expect(updateBody(before, [outcome], new Map()).items).toEqual([
				{
					key: "owner/repo",
					type: "pack",
					status,
					ref: "v1.0.0",
					commit: OLD,
					constraint: "^1.0.0",
					message: `owner/repo: ${status}`,
				},
			]);
		}
	});

	it("reports an entry gone upstream and kept with its message and the flags that would remove it", () => {
		const outcome: PluginOutcome = {
			status: "gone-kept",
			key: "owner/repo",
			summary: "Kept owner/repo — it's gone upstream; -y removes it",
			flags: ["-y"],
		};

		expect(updateBody(before, [outcome], new Map()).items).toEqual([
			{
				key: "owner/repo",
				type: "pack",
				status: "gone-kept",
				ref: "v1.0.0",
				commit: OLD,
				constraint: "^1.0.0",
				message: "Kept owner/repo — it's gone upstream; -y removes it",
				flags: ["-y"],
			},
		]);
	});

	it("names no flags for an entry kept by answering no", () => {
		const outcome: PluginOutcome = {
			status: "gone-kept",
			key: "owner/repo",
			summary: "Kept owner/repo — it's gone upstream; update will ask again",
		};

		expect(
			updateBody(before, [outcome], new Map()).items[0],
		).not.toHaveProperty("flags");
	});

	it("reports an entry removed as gone, or absorbed into a pack, at its old entry with its message", () => {
		const outcomes: PluginOutcome[] = [
			{
				status: "gone-removed",
				key: "owner/repo",
				summary: "Removed owner/repo — it's gone upstream",
			},
			{
				status: "absorbed",
				key: "owner/repo",
				into: "owner/repo/tools",
				summary: "owner/repo is now part of the pack owner/repo/tools",
			},
		];

		expect(updateBody(before, outcomes, new Map()).items).toEqual([
			expect.objectContaining({
				status: "gone-removed",
				ref: "v1.0.0",
				commit: OLD,
				message: "Removed owner/repo — it's gone upstream",
			}),
			expect.objectContaining({
				status: "absorbed",
				ref: "v1.0.0",
				commit: OLD,
				message: "owner/repo is now part of the pack owner/repo/tools",
			}),
		]);
	});

	it("reports a refreshed local entry at its new entry, with no move", () => {
		const outcome: PluginOutcome = {
			status: "refreshed",
			key: "/local/path",
			summary: "/local/path: Refreshed from local path",
			newEntry: makeEntry({ ref: null, commit: null, type: "skill" }),
		};
		const local: Manifest = {
			"/local/path": makeEntry({ ref: null, commit: null, type: "skill" }),
		};

		expect(updateBody(local, [outcome], new Map()).items).toEqual([
			{
				key: "/local/path",
				type: "skill",
				status: "refreshed",
				ref: null,
				commit: null,
				constraint: null,
			},
		]);
	});

	it("takes the type an update landed on", () => {
		const outcome: PluginOutcome = {
			status: "updated",
			key: "owner/repo",
			summary: "",
			newEntry: makeEntry({ ref: "v1.1.0", commit: NEW, type: "skill" }),
		};

		expect(updateBody(before, [outcome], new Map()).items[0]).toMatchObject({
			type: "skill",
			ref: "v1.1.0",
			commit: NEW,
			previousRef: "v1.0.0",
			previousCommit: OLD,
		});
	});

	it("names nothing newer when the constraint holds the latest", () => {
		const check: UpdateCheckResult = {
			status: "constrained-up-to-date",
			latestOverall: null,
		};

		const [item] = updateBody(
			before,
			[{ status: "up-to-date", key: "owner/repo" }],
			new Map([["owner/repo", check]]),
		).items;

		expect(item).not.toHaveProperty("latestOutsideConstraint");
	});
});

describe("listBody", () => {
	it("reads an entry with no check result as a failed check", () => {
		expect(listBody(before, new Map()).entries[0]).toMatchObject({
			status: "check-failed",
			reason: "unknown",
		});
	});

	it("offers the HEAD commit a branch-less entry would update to", () => {
		const head: Manifest = {
			"owner/repo": makeEntry({ ref: null, commit: OLD }),
		};
		const checks = new Map<string, UpdateCheckResult>([
			["owner/repo", { status: "update-available", remoteCommit: NEW }],
		]);

		expect(listBody(head, checks).entries[0]).toMatchObject({
			availableRef: null,
			availableCommit: NEW,
		});
	});
});

describe("removeBody", () => {
	it("describes each removed entry with the files it deleted", () => {
		expect(removeBody(["owner/repo"], before)).toEqual({
			removed: [
				{
					key: "owner/repo",
					type: "pack",
					ref: "v1.0.0",
					commit: OLD,
					constraint: "^1.0.0",
					files: [".claude/skills/my-skill/"],
				},
			],
		});
	});
});

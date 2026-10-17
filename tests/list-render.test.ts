import { describe, expect, it } from "vitest";
import {
	checkingEntries,
	checkingEntry,
	counted,
	dashboardFooter,
	dashboardOptions,
	detailRow,
	type EntryDetail,
	getStartedItem,
	nothingInstalledRow,
	reinstallResult,
	statusCell,
	versionUnchangedRow,
} from "../src/list-render.js";
import type { ManifestEntry } from "../src/manifest.js";
import type { Status } from "../src/terminal/types.js";
import type { UpdateCheckResult } from "../src/update-check.js";
import type { PluginOutcome } from "../src/update-groups.js";
import { makeEntry } from "./helpers/factories.js";
import { SSH_REFUSAL } from "./helpers/git-mocks.js";

const HOME = "/home/me";
const NEW = "b".repeat(40);

describe("the empty manifest", () => {
	it("is one row with nothing to do", () => {
		expect(nothingInstalledRow()).toEqual({
			status: "unchanged",
			subject: "No skills or packs installed.",
		});
	});

	it("gets started with the add, on a line of its own, in the scope's own form", () => {
		expect(getStartedItem("global")).toEqual({
			subject: "",
			remedy: {
				lead: "To get started:",
				steps: [{ command: "npx agntc add -g owner/repo" }],
			},
		});
	});
});

describe("what a check's progress says", () => {
	it("counts the entries the dashboard checks", () => {
		expect(checkingEntries(1)).toBe("checking 1 entry for updates…");
		expect(checkingEntries(6)).toBe("checking 6 entries for updates…");
	});

	it("names the one entry the detail view checks again, a local one shortened against home", () => {
		expect(checkingEntry("owner/repo/a", HOME)).toBe(
			"checking owner/repo/a for updates…",
		);
		expect(checkingEntry(`${HOME}/skills/a`, HOME)).toBe(
			"checking ~/skills/a for updates…",
		);
	});
});

describe("dashboardOptions", () => {
	const local = makeEntry({
		commit: null,
		ref: null,
		localRoot: `${HOME}/skills`,
	});

	it("heads each source, in the order the manifest first names it, its entries beneath in manifest order", () => {
		const options = dashboardOptions(
			{
				"owner/one/a": makeEntry(),
				[`${HOME}/skills/mine`]: local,
				"owner/two": makeEntry(),
				"owner/one/b": makeEntry(),
				[`${HOME}/skills/yours`]: local,
			},
			new Map(),
			HOME,
		);

		expect(
			options.map((option) =>
				"heading" in option ? `# ${option.heading}` : option.value,
			),
		).toEqual([
			"# owner/one",
			"owner/one/a",
			"owner/one/b",
			"# ~/skills",
			`${HOME}/skills/mine`,
			`${HOME}/skills/yours`,
			"# owner/two",
			"owner/two",
		]);
	});

	it("names each entry by its key's path under its source, so packs named alike read apart", () => {
		const options = dashboardOptions(
			{
				"owner/repo/a/np": makeEntry(),
				"owner/repo/b/np": makeEntry(),
				"owner/repo/deep": makeEntry(),
				[`${HOME}/skills/mine`]: local,
			},
			new Map(),
			HOME,
		);

		expect(
			options.flatMap((option) => ("label" in option ? [option.label] : [])),
		).toEqual(["a/np", "b/np", "deep", "mine"]);
	});

	it("names an entry at its source's root by its name", () => {
		const [, choice] = dashboardOptions(
			{ "owner/repo": makeEntry() },
			new Map(),
			HOME,
		);

		expect(choice).toMatchObject({ value: "owner/repo", label: "repo" });
	});

	it("lines up its kind dim, its ref with its constraint dim, and its status", () => {
		const [, choice] = dashboardOptions(
			{
				"owner/repo/laravel": makeEntry({
					type: "pack",
					ref: "v0.2.4",
					constraint: "^0.2.4",
				}),
			},
			new Map([
				[
					"owner/repo/laravel",
					{
						status: "constrained-update-available",
						tag: "v0.2.5",
						commit: NEW,
						latestOverall: null,
					},
				],
			]),
			HOME,
		);

		expect(choice).toEqual({
			value: "owner/repo/laravel",
			label: "laravel",
			cells: [
				{ text: "pack", dim: true, drop: 1 },
				{ text: "v0.2.4", aside: "^0.2.4", drop: 2 },
				{ status: "newer", text: "v0.2.5" },
			],
		});
	});

	it("reads an untyped entry as a skill, a HEAD ref as such, a local entry with no ref as its status says it, and a missing check as failed", () => {
		const options = dashboardOptions(
			{ "owner/head": makeEntry(), [`${HOME}/skills/mine`]: local },
			new Map(),
			HOME,
		);
		const cells = options.flatMap((option) =>
			"cells" in option ? [option.cells] : [],
		);

		expect(cells).toEqual([
			[
				{ text: "skill", dim: true, drop: 1 },
				{ text: "HEAD", drop: 2 },
				{ status: "failed", text: "check failed" },
			],
			[
				{ text: "skill", dim: true, drop: 1 },
				{ text: "", drop: 2 },
				{ status: "failed", text: "check failed" },
			],
		]);
	});
});

describe("statusCell", () => {
	const entry = makeEntry({ ref: "main" });
	it.each<[string, UpdateCheckResult, ReturnType<typeof statusCell>]>([
		[
			"up to date, dim",
			{ status: "up-to-date" },
			{ status: "done", text: "up to date", dim: true },
		],
		[
			"constrained and up to date, dim",
			{ status: "constrained-up-to-date", latestOverall: "v9.0.0" },
			{ status: "done", text: "up to date", dim: true },
		],
		[
			"a newer commit, by its short hash when the ref isn't a tag",
			{ status: "update-available", remoteCommit: NEW },
			{ status: "newer", text: "bbbbbbb" },
		],
		[
			"a newer tag in range, not the newest outside it",
			{
				status: "constrained-update-available",
				tag: "v1.2.0",
				commit: NEW,
				latestOverall: "v2.0.0",
			},
			{ status: "newer", text: "v1.2.0" },
		],
		[
			"newer tags past a pin, needing a look",
			{ status: "newer-tags", tags: ["v2.0.0"] },
			{ status: "attention", text: "newer tags" },
		],
		[
			"a failed check",
			{ status: "check-failed", reason: "offline" },
			{ status: "failed", text: "check failed" },
		],
		[
			"no tag in range, as failed",
			{ status: "constrained-no-match" },
			{ status: "failed", text: "no matching version" },
		],
		[
			"local, dim",
			{ status: "local" },
			{ status: "local", text: "local", dim: true },
		],
	])("reads %s", (_, check, cell) => {
		expect(statusCell(entry, check)).toEqual(cell);
	});
});

describe("dashboardFooter", () => {
	it("says what manage and done are, and counts what wants something, each in its status's colour", () => {
		const footer = dashboardFooter(
			new Map<string, UpdateCheckResult>([
				["a", { status: "update-available", remoteCommit: NEW }],
				[
					"b",
					{
						status: "constrained-update-available",
						tag: "v1.0.1",
						commit: NEW,
						latestOverall: null,
					},
				],
				["c", { status: "newer-tags", tags: ["v2.0.0"] }],
				["d", { status: "check-failed", reason: "offline" }],
				["e", { status: "check-failed", reason: "offline" }],
				["f", { status: "constrained-no-match" }],
				["g", { status: "up-to-date" }],
				["h", { status: "local" }],
			]),
		);

		expect(footer).toEqual({
			keys: ["⏎ manage", "esc done"],
			counts: [
				{ count: 2, label: "updates", status: "newer" },
				{ count: 1, label: "with newer tags", status: "attention" },
				{ count: 2, label: "checks failed", status: "failed" },
				{ count: 1, label: "with no match", status: "failed" },
			],
		});
	});

	it("words one update and one failed check in the singular", () => {
		const { counts } = dashboardFooter(
			new Map<string, UpdateCheckResult>([
				["a", { status: "update-available", remoteCommit: NEW }],
				["b", { status: "check-failed", reason: "offline" }],
			]),
		);

		expect(counts?.map(({ count, label }) => `${count} ${label}`)).toEqual([
			"1 update",
			"0 with newer tags",
			"1 check failed",
			"0 with no match",
		]);
	});
});

describe("detailRow", () => {
	function detail(
		entry: Partial<ManifestEntry> = {},
		check: UpdateCheckResult = { status: "up-to-date" },
		assets = "1 skill",
	): EntryDetail {
		return { subject: "owner/repo", entry: makeEntry(entry), check, assets };
	}

	it("asks about the entry, its kind beside it, then its version, commit, install date, what it installs and its status", () => {
		expect(
			detailRow(detail({ ref: "v1.0.0", type: "pack" }, undefined, "2 skills")),
		).toEqual({
			status: "subject",
			subject: "owner/repo",
			detail: "pack",
			fields: [
				{ label: "version", value: "v1.0.0" },
				{ label: "commit", value: "aaaaaaa" },
				{ label: "installed", value: "2026-02-01" },
				{ label: "installs", value: "2 skills" },
				{ label: "status", value: "up to date", status: "unchanged" },
			],
		});
	});

	it("reads an untyped entry as a skill", () => {
		expect(detailRow(detail()).detail).toBe("skill");
	});

	it.each([
		[{ ref: "main" }, "main"],
		[{ ref: null }, "HEAD"],
		[{ ref: null, commit: null }, "local"],
	])("gives the version as its ref, HEAD or local (%o)", (entry, version) => {
		expect(detailRow(detail(entry)).fields?.[0]).toEqual({
			label: "version",
			value: version,
		});
	});

	it("gives a local entry's commit as a dash and no status, its version saying it's local", () => {
		const { fields } = detailRow(
			detail({ ref: null, commit: null }, { status: "local" }),
		);

		expect(fields).toContainEqual({ label: "commit", value: "—" });
		expect(fields?.map(({ label }) => label)).not.toContain("status");
	});

	it("gives the constraint, with the newest version outside it when there is one", () => {
		const fields = (check: UpdateCheckResult) =>
			detailRow(detail({ ref: "v1.2.0", constraint: "^1.0.0" }, check)).fields;

		expect(
			fields({ status: "constrained-up-to-date", latestOverall: "v2.0.0" }),
		).toContainEqual({
			label: "constraint",
			value: "^1.0.0 (v2.0.0 available outside constraint)",
		});
		expect(
			fields({
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: NEW,
				latestOverall: null,
			}),
		).toContainEqual({ label: "constraint", value: "^1.0.0" });
	});

	it("leaves out the constraint without one, and what it installs when it records nothing", () => {
		const labels = detailRow(detail({}, undefined, "")).fields?.map(
			({ label }) => label,
		);

		expect(labels).toEqual(["version", "commit", "installed", "status"]);
	});

	it("says why a check failed, in one line, failed as the dashboard has it", () => {
		expect(
			detailRow(
				detail({}, { status: "check-failed", reason: SSH_REFUSAL }),
			).fields?.at(-1),
		).toEqual({
			label: "status",
			value:
				"couldn't check for updates (git@github.com: Permission denied (publickey).)",
			status: "failed",
		});
	});

	it("names the constraint no tag satisfies, as failed", () => {
		expect(
			detailRow(
				detail({ constraint: "^1.0.0" }, { status: "constrained-no-match" }),
			).fields?.at(-1),
		).toEqual({
			label: "status",
			value: 'no matching version found for constraint "^1.0.0"',
			status: "failed",
		});
	});

	it.each<[UpdateCheckResult, string, Status]>([
		[
			{ status: "update-available", remoteCommit: NEW },
			"bbbbbbb available",
			"newer",
		],
		[
			{
				status: "constrained-update-available",
				tag: "v1.3.0",
				commit: NEW,
				latestOverall: null,
			},
			"v1.3.0 available",
			"newer",
		],
		[
			{ status: "newer-tags", tags: ["v2.0.0"] },
			"newer tags available",
			"attention",
		],
	])("says what its check found, in the dashboard's colour for it (%o)", (check, value, status) => {
		expect(detailRow(detail({ ref: null }, check)).fields?.at(-1)).toEqual({
			label: "status",
			value,
			status,
		});
	});

	it.each<UpdateCheckResult>([
		{ status: "up-to-date" },
		{ status: "constrained-up-to-date", latestOverall: null },
		{ status: "update-available", remoteCommit: NEW },
		{ status: "newer-tags", tags: ["v2.0.0"] },
		{ status: "check-failed", reason: SSH_REFUSAL },
		{ status: "constrained-no-match" },
	])("agrees with the dashboard's status cell (%o)", (check) => {
		const entry = { ref: null, constraint: "^1.0.0" };
		const cell = statusCell(makeEntry(entry), check);
		expect(detailRow(detail(entry, check)).fields?.at(-1)?.status).toBe(
			cell.dim ? "unchanged" : cell.status,
		);
	});
});

describe("versionUnchangedRow", () => {
	it("names the entry under its repo, as its update's row does, with why", () => {
		expect(
			versionUnchangedRow(
				{ subject: "owner/repo", meta: "v1.0.0" },
				"owner/repo/skill",
				"unchanged",
				"already on v1.0.0",
			),
		).toEqual({
			status: "unchanged",
			subject: "owner/repo",
			meta: "v1.0.0",
			detail: "already on v1.0.0",
			children: [{ name: "skill" }],
		});
	});
});

describe("reinstallResult", () => {
	const entry = makeEntry();

	it("follows a reinstalled entry to the key it moved to, counted as what it set out to do", () => {
		const outcome: PluginOutcome = {
			status: "updated",
			key: "owner/repo/new",
			previousKey: "owner/repo/old",
			summary: "",
			newEntry: entry,
			notes: [],
			absorbed: [],
		};

		expect(
			reinstallResult("owner/repo/old", outcome, "versionChanged"),
		).toEqual({ key: "owner/repo/new", change: "versionChanged" });
	});

	it("counts a refreshed local entry as updated", () => {
		const outcome: PluginOutcome = {
			status: "refreshed",
			key: "/src/a",
			summary: "",
			newEntry: entry,
			notes: [],
			absorbed: [],
		};

		expect(reinstallResult("/src/a", outcome, "updated").change).toBe(
			"updated",
		);
	});

	it("counts an entry removed as gone upstream as removed", () => {
		expect(
			reinstallResult(
				"owner/repo",
				{ status: "gone-removed", key: "owner/repo", summary: "" },
				"updated",
			),
		).toEqual({ key: "owner/repo", change: "removed" });
	});

	it.each<PluginOutcome>([
		{ status: "gone-kept", key: "owner/repo", summary: "" },
		{ status: "aborted", key: "owner/repo", summary: "" },
		{ status: "blocked", key: "owner/repo", summary: "" },
		{ status: "failed", key: "owner/repo", summary: "" },
		{ status: "copy-failed", key: "owner/repo", summary: "", absorbed: [] },
	])("counts nothing when it changed nothing it set out to ($status)", (outcome) => {
		expect(reinstallResult("owner/repo", outcome, "updated")).toEqual({
			key: "owner/repo",
			change: null,
		});
	});
});

describe("counted", () => {
	it("counts a change once more, leaving the tally it was given as it was", () => {
		const tally = { updated: 1 };

		expect(counted(counted(tally, "updated"), "removed")).toEqual({
			updated: 2,
			removed: 1,
		});
		expect(tally).toEqual({ updated: 1 });
	});
});

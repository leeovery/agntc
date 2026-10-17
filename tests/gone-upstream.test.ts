import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

import { goneRow, settleGone } from "../src/gone-upstream.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { globalScope, projectScope } from "../src/scope.js";
import { MachineUi } from "../src/ui.js";
import { makeEntry } from "./helpers/factories.js";
import { type TestUi, testUi } from "./helpers/test-ui.js";

const mockNuke = vi.mocked(nukeManifestFiles);

const KEY = "owner/repo/go";
const PROJECT = projectScope("/project");
const HEAD = { subject: KEY };
const entry = makeEntry({ type: "skill", files: [".claude/skills/go/"] });

/** A terminal that answers the one question it's asked. */
function terminal(answer: boolean): TestUi {
	const ui = testUi();
	ui.confirm.mockResolvedValue(answer);
	return ui;
}

beforeEach(() => {
	vi.clearAllMocks();
	mockNuke.mockResolvedValue({ removed: [], skipped: [] });
});

describe("settleGone", () => {
	it("asks at a terminal under the entry's row, no by default, counting what it installed", async () => {
		const ui = terminal(false);

		await settleGone(KEY, entry, PROJECT, { yes: false, ui, head: HEAD });

		const row = {
			status: "attention",
			subject: KEY,
			detail: { label: "gone upstream", aside: "skill" },
			fields: [{ label: ".claude/skills/", value: ["go"], noun: "folder" }],
		};
		expect(ui.block).toHaveBeenCalledExactlyOnceWith([row]);
		expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(row, {
			message: "Remove it and its skill?",
			initialValue: false,
		});
		expect(ui.blocks[0]!.row).not.toHaveBeenCalled();
	});

	it("names the entry's row by the head its caller gives, a local one's meta with it", async () => {
		const ui = terminal(false);
		const local = makeEntry({
			type: "pack",
			commit: null,
			cloneUrl: null,
			files: [".claude/skills/a/", ".claude/agents/x.md"],
		});

		await settleGone("/home/lee/src/kit", local, PROJECT, {
			yes: false,
			ui,
			head: { subject: "~/src/kit", meta: "local" },
		});

		expect(ui.blocks[0]!.confirm).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({
				subject: "~/src/kit",
				meta: "local",
				detail: { label: "gone upstream", aside: "pack · 1 skill, 1 agent" },
			}),
			{
				message: "Remove it and its 1 skill and 1 agent?",
				initialValue: false,
			},
		);
	});

	it("keeps it on no, removing nothing, and says update will ask again", async () => {
		const settled = await settleGone(KEY, entry, PROJECT, {
			yes: false,
			ui: terminal(false),
			head: HEAD,
		});

		expect(settled).toEqual({
			removed: false,
			message: {
				subject: KEY,
				detail: "kept — it's gone upstream; update will ask again",
				text: "Kept owner/repo/go — it's gone upstream; update will ask again",
				plain: "Kept owner/repo/go — it's gone upstream; update will ask again",
			},
		});
		expect(mockNuke).not.toHaveBeenCalled();
	});

	it("removes its files on yes", async () => {
		const settled = await settleGone(KEY, entry, PROJECT, {
			yes: false,
			ui: terminal(true),
			head: HEAD,
		});

		expect(settled).toEqual({
			removed: true,
			message: {
				subject: KEY,
				detail: "removed — it's gone upstream",
				text: "Removed owner/repo/go — it's gone upstream",
				plain: "Removed owner/repo/go — it's gone upstream",
			},
		});
		expect(mockNuke).toHaveBeenCalledExactlyOnceWith("/project", [
			".claude/skills/go/",
		]);
	});

	it("removes it without asking under -y, at a terminal or not", async () => {
		const ui = terminal(false);

		const atTerminal = await settleGone(KEY, entry, PROJECT, {
			yes: true,
			ui,
			head: HEAD,
		});
		const machine = await settleGone(KEY, entry, PROJECT, {
			yes: true,
			ui: new MachineUi("update", "project"),
			head: HEAD,
		});

		expect(ui.confirm).not.toHaveBeenCalled();
		expect(atTerminal.removed).toBe(true);
		expect(machine.removed).toBe(true);
		expect(mockNuke).toHaveBeenCalledTimes(2);
	});

	it("keeps it without a terminal and without -y, naming -y as what removes it", async () => {
		const settled = await settleGone(KEY, entry, PROJECT, {
			yes: false,
			ui: new MachineUi("update", "project"),
			head: HEAD,
		});

		expect(settled).toEqual({
			removed: false,
			message: expect.objectContaining({
				plain:
					"Kept owner/repo/go — it's gone upstream; npx agntc update owner/repo/go -y removes it",
			}),
			flags: ["-y"],
		});
		expect(mockNuke).not.toHaveBeenCalled();
	});

	it("names the global update that removes a global entry", async () => {
		const settled = await settleGone(KEY, entry, globalScope("/home/lee"), {
			yes: false,
			ui: new MachineUi("update", "global"),
			head: HEAD,
		});

		expect(settled.message.plain).toBe(
			"Kept owner/repo/go — it's gone upstream; npx agntc update -g owner/repo/go -y removes it",
		);
	});

	it("removes a global entry's files below the home directory", async () => {
		await settleGone(KEY, entry, globalScope("/home/lee"), {
			yes: true,
			ui: terminal(false),
			head: HEAD,
		});

		expect(mockNuke).toHaveBeenCalledExactlyOnceWith("/home/lee", [
			".claude/skills/go/",
		]);
	});
});

describe("goneRow", () => {
	it("needs a look: the entry, gone upstream with its kind and counts, then what it installed", () => {
		expect(
			goneRow({ subject: "owner/repo/go" }, "skill", [
				".claude/skills/go/",
				".claude/skills/go/SKILL.md",
			]),
		).toEqual({
			status: "attention",
			subject: "owner/repo/go",
			detail: { label: "gone upstream", aside: "skill" },
			fields: [{ label: ".claude/skills/", value: ["go"], noun: "folder" }],
		});
	});

	it("keeps the meta its head carries, as a local entry's", () => {
		expect(
			goneRow({ subject: "~/src/kit", meta: "local" }, "skill", []),
		).toMatchObject({ subject: "~/src/kit", meta: "local" });
	});
});

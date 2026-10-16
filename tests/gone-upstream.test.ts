import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/nuke-files.js", () => ({
	nukeManifestFiles: vi.fn(),
}));

vi.mock("../src/manifest.js", async (importOriginal) => ({
	...(await importOriginal<typeof import("../src/manifest.js")>()),
	writeManifest: vi.fn(),
}));

import { settleGone, settleGoneInList } from "../src/gone-upstream.js";
import { type Manifest, writeManifest } from "../src/manifest.js";
import { nukeManifestFiles } from "../src/nuke-files.js";
import { globalScope, projectScope } from "../src/scope.js";
import { MachineUi, type Ui } from "../src/ui.js";
import { makeEntry } from "./helpers/factories.js";

const mockNuke = vi.mocked(nukeManifestFiles);
const mockWriteManifest = vi.mocked(writeManifest);

const KEY = "owner/repo/go";
const PROJECT = projectScope("/project");
const entry = makeEntry({ type: "skill", files: [".claude/skills/go/"] });

/** A terminal that answers the one question it's asked. */
function terminal(answer: boolean): Ui & { confirm: ReturnType<typeof vi.fn> } {
	return {
		mode: "interactive",
		confirm: vi.fn(async () => answer),
	} as unknown as Ui & { confirm: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
	vi.clearAllMocks();
	mockNuke.mockResolvedValue({ removed: [], skipped: [] });
	mockWriteManifest.mockResolvedValue(undefined);
});

describe("settleGone", () => {
	it("asks at a terminal, no by default", async () => {
		const ui = terminal(false);

		await settleGone(KEY, entry, PROJECT, { yes: false, ui });

		expect(ui.confirm).toHaveBeenCalledExactlyOnceWith({
			message: "owner/repo/go is gone upstream — remove it?",
			initialValue: false,
		});
	});

	it("keeps it on no, removing nothing, and says update will ask again", async () => {
		const settled = await settleGone(KEY, entry, PROJECT, {
			yes: false,
			ui: terminal(false),
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
		});
		const machine = await settleGone(KEY, entry, PROJECT, {
			yes: true,
			ui: new MachineUi("update", "project"),
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
		});

		expect(settled.message.plain).toBe(
			"Kept owner/repo/go — it's gone upstream; npx agntc update -g owner/repo/go -y removes it",
		);
	});

	it("removes a global entry's files below the home directory", async () => {
		await settleGone(KEY, entry, globalScope("/home/lee"), {
			yes: true,
			ui: terminal(false),
		});

		expect(mockNuke).toHaveBeenCalledExactlyOnceWith("/home/lee", [
			".claude/skills/go/",
		]);
	});
});

describe("settleGoneInList", () => {
	const other = makeEntry({ files: [".claude/skills/other/"] });
	const manifest: Manifest = { [KEY]: entry, "owner/other": other };

	it("records the removal at once on yes, after the files are gone", async () => {
		await settleGoneInList(KEY, entry, manifest, PROJECT, terminal(true));

		expect(mockWriteManifest).toHaveBeenCalledExactlyOnceWith("/project", {
			"owner/other": other,
		});
		expect(mockNuke.mock.invocationCallOrder[0]).toBeLessThan(
			mockWriteManifest.mock.invocationCallOrder[0]!,
		);
	});

	it("writes nothing on no", async () => {
		const settled = await settleGoneInList(
			KEY,
			entry,
			manifest,
			PROJECT,
			terminal(false),
		);

		expect(settled).toEqual({
			ok: true,
			message: "Kept owner/repo/go — it's gone upstream; update will ask again",
		});
		expect(mockWriteManifest).not.toHaveBeenCalled();
	});

	it("keeps it recorded and says why when removing its files fails", async () => {
		mockNuke.mockRejectedValue(new Error("EACCES: permission denied"));

		const settled = await settleGoneInList(
			KEY,
			entry,
			manifest,
			PROJECT,
			terminal(true),
		);

		expect(settled).toEqual({
			ok: false,
			message:
				"Couldn't remove owner/repo/go: EACCES: permission denied; it stays recorded",
		});
		expect(mockWriteManifest).not.toHaveBeenCalled();
	});
});

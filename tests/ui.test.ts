import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { CANCEL } = vi.hoisted(() => ({ CANCEL: Symbol("cancel") }));

vi.mock("@clack/prompts", async () => {
	const { mockClack } = await import("./helpers/clack-mock.js");
	return mockClack({
		note: vi.fn(),
		select: vi.fn(),
		multiselect: vi.fn(),
		confirm: vi.fn(),
		isCancel: vi.fn((value: unknown) => value === CANCEL),
	});
});

import * as p from "@clack/prompts";
import { ExitSignal } from "../src/exit-signal.js";
import { interactiveUi, MachineUi, type Ui } from "../src/ui.js";
import { clackCalls } from "./helpers/machine.js";

const OPTIONS = [
	{ value: "a", label: "A" },
	{ value: "b", label: "B", hint: "the second" },
];

beforeEach(() => {
	vi.clearAllMocks();
});

async function exitCode(run: () => unknown): Promise<number | null> {
	try {
		await run();
		return null;
	} catch (err) {
		if (err instanceof ExitSignal) {
			return err.code;
		}
		throw err;
	}
}

/** Calls every method a command uses to show something, leaving out the prompts. */
function present(ui: Ui): void {
	ui.intro("intro");
	ui.outro("outro");
	ui.cancel("cancel");
	ui.box("body", "title");
	const spin = ui.spinner();
	spin.start("start");
	spin.stop("stop", 2);
	ui.log.info("info");
	ui.log.warn("warn");
	ui.log.error("error");
	ui.log.success("success");
	ui.log.message("message");
	ui.warn("a warning");
	ui.note("a note");
	ui.report({ items: [] });
}

describe("interactiveUi", () => {
	it("shows everything through clack", () => {
		present(interactiveUi);

		expect(p.intro).toHaveBeenCalledWith("intro");
		expect(p.outro).toHaveBeenCalledWith("outro");
		expect(p.cancel).toHaveBeenCalledWith("cancel");
		expect(p.note).toHaveBeenCalledWith("body", "title");
		expect(p.spinner).toHaveBeenCalledTimes(1);
		expect(p.log.info).toHaveBeenCalledWith("info");
		expect(p.log.error).toHaveBeenCalledWith("error");
		expect(p.log.success).toHaveBeenCalledWith("success");
		expect(p.log.message).toHaveBeenCalledWith("message");
		expect(clackCalls(p)).toEqual(
			expect.arrayContaining(["intro", "spinner", "log.info"]),
		);
	});

	it("logs a warning as a warning and a note as info", () => {
		interactiveUi.warn("a warning");
		interactiveUi.note("a note");

		expect(p.log.warn).toHaveBeenCalledWith("a warning");
		expect(p.log.info).toHaveBeenCalledWith("a note");
	});

	it("has no document to report to", () => {
		interactiveUi.report({ items: [] });

		expect(clackCalls(p)).toEqual([]);
	});

	it("passes a select through and reads a cancel as null", async () => {
		vi.mocked(p.select).mockResolvedValueOnce("b");
		expect(
			await interactiveUi.select({ message: "Pick", options: OPTIONS }),
		).toBe("b");
		expect(p.select).toHaveBeenCalledWith({
			message: "Pick",
			options: OPTIONS,
		});

		vi.mocked(p.select).mockResolvedValueOnce(CANCEL);
		expect(
			await interactiveUi.select({ message: "Pick", options: OPTIONS }),
		).toBeNull();
	});

	it("reads a cancelled multiselect as nothing picked", async () => {
		vi.mocked(p.multiselect).mockResolvedValueOnce(["a"]);
		expect(
			await interactiveUi.multiselect({ message: "Pick", options: OPTIONS }),
		).toEqual(["a"]);

		vi.mocked(p.multiselect).mockResolvedValueOnce(CANCEL);
		expect(
			await interactiveUi.multiselect({ message: "Pick", options: OPTIONS }),
		).toEqual([]);
	});

	it("reads a confirm as yes only when answered yes", async () => {
		vi.mocked(p.confirm).mockResolvedValueOnce(true);
		expect(await interactiveUi.confirm({ message: "Sure?" })).toBe(true);

		vi.mocked(p.confirm).mockResolvedValueOnce(false);
		expect(await interactiveUi.confirm({ message: "Sure?" })).toBe(false);

		vi.mocked(p.confirm).mockResolvedValueOnce(CANCEL);
		expect(await interactiveUi.confirm({ message: "Sure?" })).toBe(false);
	});

	it("fails with a cancel line by default, or an error line, and exit code 1", async () => {
		expect(await exitCode(() => interactiveUi.fail("no way"))).toBe(1);
		expect(p.cancel).toHaveBeenCalledWith("no way");

		expect(
			await exitCode(() => interactiveUi.fail("broken", { style: "error" })),
		).toBe(1);
		expect(p.log.error).toHaveBeenCalledWith("broken");
	});
});

describe("MachineUi", () => {
	it("never touches clack", async () => {
		const ui = new MachineUi("add", "project");

		present(ui);
		await exitCode(() => ui.select({ message: "Pick", options: OPTIONS }));
		await exitCode(() => ui.multiselect({ message: "Pick", options: OPTIONS }));
		await exitCode(() => ui.confirm({ message: "Sure?" }));
		await exitCode(() => ui.fail("no way"));

		expect(clackCalls(p)).toEqual([]);
	});

	it("carries warnings and notes into the document, not what a person watches", () => {
		const ui = new MachineUi("add", "project");

		present(ui);

		expect(ui.document(0)).toEqual({
			ok: true,
			command: "add",
			scope: "project",
			items: [],
			warnings: ["a warning"],
			notes: ["a note"],
		});
	});

	it("names its scope in every document, a failed one's included", () => {
		const ui = new MachineUi("remove", "global");

		expect(ui.document(0).scope).toBe("global");
		expect(ui.document(1, new Error("disk on fire")).scope).toBe("global");
	});

	it("names no scope for a command without one", () => {
		expect(new MachineUi("init").document(0)).not.toHaveProperty("scope");
	});

	it("is ok exactly when the exit code is 0", () => {
		const ui = new MachineUi("update", "project");
		ui.report({ items: [{ key: "k" }] });

		expect(ui.document(0).ok).toBe(true);
		expect(ui.document(1)).toEqual({
			ok: false,
			command: "update",
			scope: "project",
			items: [{ key: "k" }],
			warnings: [],
			notes: [],
		});
	});

	it("records a failure, with the flags that would answer it, and exits 1", async () => {
		const ui = new MachineUi("remove", "project");

		expect(await exitCode(() => ui.fail("needs -y", { flags: ["-y"] }))).toBe(
			1,
		);
		expect(ui.document(1)).toEqual({
			ok: false,
			command: "remove",
			scope: "project",
			error: { message: "needs -y", flags: ["-y"] },
			warnings: [],
			notes: [],
		});
	});

	it("leaves flags off a failure no flag answers", async () => {
		const ui = new MachineUi("init");

		await exitCode(() => ui.fail("needs a terminal", { style: "error" }));

		expect(ui.document(1).error).toEqual({ message: "needs a terminal" });
	});

	it.each([
		[
			"select",
			(ui: Ui) => ui.select({ message: "Pick one", options: OPTIONS }),
		],
		[
			"multiselect",
			(ui: Ui) => ui.multiselect({ message: "Pick one", options: OPTIONS }),
		],
		["confirm", (ui: Ui) => ui.confirm({ message: "Pick one" })],
	])("refuses a %s instead of waiting", async (_, ask) => {
		const ui = new MachineUi("add", "project");

		await expect(ask(ui)).rejects.toBeInstanceOf(ExitSignal);
		expect(ui.document(1).error).toEqual({
			message: `can't ask "Pick one" without a terminal`,
		});
	});

	it("keeps the body it was given when the command fails after reporting", async () => {
		const ui = new MachineUi("add", "project");
		ui.report({ packs: [] });

		await exitCode(() => ui.fail("several found", { flags: ["--all"] }));

		expect(ui.document(1)).toMatchObject({
			ok: false,
			error: { message: "several found", flags: ["--all"] },
			packs: [],
		});
	});

	it("turns an error the command didn't catch into the document's error", () => {
		const ui = new MachineUi("list", "project");

		expect(ui.document(1, new Error("disk on fire"))).toEqual({
			ok: false,
			command: "list",
			scope: "project",
			error: { message: "disk on fire" },
			warnings: [],
			notes: [],
		});
	});
});

describe("clack's reach", () => {
	it("is imported by src/ui.ts and nothing else", async () => {
		const srcDir = join(import.meta.dirname, "..", "src");
		const files = await readdir(srcDir, { recursive: true });
		const importers: string[] = [];
		for (const file of files.filter((name) => name.endsWith(".ts"))) {
			const text = await readFile(join(srcDir, file), "utf-8");
			if (text.includes('from "@clack/prompts"')) {
				importers.push(relative(srcDir, join(srcDir, file)));
			}
		}

		expect(importers).toEqual(["ui.ts"]);
	});
});

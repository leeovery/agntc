import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExitSignal } from "../src/exit-signal.js";
import type { RichMessage } from "../src/message.js";
import { TerminalUi } from "../src/terminal/terminal-ui.js";
import { interactiveUi, MachineUi, type Ui } from "../src/ui.js";

const OPTIONS = [
	{ value: "a", label: "A" },
	{ value: "b", label: "B", hint: "the second" },
];

const RICH: RichMessage = {
	text: "laravel can't be updated.",
	cause: "it would remove macos-hig",
	remedy: {
		lead: "To update it anyway:",
		steps: [{ command: "npx agntc remove o/r/laravel" }],
	},
	plain:
		"laravel can't be updated: it would remove macos-hig. To update it anyway: npx agntc remove o/r/laravel",
};

afterEach(() => {
	vi.restoreAllMocks();
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
	ui.header();
	const block = ui.block([{ subject: "owner/repo" }]);
	block.row({ status: "done", subject: "owner/repo" });
	const task = block.task({ subject: "owner/repo", text: "updating…" });
	task.settle({ status: "done", subject: "owner/repo" });
	block.task({ text: "checking…" }).clear();
	ui.next({ subject: "laravel", remedy: RICH.remedy! });
	ui.close({ command: "update", counts: { updated: 2 } });
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
	it("is a fresh terminal ui each time, in interactive mode", () => {
		const ui = interactiveUi();
		expect(ui).toBeInstanceOf(TerminalUi);
		expect(ui.mode).toBe("interactive");
		expect(interactiveUi()).not.toBe(ui);
	});
});

describe("MachineUi", () => {
	it("draws nothing", async () => {
		const write = vi.spyOn(process.stdout, "write");
		const ui = new MachineUi("add", "project");

		present(ui);
		await exitCode(() => ui.select({ message: "Pick", options: OPTIONS }));
		await exitCode(() => ui.multiselect({ message: "Pick", options: OPTIONS }));
		await exitCode(() => ui.confirm({ message: "Sure?" }));
		await exitCode(() => ui.fail("no way"));

		expect(write).not.toHaveBeenCalled();
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

	it("flattens a rich warning, note and failure to its plain sentence", async () => {
		const ui = new MachineUi("update", "project");

		ui.warn(RICH);
		ui.note(RICH);
		await exitCode(() => ui.fail(RICH, { flags: ["-y"] }));

		expect(ui.document(1)).toEqual({
			ok: false,
			command: "update",
			scope: "project",
			error: { message: RICH.plain, flags: ["-y"] },
			warnings: [RICH.plain],
			notes: [RICH.plain],
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
		[
			"block's select",
			(ui: Ui) =>
				ui
					.block([{ subject: "owner/repo" }])
					.select(
						{ status: "done", subject: "owner/repo" },
						{ message: "Pick one", options: OPTIONS },
					),
		],
		[
			"block's multiselect",
			(ui: Ui) =>
				ui
					.block([{ subject: "owner/repo" }])
					.multiselect(
						{ status: "done", subject: "owner/repo" },
						{ message: "Pick one", options: OPTIONS },
					),
		],
		[
			"block's confirm",
			(ui: Ui) =>
				ui
					.block([{ subject: "owner/repo" }])
					.confirm(
						{ status: "done", subject: "owner/repo" },
						{ message: "Pick one" },
					),
		],
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

/** The files under src/ whose text holds an import from `module`. */
async function importersOf(module: string): Promise<string[]> {
	const srcDir = join(import.meta.dirname, "..", "src");
	const files = await readdir(srcDir, { recursive: true });
	const importers: string[] = [];
	for (const file of files.filter((name) => name.endsWith(".ts")).sort()) {
		const text = await readFile(join(srcDir, file), "utf-8");
		if (namesModule(text, module)) {
			importers.push(file);
		}
	}
	return importers;
}

/**
 * Whether `text` names `module`, or a path inside it, in quotes of any kind:
 * so every import, re-export, bare import, dynamic import and require.
 */
function namesModule(text: string, module: string): boolean {
	const quote = "[\"'`]";
	const specifier = module.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
	return new RegExp(`${quote}${specifier}(/[^"'\`]*)?${quote}`).test(text);
}

describe("namesModule", () => {
	it.each([
		`import * as p from "@clack/prompts";`,
		`import { note } from '@clack/prompts';`,
		`import "@clack/prompts";`,
		`export { select } from "@clack/prompts";`,
		`const p = await import("@clack/prompts");`,
		"const p = await import(`@clack/prompts`);",
		`import { x } from "@clack/prompts/dist/index.mjs";`,
	])("finds %s", (text) => {
		expect(namesModule(text, "@clack/prompts")).toBe(true);
	});

	it.each([
		`import { Prompt } from "@clack/core";`,
		`import { x } from "@clack/prompts-extra";`,
		"// clack's prompts are gone",
	])("passes over %s", (text) => {
		expect(namesModule(text, "@clack/prompts")).toBe(false);
	});
});

describe("clack's reach", () => {
	it("leaves @clack/prompts imported by nothing", async () => {
		expect(await importersOf("@clack/prompts")).toEqual([]);
	});

	it("keeps @clack/core to the prompts", async () => {
		const importers = await importersOf("@clack/core");

		expect(importers).not.toEqual([]);
		for (const file of importers) {
			expect(file.startsWith(join("terminal", "prompts"))).toBe(true);
		}
	});
});

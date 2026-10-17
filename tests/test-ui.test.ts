import { describe, expect, it } from "vitest";
import { ExitSignal } from "../src/exit-signal.js";
import { testUi } from "./helpers/test-ui.js";

const RICH = {
	text: "laravel can't be updated.",
	remedy: { lead: "To update it anyway:", steps: [] },
	plain: "laravel can't be updated. To update it anyway: …",
};

describe("testUi", () => {
	it("keeps every block it opened, with the rows and tasks streamed into it", () => {
		const ui = testUi();

		const block = ui.block([{ subject: "owner/alpha" }]);
		block.row({ status: "done", subject: "owner/alpha" });
		block.task({ text: "checking…" }).clear();

		expect(ui.blocks).toEqual([block]);
		expect(block.row).toHaveBeenCalledWith({
			status: "done",
			subject: "owner/alpha",
		});
		expect(block.tasks).toHaveLength(1);
		expect(block.tasks[0]!.clear).toHaveBeenCalledOnce();
	});

	it("reads every row drawn, a settled task's in its place, across blocks", () => {
		const ui = testUi();
		const first = ui.block([{ subject: "a" }, { subject: "b" }]);
		const task = first.task({ subject: "a", text: "updating…" });
		first.row({ status: "unchanged", subject: "b" });
		task.settle({ status: "done", subject: "a" });
		first.task({ text: "checking…" }).clear();
		ui.block([{ subject: "c" }]).row({ status: "failed", subject: "c" });

		expect(ui.rows()).toEqual([
			{ status: "unchanged", subject: "b" },
			{ status: "done", subject: "a" },
			{ status: "failed", subject: "c" },
		]);
	});

	it("reads a rich message on its channel as machine mode flattens it", () => {
		const ui = testUi();

		ui.warn(RICH);
		ui.warn("a plain warning");
		ui.note("a note");
		expect(() => ui.fail(RICH)).toThrow(ExitSignal);

		expect(ui.said("warn")).toEqual([RICH.plain, "a plain warning"]);
		expect(ui.said("note")).toEqual(["a note"]);
		expect(ui.said("fail")).toEqual([RICH.plain]);
	});

	it("answers a block's question as the ui's own of its kind is scripted, keeping the row it's asked under", async () => {
		const ui = testUi();
		const block = ui.block([{ subject: "owner/repo" }]);
		const row = { status: "done" as const, subject: "owner/repo" };
		const prompt = {
			message: "Pick any",
			options: [{ value: "a", label: "a" }],
		};
		ui.multiselect.mockResolvedValue(["a"]);

		expect(await block.multiselect(row, prompt)).toEqual(["a"]);
		expect(block.multiselect).toHaveBeenCalledWith(row, prompt);
		expect(ui.multiselect).toHaveBeenCalledWith(prompt);
		expect(ui.rows()).toEqual([]);
	});

	it("answers a block's select and confirm as the ui's own are scripted", async () => {
		const ui = testUi();
		const block = ui.block([{ subject: "owner/repo" }]);
		const row = { status: "done" as const, subject: "owner/repo" };
		const select = {
			message: "Pick one",
			options: [{ value: "a", label: "a" }],
		};
		ui.select.mockResolvedValue("a");
		ui.confirm.mockResolvedValue(true);

		expect(await block.select(row, select)).toBe("a");
		expect(await block.confirm(row, { message: "Sure?" })).toBe(true);
		expect(block.select).toHaveBeenCalledWith(row, select);
		expect(ui.select).toHaveBeenCalledWith(select);
		expect(block.confirm).toHaveBeenCalledWith(row, { message: "Sure?" });
		expect(ui.confirm).toHaveBeenCalledWith({ message: "Sure?" });
		expect(ui.rows()).toEqual([]);
	});

	it("rejects a prompt no test scripted", async () => {
		const ui = testUi();

		await expect(ui.confirm({ message: "Sure?" })).rejects.toThrow(
			'unscripted confirm: "Sure?"',
		);
	});
});

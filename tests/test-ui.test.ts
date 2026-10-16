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

	it("reads a rich message on its channel as machine mode flattens it", () => {
		const ui = testUi();

		ui.warn(RICH);
		ui.log.warn("a plain warning");
		expect(() => ui.fail(RICH, { style: "error" })).toThrow(ExitSignal);

		expect(ui.said("warn")).toEqual([RICH.plain, "a plain warning"]);
		expect(ui.said("error")).toEqual([RICH.plain]);
	});

	it("rejects a prompt no test scripted", async () => {
		const ui = testUi();

		await expect(ui.confirm({ message: "Sure?" })).rejects.toThrow(
			'unscripted confirm: "Sure?"',
		);
	});
});

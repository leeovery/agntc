import { beforeEach, describe, expect, it } from "vitest";
import { selectInitType } from "../../src/init/type-select.js";
import { type TestUi, testUi } from "../helpers/test-ui.js";

let ui: TestUi;

function firstSelectCall() {
	const call = ui.select.mock.calls[0]?.[0];
	if (!call) throw new Error("select was not called");
	return call;
}

beforeEach(() => {
	ui = testUi();
});

describe("selectInitType", () => {
	it("renders two options: Skill, Pack", async () => {
		ui.select.mockResolvedValue("skill");

		await selectInitType(ui);

		expect(ui.select).toHaveBeenCalledOnce();
		const call = firstSelectCall();
		expect(call.options).toHaveLength(2);

		const values = call.options.map((o) => o.value);
		expect(values).toEqual(["skill", "pack"]);

		const labels = call.options.map((o: { label?: string }) => o.label);
		expect(labels).toEqual(["Skill", "Pack"]);
	});

	it("uses prompt message 'What are you creating?'", async () => {
		ui.select.mockResolvedValue("skill");

		await selectInitType(ui);

		const call = firstSelectCall();
		expect(call.message).toBe("What are you creating?");
	});

	it("returns 'skill' when Skill is selected", async () => {
		ui.select.mockResolvedValue("skill");

		const result = await selectInitType(ui);

		expect(result).toBe("skill");
	});

	it("returns 'pack' when Pack is selected", async () => {
		ui.select.mockResolvedValue("pack");

		const result = await selectInitType(ui);

		expect(result).toBe("pack");
	});

	it("returns null when user cancels", async () => {
		ui.select.mockResolvedValue(null);

		const result = await selectInitType(ui);

		expect(result).toBeNull();
	});

	it("passes correct hint for each option", async () => {
		ui.select.mockResolvedValue("skill");

		await selectInitType(ui);

		const call = firstSelectCall();
		const hints = call.options.map((o: { hint?: string }) => o.hint);
		expect(hints).toEqual([
			"a single skill (SKILL.md)",
			"skills, agents and hooks that install together as one",
		]);
	});
});

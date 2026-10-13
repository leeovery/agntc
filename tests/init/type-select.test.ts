import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
	select: vi.fn(),
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
}));

import * as p from "@clack/prompts";
import { selectInitType } from "../../src/init/type-select.js";
import { interactiveUi } from "../../src/ui.js";

const mockSelect = vi.mocked(p.select);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("selectInitType", () => {
	it("renders two options: Skill, Pack", async () => {
		mockSelect.mockResolvedValue("skill");

		await selectInitType(interactiveUi);

		expect(mockSelect).toHaveBeenCalledOnce();
		const call = mockSelect.mock.calls[0]?.[0];
		expect(call.options).toHaveLength(2);

		const values = call.options.map((o: { value: string }) => o.value);
		expect(values).toEqual(["skill", "pack"]);

		const labels = call.options.map((o: { label?: string }) => o.label);
		expect(labels).toEqual(["Skill", "Pack"]);
	});

	it("uses prompt message 'What are you creating?'", async () => {
		mockSelect.mockResolvedValue("skill");

		await selectInitType(interactiveUi);

		const call = mockSelect.mock.calls[0]?.[0];
		expect(call.message).toBe("What are you creating?");
	});

	it("returns 'skill' when Skill is selected", async () => {
		mockSelect.mockResolvedValue("skill");

		const result = await selectInitType(interactiveUi);

		expect(result).toBe("skill");
	});

	it("returns 'pack' when Pack is selected", async () => {
		mockSelect.mockResolvedValue("pack");

		const result = await selectInitType(interactiveUi);

		expect(result).toBe("pack");
	});

	it("returns null when user cancels", async () => {
		mockSelect.mockResolvedValue(Symbol("cancel"));

		const result = await selectInitType(interactiveUi);

		expect(result).toBeNull();
	});

	it("passes correct hint for each option", async () => {
		mockSelect.mockResolvedValue("skill");

		await selectInitType(interactiveUi);

		const call = mockSelect.mock.calls[0]?.[0];
		const hints = call.options.map((o: { hint?: string }) => o.hint);
		expect(hints).toEqual([
			"a single skill (SKILL.md)",
			"skills, agents and hooks that install together as one",
		]);
	});
});

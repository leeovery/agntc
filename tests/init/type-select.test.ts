import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
	select: vi.fn(),
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
}));

import * as p from "@clack/prompts";
import { selectInitType } from "../../src/init/type-select.js";

const mockSelect = vi.mocked(p.select);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("selectInitType", () => {
	it("renders three options: Skill, Plugin, Collection", async () => {
		mockSelect.mockResolvedValue("skill");

		await selectInitType();

		expect(mockSelect).toHaveBeenCalledOnce();
		const call = mockSelect.mock.calls[0]![0];
		expect(call.options).toHaveLength(3);

		const values = call.options.map((o: { value: string }) => o.value);
		expect(values).toEqual(["skill", "plugin", "collection"]);

		const labels = call.options.map((o: { label?: string }) => o.label);
		expect(labels).toEqual(["Skill", "Plugin", "Collection"]);
	});

	it("uses prompt message 'What are you creating?'", async () => {
		mockSelect.mockResolvedValue("skill");

		await selectInitType();

		const call = mockSelect.mock.calls[0]![0];
		expect(call.message).toBe("What are you creating?");
	});

	it("returns 'skill' when Skill is selected", async () => {
		mockSelect.mockResolvedValue("skill");

		const result = await selectInitType();

		expect(result).toBe("skill");
	});

	it("returns 'plugin' when Plugin is selected", async () => {
		mockSelect.mockResolvedValue("plugin");

		const result = await selectInitType();

		expect(result).toBe("plugin");
	});

	it("returns 'collection' when Collection is selected", async () => {
		mockSelect.mockResolvedValue("collection");

		const result = await selectInitType();

		expect(result).toBe("collection");
	});

	it("returns null when user cancels", async () => {
		mockSelect.mockResolvedValue(Symbol("cancel"));

		const result = await selectInitType();

		expect(result).toBeNull();
	});

	it("passes correct hint for each option", async () => {
		mockSelect.mockResolvedValue("skill");

		await selectInitType();

		const call = mockSelect.mock.calls[0]![0];
		const hints = call.options.map((o: { hint?: string }) => o.hint);
		expect(hints).toEqual([
			"a single skill (SKILL.md)",
			"skills, agents, and/or hooks that install together as one package",
			"a repo of individually selectable plugins",
		]);
	});
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@clack/prompts", () => ({
	multiselect: vi.fn(),
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
	log: { warn: vi.fn() },
}));

vi.mock("../../src/drivers/registry.js", () => ({
	getRegisteredAgentIds: vi.fn(),
}));

import * as p from "@clack/prompts";
import { getRegisteredAgentIds } from "../../src/drivers/registry.js";
import { selectInitAgents } from "../../src/init/agent-select.js";

const mockMultiselect = vi.mocked(p.multiselect);
const mockGetRegisteredAgentIds = vi.mocked(getRegisteredAgentIds);
const mockLogWarn = vi.mocked(p.log.warn);

beforeEach(() => {
	vi.clearAllMocks();
	mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
});

describe("selectInitAgents", () => {
	it("renders Claude and Codex as multiselect options", async () => {
		mockMultiselect.mockResolvedValueOnce(["claude"]);

		await selectInitAgents();

		expect(mockMultiselect).toHaveBeenCalledOnce();
		const call = mockMultiselect.mock.calls[0]![0];
		expect(call.message).toBe("Which agents is this built for?");
		expect(call.options).toEqual([
			{ value: "claude", label: "Claude" },
			{ value: "codex", label: "Codex" },
		]);
		expect(call.required).toBe(false);
	});

	it("returns selected agents on valid selection", async () => {
		mockMultiselect.mockResolvedValueOnce(["claude"]);

		const result = await selectInitAgents();

		expect(result).toEqual(["claude"]);
	});

	it("returns both agents when both selected", async () => {
		mockMultiselect.mockResolvedValueOnce(["claude", "codex"]);

		const result = await selectInitAgents();

		expect(result).toEqual(["claude", "codex"]);
	});

	it("re-prompts on empty selection", async () => {
		mockMultiselect.mockResolvedValueOnce([]).mockResolvedValueOnce(["claude"]);

		const result = await selectInitAgents();

		expect(mockMultiselect).toHaveBeenCalledTimes(2);
		expect(mockLogWarn).toHaveBeenCalledWith(
			"At least one agent must be selected",
		);
		expect(result).toEqual(["claude"]);
	});

	it("returns null on cancel", async () => {
		mockMultiselect.mockResolvedValueOnce(Symbol("cancel"));

		const result = await selectInitAgents();

		expect(result).toBeNull();
	});

	it("returns null on cancel after empty selection re-prompt", async () => {
		mockMultiselect
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce(Symbol("cancel"));

		const result = await selectInitAgents();

		expect(mockMultiselect).toHaveBeenCalledTimes(2);
		expect(mockLogWarn).toHaveBeenCalledOnce();
		expect(result).toBeNull();
	});

	it("has no initialValues (no pre-selection)", async () => {
		mockMultiselect.mockResolvedValueOnce(["claude"]);

		await selectInitAgents();

		const call = mockMultiselect.mock.calls[0]![0];
		const hasInitialValues =
			"initialValues" in call &&
			(call as { initialValues?: unknown[] }).initialValues?.length;
		expect(hasInitialValues).toBeFalsy();
	});
});

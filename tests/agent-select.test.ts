import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentId } from "../src/drivers/types.js";

vi.mock("@clack/prompts", () => ({
	multiselect: vi.fn(),
	isCancel: (value: unknown): value is symbol => typeof value === "symbol",
	cancel: vi.fn(),
	log: { warn: vi.fn(), info: vi.fn() },
}));

import * as p from "@clack/prompts";
import { selectAgents } from "../src/agent-select.js";

const mockMultiselect = vi.mocked(p.multiselect);

beforeEach(() => {
	vi.clearAllMocks();
});

describe("selectAgents", () => {
	it("only shows declared agents in options", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude", "codex", "cursor"],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		const values = call.options.map((o: { value: AgentId }) => o.value);
		expect(values).toEqual(["claude", "codex"]);
	});

	it("excludes undeclared agents entirely", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude", "codex", "cursor"],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		const values = call.options.map((o: { value: AgentId }) => o.value);
		expect(values).not.toContain("cursor");
	});

	it("shows not-detected hint in label for declared but undetected agent", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		const codexOption = call.options.find(
			(o: { value: AgentId }) => o.value === "codex",
		);
		expect(codexOption?.label).toBe("codex (not detected in project)");
	});

	it("does not show hint in label for detected agent", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		const claudeOption = call.options.find(
			(o: { value: AgentId }) => o.value === "claude",
		);
		expect(claudeOption?.label).toBe("claude");
	});

	it("all declared agents not detected shows all with hint", async () => {
		mockMultiselect.mockResolvedValue([]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: [],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		for (const opt of call.options) {
			expect(opt.label).toMatch(/\(not detected in project\)$/);
		}
	});

	it("empty declaredAgents yields zero options", async () => {
		const result = await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual([]);
		expect(mockMultiselect).not.toHaveBeenCalled();
	});

	it("pre-selects declared AND detected agents", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		expect(call.initialValues).toEqual(["claude"]);
	});

	it("returns empty array on cancel", async () => {
		mockMultiselect.mockResolvedValue(Symbol("cancel"));

		const result = await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual([]);
	});

	it("returns empty array on zero selection with info log", async () => {
		mockMultiselect.mockResolvedValue([]);

		const result = await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual([]);
		expect(vi.mocked(p.log.info)).toHaveBeenCalledWith(
			"No agents selected — skipping",
		);
	});

	it("returns selected AgentId[] on valid selection", async () => {
		mockMultiselect.mockResolvedValue(["claude", "codex"]);

		const result = await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude", "codex"],
		});

		expect(result).toEqual(["claude", "codex"]);
	});

	it("auto-selects when one declared agent is detected", async () => {
		const result = await selectAgents({
			declaredAgents: ["claude"],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual(["claude"]);
		expect(mockMultiselect).not.toHaveBeenCalled();
	});

	it("logs auto-selected agent name", async () => {
		await selectAgents({
			declaredAgents: ["codex"],
			detectedAgents: ["codex", "claude"],
		});

		expect(vi.mocked(p.log.info)).toHaveBeenCalledWith(
			"Auto-selected agent: codex",
		);
	});

	it("shows prompt when one declared agent is not detected", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: ["claude"],
			detectedAgents: [],
		});

		expect(mockMultiselect).toHaveBeenCalled();
		const call = mockMultiselect.mock.calls[0]![0];
		const claudeOption = call.options.find(
			(o: { value: AgentId }) => o.value === "claude",
		);
		expect(claudeOption?.label).toBe("claude (not detected in project)");
	});

	it("shows prompt when multiple declared with one detected", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		expect(mockMultiselect).toHaveBeenCalled();
	});

	it("shows prompt when multiple declared all detected", async () => {
		mockMultiselect.mockResolvedValue(["claude", "codex"]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude", "codex"],
		});

		expect(mockMultiselect).toHaveBeenCalled();
	});

	it("shows prompt when multiple declared none detected", async () => {
		mockMultiselect.mockResolvedValue([]);

		await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: [],
		});

		expect(mockMultiselect).toHaveBeenCalled();
	});

	it("returns empty array for zero declared agents without prompting", async () => {
		const result = await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude", "codex"],
		});

		expect(result).toEqual([]);
		expect(mockMultiselect).not.toHaveBeenCalled();
	});
});

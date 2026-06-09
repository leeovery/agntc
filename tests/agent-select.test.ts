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

	describe("prompt message", () => {
		it("builds 'Install <unitLabel> for which agents?' (plural for multiple options)", async () => {
			mockMultiselect.mockResolvedValue(["claude"]);

			await selectAgents({
				declaredAgents: ["claude", "codex"],
				detectedAgents: [],
				unitLabel: "these 2 skills",
			});

			const call = mockMultiselect.mock.calls[0]![0];
			expect(call.message).toBe("Install these 2 skills for which agents?");
		});

		it("uses singular 'agent' when only one option is shown", async () => {
			mockMultiselect.mockResolvedValue([]);

			// Single declared agent, NOT detected → one option, no auto-select.
			await selectAgents({
				declaredAgents: ["claude"],
				detectedAgents: [],
				unitLabel: "the refero-design skill",
			});

			const call = mockMultiselect.mock.calls[0]![0];
			expect(call.message).toBe(
				"Install the refero-design skill for which agent?",
			);
		});

		it("falls back to a generic heading when no unitLabel is given", async () => {
			mockMultiselect.mockResolvedValue(["claude"]);

			await selectAgents({
				declaredAgents: ["claude", "codex"],
				detectedAgents: [],
			});

			const call = mockMultiselect.mock.calls[0]![0];
			expect(call.message).toBe("Select agents to install for");
		});
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

	it("offers all KNOWN_AGENTS when no declaration", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude"],
		});

		expect(mockMultiselect).toHaveBeenCalled();
		const call = mockMultiselect.mock.calls[0]![0];
		const values = call.options.map((o: { value: AgentId }) => o.value);
		expect(values).toEqual(["claude", "codex", "cursor"]);
	});

	it("pre-ticks detected agents in no-declaration default", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		await selectAgents({
			declaredAgents: [],
			detectedAgents: ["cursor", "claude"],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		expect(call.initialValues).toEqual(["claude", "cursor"]);
	});

	it("never auto-selects in no-declaration default even with one detected", async () => {
		mockMultiselect.mockResolvedValue(["claude"]);

		const result = await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude"],
		});

		expect(mockMultiselect).toHaveBeenCalled();
		expect(result).toEqual({ kind: "selected", agents: ["claude"] });
	});

	it("returns user pick from KNOWN_AGENTS prompt", async () => {
		mockMultiselect.mockResolvedValue(["codex", "cursor"]);

		const result = await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual({ kind: "selected", agents: ["codex", "cursor"] });
	});

	it("no-declaration default labels undetected KNOWN_AGENTS with hint", async () => {
		mockMultiselect.mockResolvedValue([]);

		await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude"],
		});

		const call = mockMultiselect.mock.calls[0]![0];
		const claudeOption = call.options.find(
			(o: { value: AgentId }) => o.value === "claude",
		);
		const codexOption = call.options.find(
			(o: { value: AgentId }) => o.value === "codex",
		);
		expect(claudeOption?.label).toBe("claude");
		expect(codexOption?.label).toBe("codex (not detected in project)");
	});

	it("no-declaration default returns cancelled on cancel", async () => {
		mockMultiselect.mockResolvedValue(Symbol("cancel"));

		const result = await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual({ kind: "cancelled" });
	});

	it("no-declaration default returns selected with empty agents on zero selection", async () => {
		mockMultiselect.mockResolvedValue([]);

		const result = await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual({ kind: "selected", agents: [] });
		expect(vi.mocked(p.log.info)).not.toHaveBeenCalledWith(
			"No agents selected — skipping",
		);
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

	it("returns cancelled on cancel", async () => {
		mockMultiselect.mockResolvedValue(Symbol("cancel"));

		const result = await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual({ kind: "cancelled" });
	});

	it("returns selected with empty agents on zero selection", async () => {
		mockMultiselect.mockResolvedValue([]);

		const result = await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual({ kind: "selected", agents: [] });
		expect(vi.mocked(p.log.info)).not.toHaveBeenCalledWith(
			"No agents selected — skipping",
		);
	});

	it("returns selected AgentId[] on valid selection", async () => {
		mockMultiselect.mockResolvedValue(["claude", "codex"]);

		const result = await selectAgents({
			declaredAgents: ["claude", "codex"],
			detectedAgents: ["claude", "codex"],
		});

		expect(result).toEqual({ kind: "selected", agents: ["claude", "codex"] });
	});

	it("auto-selects when one declared agent is detected", async () => {
		const result = await selectAgents({
			declaredAgents: ["claude"],
			detectedAgents: ["claude"],
		});

		expect(result).toEqual({ kind: "selected", agents: ["claude"] });
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

	it("prompts over KNOWN_AGENTS for zero declared agents instead of returning early", async () => {
		mockMultiselect.mockResolvedValue(["claude", "codex"]);

		const result = await selectAgents({
			declaredAgents: [],
			detectedAgents: ["claude", "codex"],
		});

		expect(mockMultiselect).toHaveBeenCalled();
		expect(result).toEqual({ kind: "selected", agents: ["claude", "codex"] });
	});
});

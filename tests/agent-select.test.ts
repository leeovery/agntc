import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AgentId } from "../src/drivers/types.js";

vi.mock("@clack/prompts", () => ({
  multiselect: vi.fn(),
  isCancel: (value: unknown): value is symbol => typeof value === "symbol",
  cancel: vi.fn(),
  log: { warn: vi.fn(), info: vi.fn() },
}));

vi.mock("../src/drivers/registry.js", () => ({
  getRegisteredAgentIds: vi.fn(),
}));

import * as p from "@clack/prompts";
import { getRegisteredAgentIds } from "../src/drivers/registry.js";
import { selectAgents } from "../src/agent-select.js";

const mockMultiselect = vi.mocked(p.multiselect);
const mockGetRegisteredAgentIds = vi.mocked(getRegisteredAgentIds);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRegisteredAgentIds.mockReturnValue(["claude"]);
});

describe("selectAgents", () => {
  it("pre-selects declared AND detected agents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude", "codex"],
      detectedAgents: ["claude"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    expect(call.initialValues).toEqual(["claude"]);
  });

  it("does not pre-select declared-only agents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude", "codex"],
      detectedAgents: ["claude"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    expect(call.initialValues).not.toContain("codex");
  });

  it("does not pre-select detected-only agents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude"],
      detectedAgents: ["claude", "codex"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    expect(call.initialValues).toEqual(["claude"]);
    expect(call.initialValues).not.toContain("codex");
  });

  it("shows all registered agents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude"],
      detectedAgents: ["claude"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const values = call.options.map((o: { value: AgentId }) => o.value);
    expect(values).toEqual(["claude", "codex"]);
  });

  it("adds warning hint on undeclared agents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude"],
      detectedAgents: ["claude"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const codexOption = call.options.find(
      (o: { value: AgentId }) => o.value === "codex",
    );
    expect(codexOption?.hint).toBeDefined();
    expect(codexOption?.hint).toMatch(/not declared/i);
  });

  it("has no hint on declared agents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude"],
      detectedAgents: ["claude"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const claudeOption = call.options.find(
      (o: { value: AgentId }) => o.value === "claude",
    );
    expect(claudeOption?.hint).toBeUndefined();
  });

  it("returns empty array on cancel", async () => {
    mockMultiselect.mockResolvedValue(Symbol("cancel"));

    const result = await selectAgents({
      declaredAgents: ["claude"],
      detectedAgents: ["claude"],
    });

    expect(result).toEqual([]);
  });

  it("returns empty array on zero selection", async () => {
    mockMultiselect.mockResolvedValue([]);

    const result = await selectAgents({
      declaredAgents: ["claude"],
      detectedAgents: ["claude"],
    });

    expect(result).toEqual([]);
  });

  it("returns selected AgentId[] on valid selection", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude", "codex"]);

    const result = await selectAgents({
      declaredAgents: ["claude", "codex"],
      detectedAgents: ["claude", "codex"],
    });

    expect(result).toEqual(["claude", "codex"]);
  });

  it("passes correct options shape to multiselect", async () => {
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude"],
      detectedAgents: ["claude"],
    });

    expect(mockMultiselect).toHaveBeenCalledOnce();
    const call = mockMultiselect.mock.calls[0]![0];
    expect(call.message).toBeDefined();
    expect(call.options).toBeDefined();
    expect(call.required).toBe(false);
    expect(Array.isArray(call.options)).toBe(true);
    for (const opt of call.options) {
      expect(opt).toHaveProperty("value");
      expect(opt).toHaveProperty("label");
    }
  });

  it("handles empty declaredAgents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: [],
      detectedAgents: ["claude"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    expect(call.initialValues).toEqual([]);
    // All agents should have warning hints when declaredAgents is empty
    for (const opt of call.options) {
      expect(opt.hint).toBeDefined();
    }
  });

  it("handles empty detectedAgents", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude"]);

    await selectAgents({
      declaredAgents: ["claude", "codex"],
      detectedAgents: [],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    // No pre-selection when nothing is detected
    expect(call.initialValues).toEqual([]);
  });

  it("handles all agents declared and detected", async () => {
    mockGetRegisteredAgentIds.mockReturnValue(["claude", "codex"]);
    mockMultiselect.mockResolvedValue(["claude", "codex"]);

    await selectAgents({
      declaredAgents: ["claude", "codex"],
      detectedAgents: ["claude", "codex"],
    });

    const call = mockMultiselect.mock.calls[0]![0];
    expect(call.initialValues).toEqual(["claude", "codex"]);
    // No warnings when all are declared
    for (const opt of call.options) {
      expect(opt.hint).toBeUndefined();
    }
  });

  describe("two-agent spec examples", () => {
    beforeEach(() => {
      mockGetRegisteredAgentIds.mockReturnValue([
        "claude",
        "codex",
      ]);
    });

    it("pre-selects both when plugin declares both and user has both", async () => {
      mockMultiselect.mockResolvedValue(["claude", "codex"]);

      await selectAgents({
        declaredAgents: ["claude", "codex"],
        detectedAgents: ["claude", "codex"],
      });

      const call = mockMultiselect.mock.calls[0]![0];
      expect(call.initialValues).toEqual(["claude", "codex"]);
      // Both declared — no warning hints
      for (const opt of call.options) {
        expect(opt.hint).toBeUndefined();
      }
    });

    it("pre-selects only claude when plugin declares both but user has only claude", async () => {
      mockMultiselect.mockResolvedValue(["claude"]);

      await selectAgents({
        declaredAgents: ["claude", "codex"],
        detectedAgents: ["claude"],
      });

      const call = mockMultiselect.mock.calls[0]![0];
      expect(call.initialValues).toEqual(["claude"]);
      // Both declared — no warning hints even though codex not detected
      for (const opt of call.options) {
        expect(opt.hint).toBeUndefined();
      }
    });

    it("pre-selects only claude when plugin declares claude-only but user has both", async () => {
      mockMultiselect.mockResolvedValue(["claude"]);

      await selectAgents({
        declaredAgents: ["claude"],
        detectedAgents: ["claude", "codex"],
      });

      const call = mockMultiselect.mock.calls[0]![0];
      expect(call.initialValues).toEqual(["claude"]);
      // Codex not declared — should have warning hint
      const codexOption = call.options.find(
        (o: { value: AgentId }) => o.value === "codex",
      );
      expect(codexOption?.hint).toMatch(/not declared/i);
      // Claude declared — no warning
      const claudeOption = call.options.find(
        (o: { value: AgentId }) => o.value === "claude",
      );
      expect(claudeOption?.hint).toBeUndefined();
    });

    it("shows warning on both agents when declaredAgents is empty", async () => {
      mockMultiselect.mockResolvedValue([]);

      await selectAgents({
        declaredAgents: [],
        detectedAgents: ["claude", "codex"],
      });

      const call = mockMultiselect.mock.calls[0]![0];
      expect(call.initialValues).toEqual([]);
      for (const opt of call.options) {
        expect(opt.hint).toMatch(/not declared/i);
      }
    });
  });
});

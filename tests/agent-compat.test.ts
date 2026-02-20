import { describe, it, expect } from "vitest";
import { computeAgentChanges } from "../src/agent-compat.js";

describe("computeAgentChanges", () => {
  describe("effective agents", () => {
    it("returns intersection of entry agents and new config agents", () => {
      const { effective } = computeAgentChanges(["claude", "codex"], ["claude"]);
      expect(effective).toEqual(["claude"]);
    });

    it("returns all when agents match exactly", () => {
      const { effective } = computeAgentChanges(
        ["claude", "codex"],
        ["claude", "codex"],
      );
      expect(effective).toEqual(["claude", "codex"]);
    });

    it("returns empty when no overlap", () => {
      const { effective } = computeAgentChanges(["codex"], ["claude"]);
      expect(effective).toEqual([]);
    });

    it("ignores new agents not in entry", () => {
      const { effective } = computeAgentChanges(["claude"], ["claude", "codex"]);
      expect(effective).toEqual(["claude"]);
    });

    it("preserves order from entry agents", () => {
      const { effective } = computeAgentChanges(
        ["codex", "claude"],
        ["claude", "codex"],
      );
      expect(effective).toEqual(["codex", "claude"]);
    });
  });

  describe("dropped agents", () => {
    it("returns agents in entry but not in new config", () => {
      const { dropped } = computeAgentChanges(["claude", "codex"], ["claude"]);
      expect(dropped).toEqual(["codex"]);
    });

    it("returns empty when no agents dropped", () => {
      const { dropped } = computeAgentChanges(
        ["claude", "codex"],
        ["claude", "codex"],
      );
      expect(dropped).toEqual([]);
    });

    it("returns all when none overlap", () => {
      const { dropped } = computeAgentChanges(["codex"], ["claude"]);
      expect(dropped).toEqual(["codex"]);
    });

    it("ignores new agents not in entry", () => {
      const { dropped } = computeAgentChanges(["claude"], ["claude", "codex"]);
      expect(dropped).toEqual([]);
    });

    it("returns single dropped agent from multi-agent entry", () => {
      const { dropped } = computeAgentChanges(["claude", "codex"], ["codex"]);
      expect(dropped).toEqual(["claude"]);
    });
  });

  describe("complement invariant", () => {
    it("dropped is always the exact complement of effective", () => {
      const entry = ["claude", "codex"];
      const { effective, dropped } = computeAgentChanges(entry, ["claude"]);
      const recombined = [...effective, ...dropped].sort();
      expect(recombined).toEqual([...entry].sort());
    });

    it("every entry agent is in exactly one of effective or dropped", () => {
      const entry = ["claude", "codex"];
      const { effective, dropped } = computeAgentChanges(entry, ["codex"]);
      for (const agent of entry) {
        const inEffective = effective.includes(agent);
        const inDropped = dropped.includes(agent);
        expect(inEffective !== inDropped).toBe(true);
      }
    });
  });
});

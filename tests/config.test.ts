import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { KNOWN_AGENTS, readConfig } from "../src/config.js";

vi.mock("node:fs/promises");

describe("KNOWN_AGENTS", () => {
	it("contains claude, codex, and cursor", () => {
		expect(KNOWN_AGENTS).toEqual(["claude", "codex", "cursor"]);
	});
});

describe("readConfig", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("returns null when agntc.json does not exist", async () => {
		const err = Object.assign(new Error("ENOENT"), {
			code: "ENOENT",
		});
		vi.mocked(fs.readFile).mockRejectedValue(err);

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("parses valid config with single agent", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude"] }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: ["claude"] });
	});

	it("parses valid config with multiple agents", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude", "codex"] }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: ["claude", "codex"] });
	});

	it("parses valid config with cursor agent", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["cursor"] }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: ["cursor"] });
	});

	it("parses valid config with all three agents", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude", "codex", "cursor"] }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: ["claude", "codex", "cursor"] });
	});

	it("returns null and warns for malformed JSON (truncated)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue('{"agents":');
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toBeNull();
		expect(onWarn).toHaveBeenCalledWith(
			expect.stringContaining("Ignoring malformed agntc.json:"),
		);
	});

	it("returns null and warns for malformed JSON (trailing comma)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue('{"agents": ["claude"],}');
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toBeNull();
		expect(onWarn).toHaveBeenCalledWith(
			expect.stringContaining("Ignoring malformed agntc.json:"),
		);
	});

	it("does not throw for malformed JSON (returns null)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue("{bad json}");

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("returns null when agents field missing and no type present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ name: "test" }));

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("returns null when agents is empty array and no type present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ agents: [] }));

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("returns null when JSON is not an object and no type present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify("just a string"));

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("returns null when agents is non-array and no type present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: "claude" }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("returns null when all agents unknown and no type present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["unknown1", "unknown2"] }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toBeNull();
		expect(onWarn).toHaveBeenCalledTimes(2);
	});

	it("warns for unknown agent and filters it out", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude", "unknown-agent"] }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toEqual({ agents: ["claude"] });
		expect(onWarn).toHaveBeenCalledWith(
			expect.stringContaining("unknown-agent"),
		);
	});

	it("returns known agents when mix present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["unknown1", "claude", "unknown2", "codex"] }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toEqual({ agents: ["claude", "codex"] });
	});

	it("warns once per unknown agent", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["bad1", "claude", "bad2"] }),
		);
		const onWarn = vi.fn();

		await readConfig("/some/dir", { onWarn });
		expect(onWarn).toHaveBeenCalledTimes(2);
		expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("bad1"));
		expect(onWarn).toHaveBeenCalledWith(expect.stringContaining("bad2"));
	});

	it("does not call onWarn when all agents known", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude", "codex"] }),
		);
		const onWarn = vi.fn();

		await readConfig("/some/dir", { onWarn });
		expect(onWarn).not.toHaveBeenCalled();
	});

	it("propagates permission denied errors unchanged (raw error)", async () => {
		const err = Object.assign(new Error("EACCES: permission denied"), {
			code: "EACCES",
		});
		vi.mocked(fs.readFile).mockRejectedValue(err);

		// Non-ENOENT IO errors propagate raw — the exact thrown error instance,
		// not swallowed (null) and not wrapped in another error type.
		await expect(readConfig("/some/dir")).rejects.toBe(err);
		await expect(readConfig("/some/dir")).rejects.toMatchObject({
			message: "EACCES: permission denied",
			code: "EACCES",
		});
	});

	it("reads from correct path", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude"] }),
		);

		await readConfig("/my/repo");
		expect(fs.readFile).toHaveBeenCalledWith(
			path.join("/my/repo", "agntc.json"),
			"utf-8",
		);
	});

	it("retains a type-only config with empty agents (configless skills-only bundle)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ type: "plugin" }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: [], type: "plugin" });
	});

	it("retains a type-bearing config when agents is empty array", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ type: "plugin", agents: [] }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: [], type: "plugin" });
	});

	it("retains a type-bearing config when all agents are unknown", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ type: "plugin", agents: ["unknown1", "unknown2"] }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toEqual({ agents: [], type: "plugin" });
		expect(onWarn).toHaveBeenCalledTimes(2);
	});

	it("reads optional type when present alongside known agents", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude"], type: "plugin" }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: ["claude"], type: "plugin" });
	});

	it("passes through unrecognised type verbatim", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude"], type: "something-unknown" }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ agents: ["claude"], type: "something-unknown" });
	});

	it("ignores unknown extra top-level keys without warning", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude"], name: "test", extra: 42 }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toEqual({ agents: ["claude"] });
		expect(onWarn).not.toHaveBeenCalled();
	});

	it("filters unknown agents but keeps known ones with type", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude", "unknown1"], type: "plugin" }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toEqual({ agents: ["claude"], type: "plugin" });
		expect(onWarn).toHaveBeenCalledTimes(1);
	});

	it("ignores a non-string type when no usable agents present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ type: 123 }));

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});
});

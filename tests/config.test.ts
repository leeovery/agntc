import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfigError, KNOWN_AGENTS, readConfig } from "../src/config.js";

vi.mock("node:fs/promises");

describe("KNOWN_AGENTS", () => {
	it("contains claude and codex", () => {
		expect(KNOWN_AGENTS).toEqual(["claude", "codex"]);
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

	it("throws ConfigError for invalid JSON (truncated)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue('{"agents":');

		await expect(readConfig("/some/dir")).rejects.toThrow(ConfigError);
		await expect(readConfig("/some/dir")).rejects.toThrow(
			/Invalid agntc\.json/,
		);
	});

	it("throws ConfigError for invalid JSON (trailing comma)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue('{"agents": ["claude"],}');

		await expect(readConfig("/some/dir")).rejects.toThrow(ConfigError);
		await expect(readConfig("/some/dir")).rejects.toThrow(
			/Invalid agntc\.json/,
		);
	});

	it("throws ConfigError with parse error detail", async () => {
		vi.mocked(fs.readFile).mockResolvedValue("{bad json}");

		try {
			await readConfig("/some/dir");
			expect.unreachable("should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(ConfigError);
			const msg = (err as ConfigError).message;
			expect(msg).toMatch(/^Invalid agntc\.json: /);
			// The message should include the original parse error detail after the prefix
			expect(msg.length).toBeGreaterThan("Invalid agntc.json: ".length);
		}
	});

	it("throws when agents field missing entirely", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ name: "test" }));

		await expect(readConfig("/some/dir")).rejects.toThrow(ConfigError);
		await expect(readConfig("/some/dir")).rejects.toThrow(
			"Invalid agntc.json: agents field is required",
		);
	});

	it("throws when agents is empty array", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ agents: [] }));

		await expect(readConfig("/some/dir")).rejects.toThrow(ConfigError);
		await expect(readConfig("/some/dir")).rejects.toThrow(
			"Invalid agntc.json: agents must not be empty",
		);
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

	it("returns empty known agents when all unknown (warns for each)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["unknown1", "unknown2"] }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toEqual({ agents: [] });
		expect(onWarn).toHaveBeenCalledTimes(2);
	});

	it("does not call onWarn when all agents known", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ agents: ["claude", "codex"] }),
		);
		const onWarn = vi.fn();

		await readConfig("/some/dir", { onWarn });
		expect(onWarn).not.toHaveBeenCalled();
	});

	it("propagates permission denied errors", async () => {
		const err = Object.assign(new Error("EACCES: permission denied"), {
			code: "EACCES",
		});
		vi.mocked(fs.readFile).mockRejectedValue(err);

		await expect(readConfig("/some/dir")).rejects.toThrow(
			"EACCES: permission denied",
		);
		// Should NOT be wrapped in ConfigError - propagate as-is
		await expect(readConfig("/some/dir")).rejects.not.toBeInstanceOf(
			ConfigError,
		);
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
});

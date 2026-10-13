import * as fs from "node:fs/promises";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { declaresPack, readConfig } from "../src/config.js";

vi.mock("node:fs/promises");

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

	it("reads type when present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ type: "plugin" }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ type: "plugin" });
	});

	it("passes through unrecognised type verbatim", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ type: "something-unknown" }),
		);

		const result = await readConfig("/some/dir");
		expect(result).toEqual({ type: "something-unknown" });
	});

	it("returns null when no type is present", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ name: "test" }));

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("ignores a non-string type", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ type: 123 }));

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	it("returns null when JSON is not an object", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify("just a string"));

		const result = await readConfig("/some/dir");
		expect(result).toBeNull();
	});

	describe("legacy agents key", () => {
		it("ignores an agents-only config silently", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({ agents: ["claude", "codex", "cursor"] }),
			);
			const onWarn = vi.fn();

			const result = await readConfig("/some/dir", { onWarn });
			expect(result).toBeNull();
			expect(onWarn).not.toHaveBeenCalled();
		});

		it("ignores a codex-only declaration silently", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({ agents: ["codex"] }),
			);
			const onWarn = vi.fn();

			const result = await readConfig("/some/dir", { onWarn });
			expect(result).toBeNull();
			expect(onWarn).not.toHaveBeenCalled();
		});

		it("ignores unknown agent names without warning", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({ agents: ["unknown1", "unknown2"] }),
			);
			const onWarn = vi.fn();

			await readConfig("/some/dir", { onWarn });
			expect(onWarn).not.toHaveBeenCalled();
		});

		it("keeps type and drops agents when both are present", async () => {
			vi.mocked(fs.readFile).mockResolvedValue(
				JSON.stringify({ agents: ["codex"], type: "plugin" }),
			);
			const onWarn = vi.fn();

			const result = await readConfig("/some/dir", { onWarn });
			expect(result).toEqual({ type: "plugin" });
			expect(onWarn).not.toHaveBeenCalled();
		});
	});

	it("ignores unknown extra top-level keys without warning", async () => {
		vi.mocked(fs.readFile).mockResolvedValue(
			JSON.stringify({ type: "plugin", name: "test", extra: 42 }),
		);
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toEqual({ type: "plugin" });
		expect(onWarn).not.toHaveBeenCalled();
	});

	it("returns null and warns for malformed JSON (truncated)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue('{"type":');
		const onWarn = vi.fn();

		const result = await readConfig("/some/dir", { onWarn });
		expect(result).toBeNull();
		expect(onWarn).toHaveBeenCalledWith(
			expect.stringContaining("Ignoring malformed agntc.json:"),
		);
	});

	it("returns null and warns for malformed JSON (trailing comma)", async () => {
		vi.mocked(fs.readFile).mockResolvedValue('{"type": "plugin",}');
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
			JSON.stringify({ type: "plugin" }),
		);

		await readConfig("/my/repo");
		expect(fs.readFile).toHaveBeenCalledWith(
			path.join("/my/repo", "agntc.json"),
			"utf-8",
		);
	});
});

describe("declaresPack", () => {
	it('is true for "pack" and the legacy "plugin"', () => {
		expect(declaresPack({ type: "pack" })).toBe(true);
		expect(declaresPack({ type: "plugin" })).toBe(true);
	});

	it("is false for any other type, no type or no config", () => {
		expect(declaresPack({ type: "skill" })).toBe(false);
		expect(declaresPack({})).toBe(false);
		expect(declaresPack(null)).toBe(false);
	});
});

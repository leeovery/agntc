import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Manifest } from "../src/manifest.js";

vi.mock("@clack/prompts", () => ({
  multiselect: vi.fn(),
  isCancel: (value: unknown): value is symbol => typeof value === "symbol",
  log: { info: vi.fn() },
}));

import * as p from "@clack/prompts";
import { selectCollectionPlugins } from "../src/collection-select.js";

const mockMultiselect = vi.mocked(p.multiselect);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("selectCollectionPlugins", () => {
  it("presents all plugins as multiselect options", async () => {
    mockMultiselect.mockResolvedValue(["alpha", "beta"]);

    await selectCollectionPlugins({
      plugins: ["alpha", "beta"],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const values = call.options.map((o: { value: string }) => o.value);
    expect(values).toEqual(["alpha", "beta"]);
  });

  it("constructs manifest key as prefix/pluginName", async () => {
    const manifest: Manifest = {
      "owner/repo/alpha": {
        ref: null,
        commit: "abc123",
        installedAt: "2026-01-01T00:00:00Z",
        agents: ["claude"],
        files: [],
      },
    };
    mockMultiselect.mockResolvedValue([]);

    await selectCollectionPlugins({
      plugins: ["alpha", "beta"],
      manifest,
      manifestKeyPrefix: "owner/repo",
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const alphaOption = call.options.find(
      (o: { value: string }) => o.value === "alpha",
    );
    const betaOption = call.options.find(
      (o: { value: string }) => o.value === "beta",
    );
    expect(alphaOption?.hint).toBe("installed");
    expect(betaOption?.hint).toBeUndefined();
  });

  it("shows installed hint for installed plugins", async () => {
    const manifest: Manifest = {
      "owner/repo/my-plugin": {
        ref: null,
        commit: "abc123",
        installedAt: "2026-01-01T00:00:00Z",
        agents: ["claude"],
        files: [],
      },
    };
    mockMultiselect.mockResolvedValue([]);

    await selectCollectionPlugins({
      plugins: ["my-plugin"],
      manifest,
      manifestKeyPrefix: "owner/repo",
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const option = call.options.find(
      (o: { value: string }) => o.value === "my-plugin",
    );
    expect(option?.hint).toBe("installed");
  });

  it("shows no hint for not-installed plugins", async () => {
    mockMultiselect.mockResolvedValue([]);

    await selectCollectionPlugins({
      plugins: ["fresh-plugin"],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const option = call.options.find(
      (o: { value: string }) => o.value === "fresh-plugin",
    );
    expect(option?.hint).toBeUndefined();
  });

  it("handles mixed installed and not-installed plugins", async () => {
    const manifest: Manifest = {
      "owner/repo/installed-one": {
        ref: null,
        commit: "abc123",
        installedAt: "2026-01-01T00:00:00Z",
        agents: ["claude"],
        files: [],
      },
    };
    mockMultiselect.mockResolvedValue([]);

    await selectCollectionPlugins({
      plugins: ["installed-one", "new-one", "another-new"],
      manifest,
      manifestKeyPrefix: "owner/repo",
    });

    const call = mockMultiselect.mock.calls[0]![0];
    const installedOpt = call.options.find(
      (o: { value: string }) => o.value === "installed-one",
    );
    const newOpt = call.options.find(
      (o: { value: string }) => o.value === "new-one",
    );
    const anotherNewOpt = call.options.find(
      (o: { value: string }) => o.value === "another-new",
    );
    expect(installedOpt?.hint).toBe("installed");
    expect(newOpt?.hint).toBeUndefined();
    expect(anotherNewOpt?.hint).toBeUndefined();
  });

  it("returns empty array on cancel", async () => {
    mockMultiselect.mockResolvedValue(Symbol("cancel"));

    const result = await selectCollectionPlugins({
      plugins: ["alpha", "beta"],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
    });

    expect(result).toEqual([]);
  });

  it("returns empty array on zero selection", async () => {
    mockMultiselect.mockResolvedValue([] as string[]);

    const result = await selectCollectionPlugins({
      plugins: ["alpha", "beta"],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
    });

    expect(result).toEqual([]);
  });

  it("returns selected plugin names as string[]", async () => {
    mockMultiselect.mockResolvedValue(["alpha", "beta"]);

    const result = await selectCollectionPlugins({
      plugins: ["alpha", "beta", "gamma"],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
    });

    expect(result).toEqual(["alpha", "beta"]);
  });

  it("shows multiselect for single-plugin collection", async () => {
    mockMultiselect.mockResolvedValue(["only-one"]);

    await selectCollectionPlugins({
      plugins: ["only-one"],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
    });

    expect(mockMultiselect).toHaveBeenCalledOnce();
    const call = mockMultiselect.mock.calls[0]![0];
    expect(call.options).toHaveLength(1);
    expect(call.options[0]!.value).toBe("only-one");
  });

  it("shows multiselect for all-installed collection", async () => {
    const manifest: Manifest = {
      "owner/repo/alpha": {
        ref: null,
        commit: "abc123",
        installedAt: "2026-01-01T00:00:00Z",
        agents: ["claude"],
        files: [],
      },
      "owner/repo/beta": {
        ref: null,
        commit: "def456",
        installedAt: "2026-01-01T00:00:00Z",
        agents: ["claude"],
        files: [],
      },
    };
    mockMultiselect.mockResolvedValue([]);

    await selectCollectionPlugins({
      plugins: ["alpha", "beta"],
      manifest,
      manifestKeyPrefix: "owner/repo",
    });

    expect(mockMultiselect).toHaveBeenCalledOnce();
    const call = mockMultiselect.mock.calls[0]![0];
    for (const opt of call.options) {
      expect(opt.hint).toBe("installed");
    }
  });

  it("returns empty without showing multiselect for empty plugins array", async () => {
    const result = await selectCollectionPlugins({
      plugins: [],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
    });

    expect(result).toEqual([]);
    expect(mockMultiselect).not.toHaveBeenCalled();
  });

  it("passes correct options shape to clack multiselect", async () => {
    mockMultiselect.mockResolvedValue(["alpha"]);

    await selectCollectionPlugins({
      plugins: ["alpha", "beta"],
      manifest: {},
      manifestKeyPrefix: "owner/repo",
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
});

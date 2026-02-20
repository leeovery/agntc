import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cloneSource, cleanupTempDir } from "../src/git-clone.js";
import type { ParsedSource } from "../src/source-parser.js";
import * as childProcess from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";

vi.mock("node:child_process");
vi.mock("node:fs/promises");
vi.mock("node:os");

function makeParsed(overrides: Partial<ParsedSource> = {}): ParsedSource {
  return {
    type: "github-shorthand",
    owner: "acme",
    repo: "skills",
    ref: null,
    manifestKey: "acme/skills",
    ...overrides,
  };
}

const FAKE_TMPDIR = "/tmp/fake";
const FAKE_TEMPDIR = "/tmp/fake/agntc-abc123";
const FAKE_SHA = "a".repeat(40);

function mockExecFileSuccess(
  stdout = FAKE_SHA + "\n",
): void {
  const execFileMock = vi.mocked(childProcess.execFile);
  execFileMock.mockImplementation(
    (_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
      if (typeof _opts === "function") {
        cb = _opts;
      }
      if (cb) {
        cb(null, stdout, "");
      }
      return {} as ReturnType<typeof childProcess.execFile>;
    },
  );
}

function mockExecFileFailure(
  stderr: string,
  exitCode = 1,
  callsBeforeSuccess?: number,
): void {
  const execFileMock = vi.mocked(childProcess.execFile);
  let callCount = 0;

  execFileMock.mockImplementation(
    (_cmd: string, _args: unknown, _opts: unknown, cb?: Function) => {
      if (typeof _opts === "function") {
        cb = _opts;
      }
      callCount++;
      if (callsBeforeSuccess !== undefined && callCount > callsBeforeSuccess) {
        if (cb) {
          cb(null, FAKE_SHA + "\n", "");
        }
      } else {
        const err = Object.assign(new Error(stderr), {
          code: exitCode,
          stderr,
        });
        if (cb) {
          cb(err, "", stderr);
        }
      }
      return {} as ReturnType<typeof childProcess.execFile>;
    },
  );
}

function setupMocks(): void {
  vi.mocked(os.tmpdir).mockReturnValue(FAKE_TMPDIR);
  vi.mocked(fs.mkdtemp).mockResolvedValue(FAKE_TEMPDIR);
  vi.mocked(fs.rm).mockResolvedValue(undefined);
}

/**
 * Helper to run cloneSource and advance timers for tests expecting rejection.
 * Attaches .catch() immediately to prevent unhandled rejection warnings.
 */
async function runAndReject(
  parsed: ParsedSource,
): Promise<Error> {
  const promise = cloneSource(parsed);
  // Attach handler immediately to prevent unhandled rejection
  const caughtPromise = promise.catch((err: Error) => err);
  await vi.runAllTimersAsync();
  const result = await caughtPromise;
  if (!(result instanceof Error)) {
    throw new Error("Expected cloneSource to reject, but it resolved");
  }
  return result;
}

describe("cloneSource", () => {
  beforeEach(() => {
    setupMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("constructs correct clone URL from owner and repo", async () => {
    mockExecFileSuccess();
    const parsed = makeParsed({ owner: "alice", repo: "my-skills" });

    const promise = cloneSource(parsed);
    await vi.runAllTimersAsync();
    await promise;

    const execFileMock = vi.mocked(childProcess.execFile);
    const firstCall = execFileMock.mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).toContain("https://github.com/alice/my-skills.git");
  });

  it("calls git clone with --depth 1", async () => {
    mockExecFileSuccess();

    const promise = cloneSource(makeParsed());
    await vi.runAllTimersAsync();
    await promise;

    const execFileMock = vi.mocked(childProcess.execFile);
    const firstCall = execFileMock.mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).toContain("clone");
    expect(args).toContain("--depth");
    expect(args).toContain("1");
  });

  it("omits --branch when ref is null", async () => {
    mockExecFileSuccess();

    const promise = cloneSource(makeParsed({ ref: null }));
    await vi.runAllTimersAsync();
    await promise;

    const execFileMock = vi.mocked(childProcess.execFile);
    const firstCall = execFileMock.mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).not.toContain("--branch");
  });

  it("passes --branch <ref> when ref is provided", async () => {
    mockExecFileSuccess();

    const promise = cloneSource(makeParsed({ ref: "v2.0" }));
    await vi.runAllTimersAsync();
    await promise;

    const execFileMock = vi.mocked(childProcess.execFile);
    const firstCall = execFileMock.mock.calls[0]!;
    const args = firstCall[1] as string[];
    const branchIdx = args.indexOf("--branch");
    expect(branchIdx).toBeGreaterThan(-1);
    expect(args[branchIdx + 1]).toBe("v2.0");
  });

  it("returns tempDir and 40-char commit SHA on success", async () => {
    mockExecFileSuccess();

    const promise = cloneSource(makeParsed());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.tempDir).toBe(FAKE_TEMPDIR);
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("creates temp dir with agntc- prefix", async () => {
    mockExecFileSuccess();

    const promise = cloneSource(makeParsed());
    await vi.runAllTimersAsync();
    await promise;

    expect(fs.mkdtemp).toHaveBeenCalledWith(FAKE_TMPDIR + "/agntc-");
  });

  it("retries up to 3 times on transient failure then throws", async () => {
    mockExecFileFailure("fatal: repository not found");

    const err = await runAndReject(makeParsed());
    expect(err).toBeInstanceOf(Error);

    const execFileMock = vi.mocked(childProcess.execFile);
    const cloneCalls = execFileMock.mock.calls.filter((call) => {
      const args = call[1] as string[];
      return args.includes("clone");
    });
    expect(cloneCalls.length).toBe(3);
  });

  it("succeeds on second attempt after transient failure", async () => {
    // First call fails (clone), second call succeeds (clone), third call is rev-parse
    mockExecFileFailure("fatal: repository not found", 1, 1);

    const promise = cloneSource(makeParsed());
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.tempDir).toBe(FAKE_TEMPDIR);
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  it("does not retry on auth failure (throws immediately)", async () => {
    mockExecFileFailure("fatal: Authentication failed for");

    const err = await runAndReject(makeParsed());
    expect(err.message).toMatch(/Authentication/);

    const execFileMock = vi.mocked(childProcess.execFile);
    const cloneCalls = execFileMock.mock.calls.filter((call) => {
      const args = call[1] as string[];
      return args.includes("clone");
    });
    expect(cloneCalls.length).toBe(1);
  });

  it("detects auth failure from 'Permission denied' stderr", async () => {
    mockExecFileFailure("Permission denied (publickey)");

    const err = await runAndReject(makeParsed());
    expect(err.message).toMatch(/Permission denied/);

    const execFileMock = vi.mocked(childProcess.execFile);
    const cloneCalls = execFileMock.mock.calls.filter((call) => {
      const args = call[1] as string[];
      return args.includes("clone");
    });
    expect(cloneCalls.length).toBe(1);
  });

  it("detects auth failure from 'could not read Username' stderr", async () => {
    mockExecFileFailure("fatal: could not read Username for");

    const err = await runAndReject(makeParsed());
    expect(err.message).toMatch(/could not read Username/);

    const execFileMock = vi.mocked(childProcess.execFile);
    const cloneCalls = execFileMock.mock.calls.filter((call) => {
      const args = call[1] as string[];
      return args.includes("clone");
    });
    expect(cloneCalls.length).toBe(1);
  });

  it("detects auth failure from 'Password' stderr", async () => {
    mockExecFileFailure("fatal: could not read Password for");

    const err = await runAndReject(makeParsed());
    expect(err.message).toMatch(/Password/);

    const execFileMock = vi.mocked(childProcess.execFile);
    const cloneCalls = execFileMock.mock.calls.filter((call) => {
      const args = call[1] as string[];
      return args.includes("clone");
    });
    expect(cloneCalls.length).toBe(1);
  });

  it("cleans up temp dir after failure", async () => {
    mockExecFileFailure("fatal: repository not found");

    await runAndReject(makeParsed());

    expect(fs.rm).toHaveBeenCalledWith(FAKE_TEMPDIR, {
      recursive: true,
      force: true,
    });
  });

  it("does not clean up temp dir on success", async () => {
    mockExecFileSuccess();

    const promise = cloneSource(makeParsed());
    await vi.runAllTimersAsync();
    await promise;

    expect(fs.rm).not.toHaveBeenCalled();
  });

  it("surfaces git error message in thrown error", async () => {
    mockExecFileFailure("fatal: repository 'https://github.com/acme/nope.git' not found");

    const err = await runAndReject(makeParsed());
    expect(err.message).toMatch(/repository.*not found/);
  });

  it("clone failure for nonexistent repo produces clear error", async () => {
    mockExecFileFailure("fatal: repository 'https://github.com/acme/nope.git' not found");

    const err = await runAndReject(makeParsed({ repo: "nope" }));
    expect(err.message).toMatch(/git clone failed/);
    expect(err.message).toMatch(/repository.*not found/);
  });

  it("uses cloneUrl directly for https-url type", async () => {
    mockExecFileSuccess();
    const parsed: ParsedSource = {
      type: "https-url",
      owner: "team",
      repo: "tools",
      ref: null,
      manifestKey: "team/tools",
      cloneUrl: "https://gitlab.com/team/tools.git",
    };

    const promise = cloneSource(parsed);
    await vi.runAllTimersAsync();
    await promise;

    const execFileMock = vi.mocked(childProcess.execFile);
    const firstCall = execFileMock.mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).toContain("https://gitlab.com/team/tools.git");
  });

  it("uses cloneUrl directly for ssh-url type", async () => {
    mockExecFileSuccess();
    const parsed: ParsedSource = {
      type: "ssh-url",
      owner: "team",
      repo: "tools",
      ref: null,
      manifestKey: "team/tools",
      cloneUrl: "git@gitlab.com:team/tools.git",
    };

    const promise = cloneSource(parsed);
    await vi.runAllTimersAsync();
    await promise;

    const execFileMock = vi.mocked(childProcess.execFile);
    const firstCall = execFileMock.mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).toContain("git@gitlab.com:team/tools.git");
  });

  it("still builds GitHub URL for github-shorthand type", async () => {
    mockExecFileSuccess();
    const parsed = makeParsed({ owner: "bob", repo: "plugins" });

    const promise = cloneSource(parsed);
    await vi.runAllTimersAsync();
    await promise;

    const execFileMock = vi.mocked(childProcess.execFile);
    const firstCall = execFileMock.mock.calls[0]!;
    const args = firstCall[1] as string[];
    expect(args).toContain("https://github.com/bob/plugins.git");
  });
});

describe("cleanupTempDir", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("removes directory recursively", async () => {
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    await cleanupTempDir("/tmp/fake/agntc-xyz");

    expect(fs.rm).toHaveBeenCalledWith("/tmp/fake/agntc-xyz", {
      recursive: true,
      force: true,
    });
  });

  it("does not throw if dir missing", async () => {
    vi.mocked(fs.rm).mockResolvedValue(undefined);

    await expect(cleanupTempDir("/tmp/nonexistent")).resolves.toBeUndefined();
  });
});

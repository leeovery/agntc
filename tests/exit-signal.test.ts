import { describe, it, expect, vi, beforeEach } from "vitest";
import { ExitSignal, withExitSignal } from "../src/exit-signal.js";

describe("withExitSignal", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("calls process.exit with the signal code when ExitSignal is thrown", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const wrapped = withExitSignal(async () => {
      throw new ExitSignal(0);
    });

    await wrapped();

    expect(mockExit).toHaveBeenCalledWith(0);
  });

  it("calls process.exit with non-zero code for error ExitSignal", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const wrapped = withExitSignal(async () => {
      throw new ExitSignal(1);
    });

    await wrapped();

    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("re-throws non-ExitSignal errors", async () => {
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

    const wrapped = withExitSignal(async () => {
      throw new Error("unexpected");
    });

    await expect(wrapped()).rejects.toThrow("unexpected");
  });

  it("passes arguments through to the wrapped function", async () => {
    const fn = vi.fn(async (_source: string) => {});
    const wrapped = withExitSignal(fn);

    await wrapped("test-arg");

    expect(fn).toHaveBeenCalledWith("test-arg");
  });

  it("completes normally when no error is thrown", async () => {
    const mockExit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    const fn = vi.fn(async () => {});
    const wrapped = withExitSignal(fn);

    await wrapped();

    expect(fn).toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
